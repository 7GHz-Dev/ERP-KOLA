import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { onlineWorkers } from '@/lib/worker-status';

export const dynamic = 'force-dynamic';

/** worker กรอกเว็บที่ออนไลน์อยู่ — ปุ่มเปิด worker บนหน้าแลก DO ถามเป็นระยะ */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, workers: await onlineWorkers() }, { headers: { 'Cache-Control': 'no-store' } });
}
