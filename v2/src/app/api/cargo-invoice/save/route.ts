import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { logActivity } from '@/lib/actions/common';
import { storeInvoicePdf } from '@/lib/eoffice-bundle';
import { storeJobFileVersion } from '@/lib/job-files';
import { enginePrefix, existingEngineNumber } from '@/lib/cargo-invoice/engine-format';
import { buildFinalInvoice, invoiceBl, readWithEdits } from '@/lib/cargo-invoice/final';
import { assignEngineNumbers } from '@/lib/engine-numbers';
import { allRules, lookup, TARIFF_CODE } from '@/lib/cargo-invoice/tariff';
import { cargoUser, invoiceFile, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ขั้น 4: บันทึกเป็น Final Invoice ของงาน
 *
 * ไม่เชื่อรายการรถที่หน้าเว็บส่งมา — อ่านไฟล์ใหม่ที่เซิร์ฟเวอร์ ใส่เฉพาะค่าที่แก้ในตาราง (edits) แล้วตรวจค่าและพิกัดอีกรอบ
 * พิกัดต้องมาจากกฎเสมอ (ตรงตัวเดียว หรือเลือกจากหลายตัวที่ตรง) ไม่มีการพิมพ์พิกัดลอย ๆ
 * จากนั้นเขียนตารางสรุปลงไฟล์ เก็บเป็นเวอร์ชันใหม่ของ FINAL_INVOICE และแปลง PDF สำหรับชุด E-Office
 *
 * JAN TRADING จัดหน้า invoice ให้พร้อมพิมพ์ด้วย (jan-trading.ts): BL ของงาน · ออกเลขเครื่อง · ตัดแถว COLOR และค่าใช้จ่ายอื่น
 * เลข BL ใช้ของงานเสมอ — ต่อไปปุ่มนี้จะอยู่ในแถวงานที่ Pending job > 3. Final Invoice ซึ่งรู้งานอยู่แล้ว
 */
export async function POST(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const form = await request.formData();
  const file = await invoiceFile(form);
  if (typeof file === 'string') return json({ error: file }, 400);

  const jobId = String(form.get('jobId') ?? '');
  const [job] = await db.select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo, isArchived: jobs.isArchived })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || job.isArchived) return json({ error: 'ไม่พบงานที่จะบันทึก Final Invoice' }, 400);

  let read: Awaited<ReturnType<typeof readWithEdits>>;
  try { read = await readWithEdits(file.bytes, form.get('edits')); } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  const { inv, original } = read;
  if (inv.errors.length) return json({ error: `ไฟล์มีปัญหา: ${inv.errors[0]}` }, 400);
  const jan = inv.pattern === 'JAN TRADING';
  // ใบที่ช่อง B/L ว่าง ใช้ BL ของงานที่เลือก — worker สร้าง Draft ต้องมี BL ในตารางสรุป (P14)
  // JAN TRADING ใช้ BL ของงานเสมอ (เขียนลงช่อง B/L NO ของใบด้วย)
  inv.blNo = invoiceBl(inv, job.blNo);
  if (!inv.blNo) return json({ error: `ใบนี้ไม่มีเลข BL และงาน ${job.jobNo} ก็ยังไม่มีเลข BL — ใส่ BL ให้งานก่อน` }, 400);
  const bad = inv.cars.find((c) => c.problems.length);
  if (bad) return json({ error: `รถคันที่ ${bad.no} (${bad.chassis || '-'}) ข้อมูลไม่ครบ: ${bad.problems[0]}` }, 400);

  let chosen: unknown;
  try { chosen = JSON.parse(String(form.get('tariffs') ?? '[]')); } catch { chosen = null; }
  if (!Array.isArray(chosen) || chosen.length !== inv.cars.length) {
    return json({ error: 'จำนวนพิกัดไม่ตรงกับจำนวนรถในไฟล์ — กดดึงพิกัดใหม่อีกครั้ง' }, 400);
  }
  const rules = await allRules();
  const tariffs: string[] = [];
  for (const [i, car] of inv.cars.entries()) {
    const code = String(chosen[i] ?? '');
    const res = lookup(rules, car);
    const ok = TARIFF_CODE.test(code) && res.candidates.some((c) => c.code === code);
    if (!ok) {
      return json({
        error: res.status === 'missing'
          ? `รถคันที่ ${car.no} ${car.brand} ${car.model} ยังไม่มีพิกัด — เพิ่มพิกัดก่อนบันทึก`
          : `พิกัดของรถคันที่ ${car.no} ไม่ตรงกับกฎ — กดดึงพิกัดใหม่อีกครั้ง`,
      }, 400);
    }
    tariffs.push(code);
  }

  let engines: { issued: number; reused: number } | null = null;
  let numbers: string[] | null = null;
  if (jan) {
    // จัดหน้าด้วยเลขสมมติก่อน — ไฟล์ผิดรูปแบบจะได้รู้ก่อนออกเลขเครื่องจริง
    try {
      await buildFinalInvoice(file.bytes, { ...inv }, original, { tariffs, engineNumbers: null });
    } catch (e) {
      return json({ error: `จัดหน้า Final Invoice ไม่ได้: ${e instanceof Error ? e.message : String(e)}` }, 400);
    }
    const assigned = await assignEngineNumbers({
      jobId: job.id, blNo: inv.blNo, invoiceNo: inv.invoiceNo, sourceFile: file.name,
      cars: inv.cars.map((c) => ({ chassis: c.chassis, prefix: enginePrefix(c.engine), existing: existingEngineNumber(c.engine) })),
    });
    numbers = assigned.numbers;
    engines = { issued: assigned.issued, reused: assigned.reused };
  }
  const bytes = await buildFinalInvoice(file.bytes, inv, original, { tariffs, engineNumbers: numbers });
  const stored = await storeJobFileVersion({
    jobId: job.id, category: 'FINAL_INVOICE', bytes, fileName: file.name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    userId: user.id, note: `สร้างจาก Create Cargo Invoice · ${inv.pattern} · ${inv.cars.length} คัน${engines ? ` · เลขเครื่องใหม่ ${engines.issued}` : ''}`,
    changeReason: 'บันทึกใหม่จาก Create Cargo Invoice',
  });

  // PDF สำหรับรวมชุด E-Office — แปลงไม่ได้ก็ไม่ทำให้การบันทึกล้ม ตอนรวมชุดจะลองใหม่และแจ้งเหตุผล
  let pdf = true;
  try { pdf = Boolean(await storeInvoicePdf(job.id, user.id, bytes)); } catch { pdf = false; }

  await logActivity(user.id, stored.current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', stored.id,
    { jobId: job.id, category: 'FINAL_INVOICE', version: stored.version, source: 'CARGO_INVOICE', cars: inv.cars.length, engines });
  revalidatePath('/pending');
  revalidatePath('/fah/fn');

  return json({ ok: true, jobId: job.id, jobNo: job.jobNo, fileId: stored.id, version: stored.version, pdf, engines });
}
