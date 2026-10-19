import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { workerShot } from '@/lib/worker-status';

export const dynamic = 'force-dynamic';

/** ภาพหน้าจอสดของ worker ที่ทำงานเบื้องหลัง — ?worker=<ชื่อ> */
export async function GET(request: Request) {
  if (!(await currentUser())) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });
  const worker = new URL(request.url).searchParams.get('worker') ?? '';
  try {
    const { body } = await workerShot(worker);
    return new NextResponse(new Uint8Array(body), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new NextResponse('ยังไม่มีภาพ', { status: 404 });
  }
}
