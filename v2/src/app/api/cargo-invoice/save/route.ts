import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { logActivity } from '@/lib/actions/common';
import { storeInvoicePdf } from '@/lib/eoffice-bundle';
import { storeJobFileVersion } from '@/lib/job-files';
import { parseCargoInvoice } from '@/lib/cargo-invoice/parse';
import { allRules, lookup, TARIFF_CODE } from '@/lib/cargo-invoice/tariff';
import { writeSummary } from '@/lib/cargo-invoice/write';
import { cargoUser, invoiceFile, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ขั้น 4: บันทึกเป็น Final Invoice ของงาน
 *
 * ไม่เชื่อรายการรถที่หน้าเว็บส่งมา — อ่านไฟล์ใหม่ที่เซิร์ฟเวอร์ แล้วตรวจพิกัดที่เลือกกับกฎอีกรอบ
 * พิกัดต้องมาจากกฎเสมอ (ตรงตัวเดียว หรือเลือกจากหลายตัวที่ตรง) ไม่มีการพิมพ์พิกัดลอย ๆ
 * จากนั้นเขียนตารางสรุปลงไฟล์ เก็บเป็นเวอร์ชันใหม่ของ FINAL_INVOICE และแปลง PDF สำหรับชุด E-Office
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

  const inv = await parseCargoInvoice(file.bytes);
  if (inv.errors.length) return json({ error: `ไฟล์มีปัญหา: ${inv.errors[0]}` }, 400);
  // ใบที่ช่อง B/L ว่าง ใช้ BL ของงานที่เลือก — worker สร้าง Draft ต้องมี BL ในตารางสรุป (P14)
  if (!inv.blNo) {
    if (!job.blNo) return json({ error: `ใบนี้ไม่มีเลข BL และงาน ${job.jobNo} ก็ยังไม่มีเลข BL — ใส่ BL ให้งานก่อน` }, 400);
    inv.blNo = job.blNo.replace(/\s/g, '').toUpperCase();
  }
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

  const bytes = await writeSummary(file.bytes, inv, tariffs);
  const stored = await storeJobFileVersion({
    jobId: job.id, category: 'FINAL_INVOICE', bytes, fileName: file.name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    userId: user.id, note: `สร้างจาก Create Cargo Invoice · ${inv.pattern} · ${inv.cars.length} คัน`,
    changeReason: 'บันทึกใหม่จาก Create Cargo Invoice',
  });

  // PDF สำหรับรวมชุด E-Office — แปลงไม่ได้ก็ไม่ทำให้การบันทึกล้ม ตอนรวมชุดจะลองใหม่และแจ้งเหตุผล
  let pdf = true;
  try { pdf = Boolean(await storeInvoicePdf(job.id, user.id, bytes)); } catch { pdf = false; }

  await logActivity(user.id, stored.current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', stored.id,
    { jobId: job.id, category: 'FINAL_INVOICE', version: stored.version, source: 'CARGO_INVOICE', cars: inv.cars.length });
  revalidatePath('/pending');
  revalidatePath('/fah/fn');

  return json({ ok: true, jobId: job.id, jobNo: job.jobNo, fileId: stored.id, version: stored.version, pdf });
}
