import { cargoReader, invoiceFile, json } from '@/lib/cargo-invoice/http';
import { xlsxToPdf } from '@/lib/xlsx-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ไฟล์ Invoice ของผู้ขายที่เป็น Excel → PDF สำหรับเปิดดูข้างฟอร์ม (Create Cargo Invoice แบบ NORMAL)
 * รูปและ PDF เบราว์เซอร์เปิดเองได้ ไม่ต้องผ่านตรงนี้ · ไม่เก็บไฟล์
 */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const file = await invoiceFile(await request.formData());
  if (typeof file === 'string') return json({ error: file }, 400);
  try {
    const pdf = await xlsxToPdf(file.bytes);
    if (!pdf) return json({ error: 'แปลงไฟล์นี้เป็น PDF ไม่ได้ — ไฟล์ไม่ได้ตั้งขอบเขตการพิมพ์และไม่มีคำว่า INVOICE ในหัวใบ เปิดไฟล์ใน Excel ดูแทน' }, 400);
    return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch (e) {
    return json({ error: `แปลงไฟล์ไม่ได้: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
}
