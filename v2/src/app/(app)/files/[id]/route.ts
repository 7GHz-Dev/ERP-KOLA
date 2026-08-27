import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';
import { currentUser } from '@/lib/auth';
import { downloadFile } from '@/lib/storage';

/**
 * เปิดไฟล์แนบของงาน
 *
 * bucket เป็นแบบส่วนตัว ไฟล์จึงต้องผ่านเส้นทางนี้เท่านั้น
 * ตรวจว่าล็อกอินอยู่ก่อนเสมอ ไม่ปล่อยให้เดา URL แล้วโหลดเอกสารลูกค้าไปได้
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });

  const { id } = await params;
  const [record] = await db
    .select({
      storageKey: files.storageKey, fileName: files.fileName, mimeType: files.mimeType,
    })
    .from(files)
    .where(eq(files.id, id))
    .limit(1);

  if (!record) return new NextResponse('ไม่พบไฟล์', { status: 404 });

  if (record.storageKey.startsWith('drive:')) {
    return new NextResponse(
      'ไฟล์นี้ยังอยู่ที่ Google Drive ยังไม่ได้ย้ายเข้าระบบใหม่ (รัน npm run migrate:files)',
      { status: 409 },
    );
  }

  try {
    const { body, contentType } = await downloadFile(record.storageKey);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': record.mimeType || contentType,
        // inline เพื่อให้ PDF เปิดดูในเบราว์เซอร์ได้เลย ไม่ต้องดาวน์โหลดก่อน
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error: any) {
    return new NextResponse(`เปิดไฟล์ไม่สำเร็จ: ${error.message}`, { status: 502 });
  }
}
