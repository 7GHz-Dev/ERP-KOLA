import { parseCargoInvoice } from '@/lib/cargo-invoice/parse';
import { jobsForBl } from '@/lib/cargo-invoice/jobs';
import { cargoReader, invoiceFile, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** ขั้น 1-2: อ่านไฟล์ Invoice แล้วจัดเรียง + หางานที่ BL ตรงกัน  ไม่เขียนอะไร */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const file = await invoiceFile(await request.formData());
  if (typeof file === 'string') return json({ error: file }, 400);
  const invoice = await parseCargoInvoice(file.bytes);
  const jobs = invoice.blNo ? await jobsForBl(invoice.blNo) : [];
  return json({ invoice, jobs });
}
