import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';
import { currentUser } from '@/lib/auth';
import { downloadFile } from '@/lib/storage';
import { xlsxToPdf } from '@/lib/xlsx-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * เปิดดูไฟล์ Excel (.xlsx) เป็น PDF ในหน้า — ไม่ต้องโหลดลงเครื่อง (Invoice สินค้า ฯลฯ)
 *
 * แปลงตอนเปิด ไม่เก็บไฟล์ PDF (ราว 1 วินาทีต่อไฟล์) · ตรวจล็อกอินแบบเดียวกับ /files/[id]
 * แปลงไม่ได้ตอบ 422 พร้อมข้อความ — แผงดูไฟล์แสดงลิงก์ให้เปิด/ดาวน์โหลดไฟล์ Excel แทน
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });

  const { id } = await params;
  const [record] = await db.select({ storageKey: files.storageKey, fileName: files.fileName })
    .from(files).where(eq(files.id, id)).limit(1);
  if (!record) return new NextResponse('ไม่พบไฟล์', { status: 404 });
  if (!/\.xlsx$/i.test(record.fileName)) return new NextResponse('แปลงเป็น PDF ได้เฉพาะไฟล์ .xlsx', { status: 415 });
  if (record.storageKey.startsWith('drive:')) return new NextResponse('ไฟล์นี้ยังอยู่ที่ Google Drive', { status: 409 });

  try {
    const { body } = await downloadFile(record.storageKey);
    const pdf = await xlsxToPdf(Buffer.from(body), { anySheet: true });
    if (!pdf) return new NextResponse('ไฟล์นี้ไม่มีข้อมูลที่แสดงเป็น PDF ได้', { status: 422 });
    const name = record.fileName.replace(/\.xlsx$/i, '.pdf');
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    return new NextResponse(`แปลงไฟล์ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, { status: 422 });
  }
}
