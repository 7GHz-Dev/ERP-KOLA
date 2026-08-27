/**
 * ทดสอบว่า "กดปุ่มแล้วมีผลจริง"
 *
 * ยิงฟอร์มแบบเดียวกับที่เบราว์เซอร์ยิงตอนไม่มี JavaScript คือ POST multipart
 * พร้อมช่อง $ACTION_ID ที่ Next ฝังไว้ในฟอร์ม ถ้าโครงสร้าง HTML ผิด เช่นฟอร์ม
 * ซ้อนฟอร์ม ช่องนี้จะหายไปและปุ่มจะกลายเป็นปุ่มค้นหา เทสต์นี้จับกรณีนั้นได้
 *
 * สร้างงานทดสอบของตัวเองแล้วลบทิ้งตอนจบ ไม่ไปยุ่งกับงานจริง
 * (ตอนแรกใช้งานจริงที่ค้างอยู่ พอผู้ใช้กดอนุมัติจนคิวว่าง เทสต์ก็หาฟอร์มไม่เจอ)
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const BASE = 'http://localhost:3000';
const TEST_PREFIX = 'ZZ-TEST-';

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

function multipart(spec: FormSpec) {
  const boundary = `----kola${randomBytes(8).toString('hex')}`;
  let body = `--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${spec.actionId}"\r\n\r\n\r\n`;
  for (const [name, value] of Object.entries(spec.fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function main() {
  const { encodeSession } = await import('../src/lib/session-token');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
  let failed = 0;
  const check = (ok: boolean, label: string) => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ผ่าน' : 'พัง '} ${label}`);
  };

  // กวาดของค้างจากรอบก่อนที่อาจพังกลางคัน
  await sql`delete from jobs where job_no like ${`${TEST_PREFIX}%`}`;

  const [user] = await sql<{
    id: string; username: string; display_name: string; must_change_password: boolean;
  }[]>`select id, username, display_name, must_change_password from users
       where is_active = true order by role = 'ADMIN' desc limit 1`;

  const sid = `ACT-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await sql`insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
            values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')},
                    ${user.id}, ${expiresAt}, now())`;
  const cookie = `kola_session=${encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: 'ADMIN', mcp: user.must_change_password, exp: expiresAt.getTime(),
  })}`;

  // งานทดสอบ — ยังไม่มีรายการอนุมัติ จึงโผล่ในแท็บ "รอส่งอนุมัติ"
  const jobId = `JOB-${TEST_PREFIX}${randomBytes(5).toString('hex').toUpperCase()}`;
  const jobNo = `${TEST_PREFIX}${randomBytes(3).toString('hex').toUpperCase()}`;
  await sql`insert into jobs (id, job_no, status, bl_no, source_type)
            values (${jobId}, ${jobNo}, 'WAITING_ENTER_BL', 'ZZTESTBL0001', 'AN')`;

  const cleanup = async () => {
    await sql`delete from jobs where id = ${jobId}`;
    await sql`delete from sessions where id = ${sid}`;
  };

  try {
    const page = await (await fetch(`${BASE}/pending`, { headers: { cookie } })).text();
    const spec = findForm(page, 'requestApproval', jobId);
    check(Boolean(spec) && page.includes('ส่งอนุมัติ'),
      'หน้างานคงค้างมีฟอร์ม "ส่งอนุมัติ" ที่ยิงได้จริง');
    if (!spec) {
      console.log('\nไม่พบฟอร์มของงานทดสอบ — HTML อาจผิดโครงสร้าง (เช่นฟอร์มซ้อนฟอร์ม)');
      await cleanup();
      await sql.end();
      process.exit(1);
    }

    /* ---------- 1. กดส่งอนุมัติแล้วข้อมูลต้องเปลี่ยนจริง ---------- */

    const first = multipart(spec);
    const res = await fetch(`${BASE}/pending`, {
      method: 'POST',
      headers: { cookie, 'content-type': first.contentType },
      body: first.body,
      redirect: 'manual',
    });
    check(res.status < 400, `เซิร์ฟเวอร์รับคำสั่ง (HTTP ${res.status})`);

    const [approval] = await sql<{ id: string; status: string }[]>`
      select id, status from approvals where job_id = ${jobId}`;
    check(Boolean(approval), 'มีรายการรออนุมัติเกิดขึ้นจริงในฐานข้อมูล');
    check(approval?.status === 'PENDING', 'สถานะรายการใหม่เป็น PENDING');

    const [job] = await sql<{ status: string }[]>`select status from jobs where id = ${jobId}`;
    check(job.status === 'WAITING_AN_APPROVAL', `สถานะงานเปลี่ยนเป็นรออนุมัติ (${job.status})`);

    const [hist] = await sql<{ n: number }[]>`
      select count(*)::int as n from status_history where job_id = ${jobId}`;
    check(hist.n === 1, 'บันทึกไทม์ไลน์ไว้ 1 รายการ');

    /* ---------- 2. กดซ้ำต้องได้ข้อความ ไม่ใช่หน้า 500 ---------- */

    const again = multipart(spec);
    const dup = await fetch(`${BASE}/pending`, {
      method: 'POST',
      headers: { cookie, 'content-type': again.contentType },
      body: again.body,
      redirect: 'manual',
    });
    const shown = decodeURIComponent((dup.headers.get('location') ?? '').split('err=')[1] ?? '');
    check(dup.status >= 300 && dup.status < 400, `กดซ้ำแล้วพากลับหน้าเดิม ไม่ใช่ 500 (HTTP ${dup.status})`);
    check(shown === 'รายการนี้รออนุมัติอยู่แล้ว', `ผู้ใช้เห็นข้อความว่า "${shown}"`);

    const [after] = await sql<{ n: number }[]>`
      select count(*)::int as n from approvals where job_id = ${jobId}`;
    check(after.n === 1, 'กดซ้ำแล้วไม่เกิดรายการซ้ำในฐานข้อมูล');

    /* ---------- 3. คนที่ไม่ได้ล็อกอินกดไม่ได้ ---------- */

    const anon = multipart(spec);
    const anonRes = await fetch(`${BASE}/pending`, {
      method: 'POST',
      headers: { 'content-type': anon.contentType },
      body: anon.body,
      redirect: 'manual',
    });
    const anonMessage = decodeURIComponent(
      (anonRes.headers.get('location') ?? '').split('err=')[1] ?? '',
    );
    check(anonMessage.includes('เข้าสู่ระบบ'), `คนที่ไม่ได้ล็อกอินถูกปฏิเสธ ("${anonMessage}")`);

    /* ---------- 4. Drawer เปิดงานนี้ได้ ---------- */

    const drawer = await fetch(`${BASE}/job/${jobId}`, { headers: { cookie } });
    const drawerHtml = await drawer.text();
    check(drawer.status === 200 && drawerHtml.includes(jobNo), 'เปิดสรุปงานของงานนี้ได้');
    check(drawerHtml.includes('ข้อมูลงาน (Job Detail)'), 'สรุปงานมีหัวข้อชุดเดียวกับระบบเดิม');
  } finally {
    await cleanup();
  }

  const [leftover] = await sql<{ n: number }[]>`
    select count(*)::int as n from jobs where job_no like ${`${TEST_PREFIX}%`}`;
  check(leftover.n === 0, 'ลบงานทดสอบออกหมดแล้ว ไม่เหลือค้างในระบบ');

  await sql.end();
  console.log(failed ? `\nมี ${failed} ข้อที่ไม่ผ่าน` : '\nPASS: กดปุ่มแล้วมีผลจริง และกันคนนอกได้');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
