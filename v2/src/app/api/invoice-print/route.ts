import { currentUser, roleAllows } from '@/lib/auth';
import { concatenateDoPdfs } from '@/lib/do-bundle-combine';
import { invoiceFilesFor } from '@/lib/queries/invoice-print';
import { downloadFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * รวมไฟล์ Invoice DO ที่เลือกเป็น PDF เดียวเพื่อสั่งพิมพ์
 *
 * ไม่เก็บไฟล์ลงระบบ เพราะเป็นของใช้ครั้งเดียวสำหรับพิมพ์ ไม่ใช่เอกสารของงาน
 * ต่างจากการรวมชุดแลก DO ที่ต้องเก็บไว้เป็นหลักฐานและใช้ต่อในขั้นถัดไป
 *
 * ?id=... ใส่ซ้ำได้หลายตัว เรียงตามลำดับที่ส่งมา
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (!roleAllows(user.role, ['ACCOUNT'])) {
    return new Response('คุณไม่มีสิทธิ์ดำเนินการนี้', { status: 403 });
  }

  const ids = new URL(request.url).searchParams.getAll('id').filter(Boolean);
  if (!ids.length) return new Response('ยังไม่ได้เลือกรายการ', { status: 400 });
  if (ids.length > 100) return new Response('เลือกได้ไม่เกิน 100 รายการต่อครั้ง', { status: 400 });

  const rows = await invoiceFilesFor(ids);
  if (!rows.length) return new Response('ไม่พบไฟล์ที่เลือก', { status: 404 });

  /*
   * รวมได้เฉพาะ PDF — Invoice DO บางใบเป็นรูปถ่าย ซึ่งเอามาต่อเป็นหน้า PDF ไม่ได้ตรง ๆ
   * บอกให้ผู้ใช้รู้ว่าใบไหนต้องเปิดพิมพ์เอง ดีกว่ารวมแล้วหน้าหายไปเงียบ ๆ
   */
  const notPdf = rows.filter((r) => r.mimeType && !r.mimeType.includes('pdf'));
  if (notPdf.length) {
    return new Response(
      `รวมไม่ได้ ${notPdf.length} ใบเพราะไม่ใช่ไฟล์ PDF: `
      + `${notPdf.map((r) => r.blNo ?? r.fileName).join(', ')} — กรุณาเปิดพิมพ์แยก`,
      { status: 400 },
    );
  }

  try {
    const sources: Uint8Array[] = [];
    for (const row of rows) sources.push((await downloadFile(row.storageKey)).body);
    const bytes = await concatenateDoPdfs(sources);

    const name = `Invoice DO ${rows.length} ใบ.pdf`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        // inline เพื่อให้เปิดในแท็บแล้วสั่งพิมพ์ได้เลย ไม่ต้องโหลดลงเครื่องก่อน
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(
      `รวมไฟล์ไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      { status: 500 },
    );
  }
}
