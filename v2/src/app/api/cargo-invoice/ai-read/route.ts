import { logActivity } from '@/lib/actions/common';
import { AI_READ_ACTION } from '@/lib/usage-log';
import { xlsxToPdf } from '@/lib/xlsx-pdf';
import { aiReady, readInvoiceWithAi } from '@/lib/cargo-invoice/ai-read';
import { cargoReader, json } from '@/lib/cargo-invoice/http';
import { jobsForInvoice } from '@/lib/cargo-invoice/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * NORMAL: ให้ AI อ่านไฟล์ Invoice ของผู้ขาย (PDF · รูป · Excel ที่ระบบไม่รู้จักรูปแบบ) แล้วคืนค่าไว้เติมฟอร์ม
 * ไม่เขียนอะไรนอกจากบันทึกค่าใช้จ่าย AI (หน้า Monitor) · หางานจาก BL / เลขตู้ที่อ่านได้ให้ด้วย
 */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  if (!aiReady()) return json({ error: 'ยังไม่ได้ตั้งค่า AI (ANTHROPIC_API_KEY) — คีย์ข้อมูลเองจากไฟล์ด้านบน' }, 400);

  const blob = (await request.formData()).get('file');
  if (!(blob instanceof File) || !blob.size) return json({ error: 'ไม่พบไฟล์' }, 400);
  if (blob.size > 4 * 1024 * 1024) return json({ error: 'ไฟล์ใหญ่เกิน 4 MB — AI อ่านไม่ได้ คีย์เองจากไฟล์ด้านบน' }, 400);
  const ext = (/\.([a-z0-9]+)$/i.exec(blob.name)?.[1] ?? '').toLowerCase();
  let bytes = Buffer.from(await blob.arrayBuffer());
  let kind: 'pdf' | 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif';
  if (ext === 'pdf') kind = 'pdf';
  else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) kind = ext as typeof kind;
  else if (ext === 'xlsx') {
    const pdf = await xlsxToPdf(bytes);
    if (!pdf) return json({ error: 'แปลง Excel ให้ AI อ่านไม่ได้ — คีย์เองจากไฟล์ด้านบน' }, 400);
    bytes = Buffer.from(pdf);
    kind = 'pdf';
  } else return json({ error: 'AI อ่านได้เฉพาะ PDF · รูป (PNG/JPG/WEBP) · Excel (.xlsx)' }, 400);

  const started = Date.now();
  try {
    const { invoice, baht } = await readInvoiceWithAi(bytes, kind);
    await logActivity(user.id, AI_READ_ACTION, 'FILE', blob.name.slice(0, 120),
      { baht, ms: Date.now() - started, ok: true, doc: 'CARGO_INVOICE', cars: invoice.cars.length });
    const boxes = [...new Set(invoice.cars.map((c) => c.container).filter(Boolean))];
    const { jobs } = invoice.blNo || boxes.length ? await jobsForInvoice({ blNo: invoice.blNo, containers: boxes }) : { jobs: [] };
    return json({ invoice, jobs, baht });
  } catch (e) {
    await logActivity(user.id, AI_READ_ACTION, 'FILE', blob.name.slice(0, 120),
      { baht: 0, ms: Date.now() - started, ok: false, doc: 'CARGO_INVOICE' }).catch(() => undefined);
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
