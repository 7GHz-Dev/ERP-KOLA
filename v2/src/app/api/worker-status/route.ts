import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getWorkerSettings, onlineWorkers } from '@/lib/worker-status';

export const dynamic = 'force-dynamic';

/** worker กรอกเว็บที่ออนไลน์อยู่ กับค่าตั้งปัจจุบัน — แผงสถานะบนหน้าแลก DO ถามเป็นระยะ */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  const [workers, settings] = await Promise.all([onlineWorkers(), getWorkerSettings()]);
  return NextResponse.json({ ok: true, workers, settings }, { headers: { 'Cache-Control': 'no-store' } });
}
