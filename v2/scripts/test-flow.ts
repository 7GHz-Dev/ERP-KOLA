/**
 * ทดสอบเส้นทางใช้งานจริง ด้วยการยิงแบบเดียวกับที่เบราว์เซอร์ยิง
 *
 *   1. ช่องค้นหาบนหัวคอลัมน์
 *   2. วงจร Draft ใบขน: ส่งตรวจ → ตีกลับ → แก้ไฟล์ → ส่งใหม่
 *   3. รวมชุด E-Office รวมถึงไฟล์สายเรือที่ถูกล็อก
 *   4. อัปโหลดไฟล์ และตัวเลขเตือนบนแท็บ
 *
 * สร้างงานทดสอบของตัวเองแล้วลบทิ้งตอนจบ ไม่ยุ่งกับงานจริง
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const BASE = 'http://localhost:3000';
const TEST_PREFIX = 'ZZ-FLOW-';

/**
 * รหัสของแต่ละ server action อ่านจาก manifest ที่ Next สร้างตอน build
 *
 * ตอนแรกเทสต์หาฟอร์มจากข้อความบนปุ่ม แต่พอหน้าใหญ่ React จะทยอยส่ง HTML
 * ปุ่มบางอันมาทีหลังแยกก้อน อยู่คนละที่กับฟอร์มใน HTML ดิบ (เบราว์เซอร์ย้ายให้เอง)
 * จับคู่ด้วยรหัส action แทนจึงตรงเสมอ และยังพิสูจน์ว่าปุ่มผูกกับคำสั่งที่ตั้งใจจริง
 */
const ACTION_IDS: Record<string, string> = (() => {
  const manifest = JSON.parse(
    readFileSync('.next/server/server-reference-manifest.json', 'utf8'),
  ) as { node: Record<string, { exportedName?: string }> };
  const map: Record<string, string> = {};
  for (const [id, entry] of Object.entries(manifest.node)) {
    if (entry.exportedName) map[entry.exportedName] = id;
  }
  return map;
})();

type FormSpec = { actionId: string; fields: Record<string, string> };

/** ฟอร์มของ action ที่ระบุ บนแถวของงานที่ระบุ */
function findForm(html: string, actionName: string, jobId: string): FormSpec | null {
  const actionId = ACTION_IDS[actionName];
  if (!actionId) throw new Error(`ไม่พบ action ชื่อ ${actionName} ใน manifest`);

  const forms = html.match(/<form[^>]*method="POST"[\s\S]*?<\/form>/g) ?? [];
  for (const form of forms) {
    if (!form.includes(`name="$ACTION_ID_${actionId}"`)) continue;
    if (!form.includes(`value="${jobId}"`)) continue;
    const fields: Record<string, string> = {};
    for (const m of form.matchAll(/<input type="hidden" name="([^"$][^"]*)" value="([^"]*)"\/>/g)) {
      fields[m[1]] = m[2];
    }
    return { actionId, fields };
  }
  return null;
}


/** ข้อความในแต่ละหน้าของ PDF ใช้ดูว่าหน้าไหนว่างเปล่า */
async function textPerPage(bytes: Buffer): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false,
  }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.push(content.items.map((x: any) => x.str ?? '').join('').trim());
  }
  return out;
}

function multipart(spec: FormSpec, extra: Record<string, string> = {}) {
  const boundary = `----kola${randomBytes(8).toString('hex')}`;
  let body = `--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${spec.actionId}"\r\n\r\n\r\n`;
  for (const [name, value] of Object.entries({ ...spec.fields, ...extra })) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function main() {
  const { encodeSession } = await import('../src/lib/session-token');
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const { buildKey, ensureBucket, uploadFile, downloadFile, removeFile } =
    await import('../src/lib/storage');

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
  let failed = 0;
  const check = (ok: boolean, label: string) => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ผ่าน' : 'พัง '} ${label}`);
  };

  await sql`delete from jobs where job_no like ${`${TEST_PREFIX}%`}`;

  const [user] = await sql<{
    id: string; username: string; display_name: string; must_change_password: boolean;
  }[]>`select id, username, display_name, must_change_password from users
       where is_active = true order by role = 'ADMIN' desc limit 1`;

  const sid = `FLOW-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 900_000);
  await sql`insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
            values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')},
                    ${user.id}, ${expiresAt}, now())`;
  const cookie = `kola_session=${encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: 'ADMIN', mcp: user.must_change_password, exp: expiresAt.getTime(),
  })}`;

  const get = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' }).then((r) => r.text());
  const post = (path: string, spec: FormSpec, extra?: Record<string, string>) => {
    const part = multipart(spec, extra);
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { cookie, 'content-type': part.contentType },
      body: part.body,
      redirect: 'manual',
    });
  };


  /** เรียกเส้นทางรวมชุดแล้วอ่านความคืบหน้าทีละบรรทัดแบบเดียวกับหน้าเว็บ */
  const merge = async (id: string) => {
    const res = await fetch(`${BASE}/api/eoffice/merge`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: id }),
    });
    const text = await res.text();
    const steps = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as {
      index: number; total: number; label: string; status: string; detail?: string;
    });
    const last = steps[steps.length - 1];
    return { steps, message: last?.status === 'done' ? last.detail ?? '' : `ผิดพลาด: ${last?.detail ?? ''}` };
  };

  const jobId = `JOB-${TEST_PREFIX}${randomBytes(5).toString('hex').toUpperCase()}`;
  const jobNo = `${TEST_PREFIX}${randomBytes(3).toString('hex').toUpperCase()}`;
  const keys: string[] = [];

  const cleanup = async () => {
    for (const k of keys) {
      try { await removeFile(k); } catch { /* ลบไม่ได้ก็ข้าม */ }
    }
    await sql`delete from jobs where id = ${jobId}`;
    await sql`delete from sessions where id = ${sid}`;
  };

  try {
    /* ================= 1. ช่องค้นหา ================= */
    console.log('\n1. ช่องค้นหาบนหัวคอลัมน์');

    const jobsPage = await get('/jobs');
    const submitButton = /<button[^>]*type="submit"[^>]*>ค้นหา<\/button>/.test(jobsPage);
    check(submitButton, 'ฟอร์มค้นหามีปุ่ม submit จริง (ไม่งั้นกด Enter แล้วเงียบ)');

    const formId = jobsPage.match(/<form id="(q-jobs)"/)?.[1];
    check(formId === 'q-jobs', 'ช่องค้นหาผูกกับฟอร์มด้วย form="q-jobs"');

    const countRows = (html: string) => (html.match(/<tr data-open-job=/g) ?? []).length;
    const all = countRows(jobsPage);
    const filtered = countRows(await get('/jobs?blNo=ONEY'));
    check(all > 0 && filtered > 0 && filtered < all, `กรองด้วย BL No. แล้วเหลือน้อยลง (${all} → ${filtered})`);

    const noMatch = countRows(await get('/jobs?blNo=ZZZNOTHINGZZZ'));
    check(noMatch === 0, 'ค้นคำที่ไม่มีแล้วได้ 0 แถว');

    /* ================= 2. วงจร Draft ================= */
    console.log('\n2. Draft ใบขน: ส่งตรวจ → ตีกลับ → ส่งใหม่');

    await sql`insert into jobs (id, job_no, status, bl_no, source_type,
                                draft_ref_no, draft_status, customs_status)
              values (${jobId}, ${jobNo}, 'FN_APPROVED', 'ZZFLOWBL01', 'AN',
                      'QELSFLOWTEST', 'CREATED', 'DRAFT')`;
    for (const type of ['AN', 'FN']) {
      await sql`insert into approvals (id, job_id, approval_type, status, requested_by, decided_by, decided_at)
                values (${`APR-${randomBytes(6).toString('hex').toUpperCase()}`}, ${jobId},
                        ${type}, 'APPROVED', ${user.id}, ${user.id}, now())`;
    }

    const draftPage = await get('/pending?tab=draft');
    const sendSpec = findForm(draftPage, 'submitDraftForReview', jobId);
    check(Boolean(sendSpec) && draftPage.includes('ส่งให้ FAH ตรวจ'),
      'แท็บ Draft มีปุ่ม "ส่งให้ FAH ตรวจ" ที่ผูกกับคำสั่งถูกตัว');
    if (sendSpec) {
      const res = await post('/pending', sendSpec);
      const [j] = await sql<{ draft_status: string }[]>`select draft_status from jobs where id = ${jobId}`;
      check(res.status < 400 && j.draft_status === 'SUBMITTED',
        `ส่งแล้วสถานะเป็น SUBMITTED (${j.draft_status})`);

      const fahPage = await get('/fah/draft');
      check(fahPage.includes(jobNo), 'งานไปโผล่ในคิว "ตรวจ Draft" ของ FAH');

      const rejectSpec = findForm(fahPage, 'rejectDraft', jobId);
      check(Boolean(rejectSpec), 'FAH มีปุ่มตีกลับ Draft');
      if (rejectSpec) {
        await post('/fah/draft', rejectSpec, { reason: 'ไฟล์ Final Invoice ไม่ชัด' });
        const [r] = await sql<{ draft_status: string; draft_reject_reason: string }[]>`
          select draft_status, draft_reject_reason from jobs where id = ${jobId}`;
        check(r.draft_status === 'REJECTED' && r.draft_reject_reason === 'ไฟล์ Final Invoice ไม่ชัด',
          `ตีกลับแล้วเก็บเหตุผลไว้ ("${r.draft_reject_reason}")`);

        const back = await get('/pending?tab=draft');
        check(back.includes('ไฟล์ Final Invoice ไม่ชัด') || back.includes('ดูเหตุผล'),
          'PAINT เห็นว่าถูกตีกลับพร้อมเหตุผล');

        const resendSpec = findForm(back, 'submitDraftForReview', jobId);
        check(Boolean(resendSpec) && back.includes('ส่งตรวจอีกครั้ง'),
          'มีปุ่ม "ส่งตรวจอีกครั้ง" หลังถูกตีกลับ');
        if (resendSpec) {
          await post('/pending', resendSpec);
          const [again] = await sql<{ draft_status: string; draft_reject_reason: string | null }[]>`
            select draft_status, draft_reject_reason from jobs where id = ${jobId}`;
          check(again.draft_status === 'SUBMITTED' && again.draft_reject_reason === null,
            'ส่งใหม่แล้วกลับเป็น SUBMITTED และล้างเหตุผลเดิม');
        }
      }
    }

    /* ================= 3. รวมชุด E-Office ================= */
    console.log('\n3. รวมชุด E-Office');

    await sql`update jobs set customs_status = 'FILED' where id = ${jobId}`;
    await ensureBucket();

    // สร้าง PDF จริงสองใบ ใบละหนึ่งหน้า เอาไว้ตรวจว่าหน้ารวมกันครบ
    for (const [category, name] of [
      ['CUSTOMS_ENTRY_DOC', 'ใบขนทดสอบ.pdf'],
    ] as const) {
      const doc = await PDFDocument.create();
      doc.addPage([595, 842]).drawText(category, { x: 60, y: 700, size: 24 });
      const bytes = Buffer.from(await doc.save());
      const fileId = `FIL-${randomBytes(6).toString('hex').toUpperCase()}`;
      const key = buildKey(jobId, category, fileId, name);
      keys.push(key);
      await uploadFile(key, bytes, 'application/pdf');
      await sql`insert into files (id, job_id, category, version, storage_key, file_name,
                                   mime_type, size_bytes, uploaded_by)
                values (${fileId}, ${jobId}, ${category}, 1, ${key}, ${name},
                        'application/pdf', ${bytes.length}, ${user.id})`;
    }

    // ใช้ Final Invoice ตัวจริง (.xlsx) เพื่อดูว่าระบบแปลงเป็น PDF ให้เองไหม
    const [realXlsx] = await sql<{ storage_key: string }[]>`
      select storage_key from files
      where category = 'FINAL_INVOICE' and is_current = true and file_name ilike '%.xlsx' limit 1`;
    if (realXlsx) {
      const { body } = await downloadFile(realXlsx.storage_key);
      const upload = new FormData();
      upload.set('jobId', jobId);
      upload.set('category', 'FINAL_INVOICE');
      upload.set('file', new File([new Uint8Array(body)], 'FinalInvoice.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const res = await fetch(`${BASE}/api/files/upload`, {
        method: 'POST', headers: { cookie }, body: upload,
      });
      check(res.status === 200, `อัปโหลด Final Invoice (.xlsx) ได้ (HTTP ${res.status})`);

      const [converted] = await sql<{ storage_key: string; file_name: string }[]>`
        select storage_key, file_name from files
        where job_id = ${jobId} and category = 'FINAL_INVOICE_PDF' and is_current = true`;
      check(Boolean(converted), 'ระบบแปลง Excel เป็น PDF ให้เองตอนอัปโหลด');
      if (converted) {
        keys.push(converted.storage_key);
        const pdf = (await downloadFile(converted.storage_key)).body;
        check(pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'ไฟล์ที่แปลงเป็น PDF จริง');
        const pages = await textPerPage(pdf);
        check(pages.length === 1, `แปลงเฉพาะขอบเขตการพิมพ์ ได้ ${pages.length} หน้า`);
        check(pages[0].length > 200, `เนื้อในครบ (${pages[0].length} ตัวอักษร)`);
        check(!/GMT\+/.test(pages[0]), 'ช่องวันที่ถูกจัดรูปแบบ ไม่ใช่สตริงดิบของ Date');
      }
      const [src] = await sql<{ storage_key: string }[]>`
        select storage_key from files
        where job_id = ${jobId} and category = 'FINAL_INVOICE' and is_current = true`;
      if (src) keys.push(src.storage_key);
    }

    // เอาไฟล์สายเรือที่ถูกล็อกจริงมาเป็นชิ้น Arrival Notice — เคสที่เคยได้หน้าขาว
    const [locked] = await sql<{ storage_key: string }[]>`
      select f.storage_key from files f join jobs j on j.id = f.job_id
      where j.job_no = 'KOLA-2026-0008' and f.category = 'ARRIVAL_NOTICE' and f.is_current = true`;
    let lockedPages = 0;
    if (locked) {
      const { body } = await downloadFile(locked.storage_key);
      lockedPages = (await PDFDocument.load(body, { password: '' })).getPageCount();
      const fileId = `FIL-${randomBytes(6).toString('hex').toUpperCase()}`;
      const key = buildKey(jobId, 'ARRIVAL_NOTICE', fileId, 'locked.pdf');
      keys.push(key);
      await uploadFile(key, body, 'application/pdf');
      await sql`insert into files (id, job_id, category, version, storage_key, file_name,
                                   mime_type, size_bytes, uploaded_by)
                values (${fileId}, ${jobId}, 'ARRIVAL_NOTICE', 1, ${key}, 'locked.pdf',
                        'application/pdf', ${body.length}, ${user.id})`;
    }

    // ออกคำร้องจริง ระบบต้องสร้างไฟล์ PDF ให้เองโดยไม่ต้องอัปโหลด
    await sql`insert into customs_entries (id, job_id, declaration_no, status)
              values (${`CUS-${randomBytes(5).toString('hex').toUpperCase()}`}, ${jobId},
                      'A2608199000000', 'FILED')`;
    const edocPage0 = await get('/pending?tab=edoc');
    const reqSpec = findForm(edocPage0, 'createEofficeRequest', jobId);
    check(Boolean(reqSpec), 'แท็บเตรียมเอกสารมีฟอร์มออกคำร้อง');
    if (reqSpec) {
      await post('/pending', reqSpec, { goodsValue: '9000', goodsCurrency: 'USD' });
      const [reqFile] = await sql<{ storage_key: string; file_name: string; size_bytes: number }[]>`
        select storage_key, file_name, size_bytes from files
        where job_id = ${jobId} and category = 'EOFFICE_REQUEST' and is_current = true`;
      check(Boolean(reqFile), 'ออกคำร้องแล้วระบบสร้างไฟล์ PDF ให้เอง ไม่ต้องอัปโหลด');
      if (reqFile) {
        keys.push(reqFile.storage_key);
        const pdf = (await downloadFile(reqFile.storage_key)).body;
        check(pdf.subarray(0, 5).toString('latin1') === '%PDF-', 'ไฟล์คำร้องเป็น PDF จริง');
        const text = (await textPerPage(pdf)).join('');
        check(text.includes('เขตปลอดอากร'), 'คำร้องมีตัวอักษรไทยอ่านออก');
        check(text.includes('A2608199000000'), 'คำร้องมีเลขใบขนที่ถูกต้อง');
        check(text.includes('2569') || text.includes('2570'), 'คำร้องใช้ปี พ.ศ. ตามแบบราชการ');
      }
    }

    const edocPage = await get('/pending?tab=edoc');
    check(edocPage.includes('รวมชุด E-Office'), 'แท็บเตรียมเอกสารมีปุ่ม "รวมชุด E-Office"');

    {
      const { steps, message } = await merge(jobId);
      check(steps.some((s) => s.status === 'added'), 'รายงานความคืบหน้าทีละชิ้นระหว่างรวม');
      check(
        steps.every((s) => s.total > 0 && s.index >= 0),
        'ทุกเหตุการณ์บอกลำดับและจำนวนรวม พอคิดเป็น % ได้',
      );
      check(message.includes('รวมชุด'), `รวมเสร็จแล้วแจ้งผลกลับมา ("${message.slice(0, 70)}")`);

      const [merged] = await sql<{ id: string; storage_key: string; file_name: string }[]>`
        select id, storage_key, file_name from files
        where job_id = ${jobId} and category = 'EOFFICE_MERGED' and is_current = true`;
      check(Boolean(merged), 'มีไฟล์ชุดรวมเก็บเข้าระบบ');

      if (merged) {
        keys.push(merged.storage_key);
        const { body } = await downloadFile(merged.storage_key);
        check(body.subarray(0, 5).toString('latin1') === '%PDF-', 'ไฟล์ที่ได้เป็น PDF จริง');
        const doc = await PDFDocument.load(body);
        const want = 3 + lockedPages;
        check(doc.getPageCount() === want,
          `รวมหน้าครบทุกไฟล์ (${doc.getPageCount()} หน้า จากที่ควรได้ ${want})`);
        check(merged.file_name.includes(jobNo), `ตั้งชื่อไฟล์ตามเลขงาน (${merged.file_name})`);
      }

      check(message.includes('Final Invoice'),
        'ชุดที่รวมมี Final Invoice อยู่ด้วยโดยไม่ต้องแปลงเอง');

      if (merged && lockedPages) {
        // หัวใจของบั๊กเดิม: ไฟล์ที่ถูกล็อกเคยถูกคัดลอกมาเป็นหน้าขาว
        const text = await textPerPage((await downloadFile(merged.storage_key)).body);
        const blank = text.filter((t) => t.length === 0).length;
        check(blank === 0, `ทุกหน้าในชุดมีเนื้อหาจริง ไม่มีหน้าขาว (ว่าง ${blank} หน้า)`);
        check(text.some((t) => t.includes('EVERGREEN') || t.length > 500),
          'เนื้อของไฟล์สายเรือที่ถูกล็อกยังอยู่ครบหลังรวม');
      }

      const { message: msg2 } = await merge(jobId);
      check(msg2.includes('4 ชิ้น'), `รวมได้ครบ 4 ชิ้นรวม Final Invoice ("${msg2.slice(0, 56)}")`);

      const [m2] = await sql<{ storage_key: string; version: number }[]>`
        select storage_key, version from files
        where job_id = ${jobId} and category = 'EOFFICE_MERGED' and is_current = true`;
      keys.push(m2.storage_key);
      check(m2.version === 2, `รวมใหม่แล้วขึ้นเป็นเวอร์ชัน ${m2.version} ไม่ทับของเดิม`);
      const doc2 = await PDFDocument.load((await downloadFile(m2.storage_key)).body);
      check(doc2.getPageCount() === 3 + lockedPages,
        `ชุดใหม่มี ${doc2.getPageCount()} หน้า (ควรได้ ${3 + lockedPages})`);
    }

    /* ========= 4. อัปโหลด Final Invoice แล้วต้องยังไม่ย้ายเอง ========= */
    console.log('\n4. อัปโหลด Final Invoice · ตัวเลขเตือนบนแท็บ');

    const invoiceDoc = await PDFDocument.create();
    invoiceDoc.addPage([595, 842]).drawText('FINAL INVOICE', { x: 60, y: 700, size: 20 });
    const invoiceBytes = Buffer.from(await invoiceDoc.save());

    const body = new FormData();
    body.set('jobId', jobId);
    body.set('category', 'FINAL_INVOICE');
    body.set('file', new File([new Uint8Array(invoiceBytes)], 'fn.pdf', { type: 'application/pdf' }));
    const up = await fetch(`${BASE}/api/files/upload`, { method: 'POST', headers: { cookie }, body });
    const upBody = (await up.json()) as { ok?: boolean; detail?: string };
    check(up.status === 200 && upBody.ok === true,
      `อัปโหลดผ่านเส้นทางที่บอก % ได้ (HTTP ${up.status} ${upBody.detail ?? ''})`);

    const [stored] = await sql<{ file_name: string; version: number }[]>`
      select file_name, version from files
      where job_id = ${jobId} and category = 'FINAL_INVOICE' and is_current = true`;
    check(stored?.file_name === 'fn.pdf', 'ไฟล์เข้าระบบเป็นเวอร์ชันปัจจุบัน');
    if (stored) {
      const [k] = await sql<{ storage_key: string }[]>`
        select storage_key from files where job_id = ${jobId}
          and category = 'FINAL_INVOICE' and is_current = true`;
      keys.push(k.storage_key);
    }

    const [fnAfter] = await sql<{ n: number }[]>`
      select count(*)::int as n from approvals
      where job_id = ${jobId} and approval_type = 'FN' and status = 'PENDING'`;
    check(fnAfter.n === 0, 'อัปโหลดแล้วยังไม่ส่งอนุมัติเอง ต้องรอกดปุ่มก่อน');

    const pendingPage = await get('/pending');
    check(/small class="count">\d+</.test(pendingPage), 'แท็บงานคงค้างมีตัวเลขเตือนจำนวนรายการ');

    /* ========= 5. รูปแบบวันที่ · Master Data · ปุ่มที่ต้องหายไป ========= */
    console.log('\n5. วันที่ · Master Data · ปุ่มที่เอาออก');

    // ปีพุทธศักราชต้องมีเฉพาะในคำร้อง ที่อื่นเป็น ค.ศ. dd/mm/yyyy ทั้งหมด
    const thisYear = new Date().getFullYear();
    const buddhist = new RegExp(`\b(${thisYear + 543}|${thisYear + 542})\b`);
    for (const path of ['/pending', '/jobs', '/fah/do', '/overview', '/automation']) {
      const html = await get(path);
      const body = html.slice(html.indexOf('<main'));
      check(!buddhist.test(body), `${path} ไม่มีปี พ.ศ. ปนมา`);
    }
    const anyDate = await get('/jobs');
    check(/\d{2}\/\d{2}\/\d{4}/.test(anyDate), 'วันที่แสดงเป็น dd/mm/yyyy');

    // Master Data ต้องเพิ่มได้ทุกหัวข้อ
    const types = ['shippers', 'consignees', 'notify', 'people', 'ports', 'terminals',
      'jobTypes', 'partners', 'loadingTypes', 'containerTypes', 'packageTypes', 'settings'];
    let addable = 0;
    for (const t of types) {
      const html = await get(`/master?type=${t}`);
      if (/>เพิ่ม /.test(html)) addable += 1;
    }
    check(addable === types.length, `Master Data กดเพิ่มได้ ${addable}/${types.length} หัวข้อ`);

    // ปุ่มที่สั่งให้เอาออก
    const draftFah = await get('/fah/draft');
    check(!draftFah.includes('บันทึกเลขใบขน'), 'ไม่มีปุ่มบันทึกเลขใบขนแล้ว');
    const edoc2 = await get('/pending?tab=edoc');
    check(!edoc2.includes('อัปโหลดคำร้องที่พิมพ์'), 'ไม่มีปุ่มอัปโหลดคำร้องแล้ว');
    const blTab = await get('/pending?tab=bl');
    check(blTab.includes('DEM / DET') && !blTab.includes('Last Date of DEM'),
      'แท็บ BL แสดง DEM / DET แทนวันสุดท้าย');
    check(!/<button[^>]*type="submit"[^>]*>ค้นหา<\/button>/.test(blTab)
      || blTab.includes('visually-hidden'), 'ปุ่มค้นหาบนตารางถูกซ่อนแล้ว');

    /* ========= 6. เพิ่ม Master Data · สองปุ่มของ Invoice DO ========= */
    console.log('\n6. Master Data · Invoice DO');

    const masterPage = await get('/master?type=partners');
    const addSpec = findForm(masterPage, 'saveMasterRecord', 'partners');
    check(Boolean(addSpec), 'ฟอร์มเพิ่ม Master Data ผูกกับคำสั่งถูกตัว');
    if (addSpec) {
      const partnerName = `ZZ-PARTNER-${randomBytes(3).toString('hex').toUpperCase()}`;
      const res = await post('/master', addSpec, { name: partnerName, code: '' });
      const [made] = await sql<{ code: string; is_active: boolean }[]>`
        select code, is_active from master_records
        where type = 'partners' and name = ${partnerName}`;
      check(res.status < 400 && Boolean(made), 'เพิ่ม Partner ใหม่เข้า Master Data ได้');
      check(/^PTN\d{4}$/.test(made?.code ?? ''), `ระบบรันรหัสให้เอง (${made?.code})`);

      // ชื่อซ้ำต้องถูกปฏิเสธ
      const dup = await post('/master', addSpec, { name: partnerName, code: '' });
      const dupMsg = decodeURIComponent((dup.headers.get('location') ?? '').split('err=')[1] ?? '');
      check(dupMsg.includes('อยู่ในหัวข้อนี้แล้ว'), `กันชื่อซ้ำได้ ("${dupMsg}")`);

      // ใช้ Partner ตัวนี้กับหน้า Invoice DO — ปุ่มบันทึกอย่างเดียวต้องไม่นับว่าส่งแล้ว
      const [partner] = await sql<{ id: string }[]>`
        select id from master_records where type = 'partners' and name = ${partnerName}`;
      await sql`update jobs set status = 'AN_APPROVED' where id = ${jobId}`;
      const doPage = await get('/fah/do');
      const doSpec = findForm(doPage, 'saveDoHandoff', jobId);
      check(Boolean(doSpec), 'หน้า Invoice DO มีฟอร์มของงานนี้');
      if (doSpec) {
        await post('/fah/do', doSpec, {
          eta: '2026-09-01', partnerId: partner.id, sendToPartner: '0',
        });
        const [h1] = await sql<{ sent_at: string | null }[]>`
          select sent_at from do_handoffs where job_id = ${jobId}`;
        check(h1 && h1.sent_at === null, 'กดบันทึกอย่างเดียวแล้วยังไม่นับว่าส่ง Partner');

        const [j1] = await sql<{ eta_is_official: boolean; release_partner: string }[]>`
          select eta_is_official, release_partner from jobs where id = ${jobId}`;
        check(j1.eta_is_official === true, 'บันทึกแล้ว ETA ขึ้นเป็น official (OFC)');
        check(j1.release_partner === partnerName, `เก็บชื่อ Partner ที่เลือก (${j1.release_partner})`);

        await post('/fah/do', doSpec, {
          eta: '2026-09-01', partnerId: partner.id, sendToPartner: '1',
        });
        const [h2] = await sql<{ sent_at: string | null }[]>`
          select sent_at from do_handoffs where job_id = ${jobId}`;
        check(Boolean(h2?.sent_at), 'กดส่ง Partner แล้วบันทึกเวลาที่ส่งไว้');
      }

      await sql`delete from master_records where type = 'partners' and name = ${partnerName}`;
    }

    /* ========= 7. ปุ่มปิดแผง · ใบขน PDF · ฟอนต์ Cambria ========= */
    console.log('\n7. ปิดแผงหลังบันทึก · ใบขน PDF · ฟอนต์ Final Invoice');

    // ฟอร์มในแผงต้องไม่ติด data-keep-open ยกเว้นฟอร์มอัปโหลดที่จัดการเอง
    const edocForms = await get('/pending?tab=edoc');
    const keepOpen = (edocForms.match(/data-keep-open/g) ?? []).length;
    const popovers = (edocForms.match(/class="popover/g) ?? []).length;
    check(popovers > 0, `มีแผงกรอกข้อมูลบนหน้า (${popovers} แผง)`);
    check(keepOpen < popovers, `มีเฉพาะฟอร์มอัปโหลดที่กันไม่ให้ปิดเอง (${keepOpen}/${popovers})`);

    // แท็บ Draft ต้องไม่มีปุ่มเปลี่ยนไฟล์แล้ว
    const draftTab = await get('/pending?tab=draft');
    check(!draftTab.includes('เปลี่ยนไฟล์'), 'แท็บ Draft ไม่มีปุ่มเปลี่ยนไฟล์แล้ว');

    // ใบขนที่ปุ่มจำลองสร้างต้องเป็น PDF
    const { renderCustomsEntryPdf } = await import('../src/lib/customs-pdf');
    const entryPdf = await renderCustomsEntryPdf({
      entryNo: 'A2608199000001', refNo: 'QELSTEST', jobNo, blNo: 'ZZFLOWBL01',
    });
    check(entryPdf.subarray(0, 5).toString('latin1') === '%PDF-', 'ใบขนจำลองออกมาเป็น PDF');
    const entryText = (await textPerPage(entryPdf)).join('');
    check(entryText.includes('A2608199000001'), 'ใบขนมีเลขที่ถูกต้อง');
    check(entryText.includes('ใบขนสินค้าขาเข้า'), 'ใบขนมีหัวเรื่องภาษาไทย');

    // Final Invoice ต้องฝังฟอนต์ Cambria
    const [fnPdf] = await sql<{ storage_key: string }[]>`
      select storage_key from files
      where job_id = ${jobId} and category = 'FINAL_INVOICE_PDF' and is_current = true`;
    if (fnPdf) {
      const raw = (await downloadFile(fnPdf.storage_key)).body.toString('latin1');
      check(/Cambria/i.test(raw), 'Final Invoice ที่แปลงแล้วใช้ฟอนต์ Cambria');
    }

    // หน้า Invoice DO ต้องมีครบทุกช่องและเรียงน้อยไปมาก
    const doPage2 = await get('/fah/do');
    for (const label of ['ETA official', 'วันที่ขนย้าย', 'Terminal', 'Port of Discharge',
      'Port Release Partner']) {
      check(doPage2.includes(label), `หน้า Invoice DO มีช่อง ${label}`);
    }
  } finally {
    await cleanup();
  }

  const [left] = await sql<{ n: number }[]>`
    select count(*)::int as n from jobs where job_no like ${`${TEST_PREFIX}%`}`;
  check(left.n === 0, 'ลบงานทดสอบออกหมดแล้ว');

  await sql.end();
  console.log(failed ? `\nมี ${failed} ข้อที่ไม่ผ่าน` : '\nPASS: ค้นหา · วงจร Draft · รวมชุด E-Office ทำงานครบ');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
