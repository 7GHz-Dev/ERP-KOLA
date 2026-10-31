import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import {
  CUSTOMS_WORKER_MODE, DRAFT_WORKER_MODE, getWorkerSettings, NON_WEB_MODES, onlineWorkers,
} from '@/lib/worker-status';
import { readRefresh } from '@/lib/customs-monitor';

export const dynamic = 'force-dynamic';

/** worker กรอกเว็บที่ออนไลน์อยู่ กับค่าตั้งปัจจุบัน — แผงสถานะบนหน้าแลก DO ถามเป็นระยะ */
export async function GET(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  /*
   * ?mode=draft   = worker สร้าง Draft ใบขน (แท็บ Draft)
   * ?mode=customs = ตัว monitor ใบขน (คิว Automation > รอสร้างใบขน)
   * ไม่ระบุ       = worker กรอกเว็บแลก DO
   */
  const mode = new URL(request.url).searchParams.get('mode');
  const own = mode === DRAFT_WORKER_MODE || mode === CUSTOMS_WORKER_MODE ? mode : null;
  const [workers, settings, refresh] = await Promise.all([
    onlineWorkers(own ? { mode: own } : { exceptMode: NON_WEB_MODES }),
    getWorkerSettings(),
    // ตัว monitor: คำขอ Refresh ล่าสุด — ปุ่ม Refresh ดูว่าเช็กเสร็จหรือยัง
    own === CUSTOMS_WORKER_MODE ? readRefresh() : Promise.resolve(null),
  ]);
  return NextResponse.json({ ok: true, workers, settings, refresh }, { headers: { 'Cache-Control': 'no-store' } });
}
