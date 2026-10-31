import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { logActivity } from '@/lib/actions/common';
import { AGENT_VERSION } from '@/lib/agent-version';

export const dynamic = 'force-dynamic';

/**
 * ตัวติดตั้ง Windows ที่ใส่ WORKER_API_KEY ให้แล้ว — ผู้ใช้ไม่ต้องกรอกคีย์เอง
 *
 * ต้องล็อกอิน ERP ก่อนเท่านั้น เพราะคีย์นี้เปิดดูไฟล์เอกสารของงานผ่าน /api/worker ได้
 * ไฟล์ต้นแบบคือ public/install/windows-setup.cmd (มีแค่ข้อความแทนที่ ไม่มีคีย์ จึงอยู่ใน git และลิงก์สาธารณะได้)
 * อ่านต้นแบบผ่าน URL ของเว็บเอง เพราะไฟล์ใน public ไม่ได้ติดไปกับฟังก์ชันบน Vercel
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  const key = process.env.WORKER_API_KEY ?? '';
  if (!key || /'/.test(key)) return new NextResponse('ยังไม่ได้ตั้ง WORKER_API_KEY บนเซิร์ฟเวอร์', { status: 503 });

  const res = await fetch(new URL('/install/windows-setup.cmd', request.url), { cache: 'no-store' });
  if (!res.ok) return new NextResponse('โหลดไฟล์ติดตั้งไม่สำเร็จ', { status: 502 });
  const script = (await res.text()).replaceAll('__KOLA_WORKER_API_KEY__', key)
    .replaceAll('__KOLA_AGENT_VERSION__', AGENT_VERSION);

  await logActivity(user.id, 'DOWNLOAD_WINDOWS_SETUP', 'WORKER', 'draft', {});
  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="windows-setup.cmd"',
      'Cache-Control': 'no-store, private',
    },
  });
}
