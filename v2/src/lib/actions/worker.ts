'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveSession } from '@/lib/auth';
import { setWorkerSettings } from '@/lib/worker-status';
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

export async function setWorkerBackground(formData: FormData) { return runAction(() => setBackgroundImpl(formData)); }
export async function stopWorker() { return runAction(() => stopImpl()); }
