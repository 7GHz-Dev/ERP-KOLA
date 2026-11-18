import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { buildFinalInvoice, invoiceBl, readWithEdits } from '@/lib/cargo-invoice/final';
import { runningInvoiceNo } from '@/lib/cargo-invoice/invoice-number';
import { cargoReader, invoiceFile, json } from '@/lib/cargo-invoice/http';
import { xlsxToPdf } from '@/lib/xlsx-pdf';
import { draftCsv } from '@/lib/cargo-invoice/draft-csv';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Preview FN Invoice ก่อนบันทึก — ประกอบไฟล์ทางเดียวกับปุ่มบันทึก (final.ts) แล้วแปลงเป็น PDF ส่งกลับ
 *
 * ไม่บันทึกอะไร ไม่ออกเลขเครื่อง (JAN TRADING แสดงเป็น xxxxxxx) — กดกี่ครั้งก็ได้
 * ยังไม่เลือกงานก็ดูได้ ช่อง B/L NO จะใช้เลขในใบ (ถ้ามี)
 * output=csv คืน CSV สำหรับ Draft ใบขนแทน PDF (เลขเครื่อง 0000000 จนกว่าจะบันทึก)
 */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const form = await request.formData();
  const file = await invoiceFile(form);
  if (typeof file === 'string') return json({ error: file }, 400);

  let read: Awaited<ReturnType<typeof readWithEdits>>;
  try { read = await readWithEdits(file.bytes, form.get('edits')); } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  const { inv, original } = read;
  if (inv.errors.length) return json({ error: `ไฟล์มีปัญหา: ${inv.errors[0]}` }, 400);

  const jobId = String(form.get('jobId') ?? '');
  const [job] = jobId ? await db.select({ blNo: jobs.blNo }).from(jobs).where(eq(jobs.id, jobId)).limit(1) : [];
  inv.blNo = invoiceBl(inv, job?.blNo);
  inv.invoiceNo = runningInvoiceNo(inv.pattern, form.get('invoiceNo')) ?? inv.invoiceNo;

  // พิกัดไม่พิมพ์ใน FN Invoice (อยู่ในตารางสรุปนอกขอบเขตการพิมพ์) — ยังไม่ได้ดึงพิกัดก็ Preview ได้
  let tariffs: string[] = [];
  try { tariffs = JSON.parse(String(form.get('tariffs') ?? '[]')); } catch { /* ไม่มีก็ได้ */ }
  tariffs = inv.cars.map((_, i) => String(tariffs[i] ?? ''));

  const asCsv = form.get('output') === 'csv';
  try {
    const bytes = await buildFinalInvoice(file.bytes, inv, original, {
      tariffs, engineNumbers: asCsv ? inv.cars.map(() => '0000000') : null,
    });
    if (asCsv) return json(await draftCsv(bytes));
    const pdf = await xlsxToPdf(bytes);
    if (!pdf) return json({ error: 'แปลง PDF ไม่ได้ — ไฟล์ไม่มีขอบเขตการพิมพ์ของหน้า invoice' }, 400);
    return new Response(new Uint8Array(pdf), {
      headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return json({ error: `สร้าง Preview ไม่ได้: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
}
