import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { DRAFT_WORKER_MODE, getWorkerSettings, onlineWorkers } from '@/lib/worker-status';

export const dynamic = 'force-dynamic';

/** worker กรอกเว็บที่ออนไลน์อยู่ กับค่าตั้งปัจจุบัน — แผงสถานะบนหน้าแลก DO ถามเป็นระยะ */
export async function GET(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  // ?mode=draft = worker สร้าง Draft ใบขน (แท็บ Draft) · ไม่ระบุ = worker กรอกเว็บแลก DO
  const draft = new URL(request.url).searchParams.get('mode') === DRAFT_WORKER_MODE;
  const [workers, settings] = await Promise.all([
    onlineWorkers(draft ? { mode: DRAFT_WORKER_MODE } : { exceptMode: DRAFT_WORKER_MODE }),
    getWorkerSettings(),
  ]);
  return NextResponse.json({ ok: true, workers, settings }, { headers: { 'Cache-Control': 'no-store' } });
}
