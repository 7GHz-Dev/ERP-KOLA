'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveSession } from '@/lib/auth';
import { stopMonitorLease } from '@/lib/customs-monitor';
import {
  CUSTOMS_WORKER_MODE, DRAFT_WORKER_MODE, setWorkerSettings, stopModeWorkers,
} from '@/lib/worker-status';
import { logActivity, runAction } from './common';

/**
 * ANN สั่ง worker กรอกเว็บจากหน้าแลก DO — worker อ่านค่าเหล่านี้กลับไปจากสัญญาณสถานะรอบถัดไป
 * ไม่ได้สั่งตรงถึงเครื่อง (เว็บติดต่อเครื่องในออฟฟิศเองไม่ได้) จึงมีผลภายในไม่กี่วินาที
 */

async function setBackgroundImpl(formData: FormData) {
  const user = await requireActiveSession(['ANN']);
  const background = formData.get('background') === '1';
  await setWorkerSettings({ background });
  await logActivity(user.id, 'SET_WORKER_BACKGROUND', 'WORKER', 'web', { background });
  revalidatePath('/do-exchange');
}

async function stopImpl() {
  const user = await requireActiveSession(['ANN']);
  await setWorkerSettings({ stopAt: new Date().toISOString() });
  await logActivity(user.id, 'STOP_WORKER', 'WORKER', 'web', {});
  revalidatePath('/do-exchange');
}

/**
 * ปิด worker สร้าง Draft / ปิดเช็คสถานะใบขน จากหน้าเว็บ — ปิดหลังจบงาน/รอบที่ทำอยู่ ไม่ตัดกลางคัน
 * เช็คสถานะ: ยึด lease ด้วย (ตัว monitor รุ่นเก่าที่ยังไม่อ่านค่าปิดก็ปิดตาม)
 */
async function stopModeImpl(formData: FormData) {
  const mode = String(formData.get('mode') ?? '');
  if (mode !== DRAFT_WORKER_MODE && mode !== CUSTOMS_WORKER_MODE) throw new Error('ไม่รู้จัก worker นี้');
  const user = await requireActiveSession(mode === DRAFT_WORKER_MODE ? ['PAINT'] : ['PAINT', 'FAH']);
  await stopModeWorkers(mode);
  if (mode === CUSTOMS_WORKER_MODE) await stopMonitorLease();
  await logActivity(user.id, 'STOP_WORKER', 'WORKER', mode, {});
  revalidatePath('/automation');
  revalidatePath('/pending');
  revalidatePath('/fah/draft');
}

export async function setWorkerBackground(formData: FormData) { return runAction(() => setBackgroundImpl(formData)); }
export async function stopModeWorker(formData: FormData) { return runAction(() => stopModeImpl(formData)); }
export async function stopWorker() { return runAction(() => stopImpl()); }
