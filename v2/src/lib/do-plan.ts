/**
 * กติกาของ Plan แลก DO ที่ไม่ต้องแตะฐานข้อมูล
 *
 * แยกออกมาเพราะสองข้อนี้คือส่วนที่พลาดแล้วเจ็บ และต้องทดสอบได้โดยไม่ต้องต่อ Postgres
 *   1. ใบไหน "พร้อมใส่ Plan" — ตัดสินจากข้อมูลชุดเดียวกันทั้งฝั่งหน้าจอและฝั่งเซิร์ฟเวอร์
 *   2. ชุดหนึ่งทำครบหรือยัง — ANN กับ MAY ใช้สูตรเดียวกัน ต่างแค่ช่องที่นับ
 *
 * ฝั่งหน้าจอใช้ปิดปุ่มไว้ก่อน ฝั่งเซิร์ฟเวอร์ใช้ตรวจซ้ำตอนกดจริง
 * เขียนที่เดียวกันจึงไม่มีวันที่สองฝั่งตัดสินไม่ตรงกัน แล้วปุ่มกดได้แต่ยิงไปโดนปฏิเสธ
 */

/** ข้อมูลเท่าที่ต้องใช้ตัดสินว่าใบนี้ใส่ Plan ได้ไหม */
export type PlanCandidate = {
  id: string;
  /** ชื่อที่เอาไว้บอกผู้ใช้ว่าใบไหนขาด — BL No. ถ้ามี ไม่งั้นใช้ Job No. */
  label: string;
  hasInvoiceDo: boolean;
  eta: string | null;
  portId: string | null;
  terminalId: string | null;
  partnerName: string | null;
  /** ส่ง Partner ไปแล้ว — ใส่ Plan ซ้ำไม่ได้ */
  alreadySent: boolean;
};

export type PlanReadiness = { ready: boolean; missing: string[] };

/**
 * ใบนี้พร้อมใส่ Plan หรือยัง และถ้ายัง ขาดอะไรบ้าง
 *
 * คืนรายการที่ขาดทั้งหมดในครั้งเดียว ไม่ใช่หยุดที่ช่องแรกที่เจอ
 * เพราะคนกรอกอยากรู้ทีเดียวว่าต้องเติมอะไรอีกบ้าง ไม่ใช่เติมทีละช่องแล้วกดใหม่
 */
export function planReadiness(job: PlanCandidate): PlanReadiness {
  if (job.alreadySent) return { ready: false, missing: ['ส่ง Partner ไปแล้ว'] };
  const missing: string[] = [];
  if (!job.hasInvoiceDo) missing.push('Invoice DO');
  if (!job.eta) missing.push('ETA official');
  if (!job.portId) missing.push('Port');
  if (!job.terminalId) missing.push('Terminal');
  if (!job.partnerName?.trim()) missing.push('Partner');
  return { ready: missing.length === 0, missing };
}

/** ใบที่ใส่ Plan ได้ทั้งหมดในรายการที่ให้มา */
export function readyForPlan(jobs: PlanCandidate[]): string[] {
  return jobs.filter((job) => planReadiness(job).ready).map((job) => job.id);
}

/**
 * ข้อความบอกว่าใบที่เลือกไว้ยังขาดอะไร — ใช้ทั้งเตือนบนหน้าจอและเป็น error ฝั่งเซิร์ฟเวอร์
 *
 * รวมเป็นบรรทัดเดียวต่อหนึ่งใบ และตัดที่สามใบแรก เพราะเลือกทีละหลายสิบใบได้
 * ถ้าไล่หมดทุกใบ ข้อความจะยาวจนอ่านไม่ออกและดันเนื้อหาอื่นตกจอ
 */
export function missingSummary(jobs: PlanCandidate[]): string {
  const bad = jobs
    .map((job) => ({ job, check: planReadiness(job) }))
    .filter((row) => !row.check.ready);
  if (!bad.length) return '';
  const head = bad.slice(0, 3)
    .map((row) => `${row.job.label} ขาด ${row.check.missing.join(' · ')}`)
    .join(' / ');
  return bad.length > 3 ? `${head} และอีก ${bad.length - 3} รายการ` : head;
}

/**
 * เลขที่ Plan — PLAN-YYYYMMDD-NN โดย NN นับเฉพาะ Plan ของวันนั้น
 *
 * ใช้วันที่นัดแลก ไม่ใช่วันที่กดสร้าง เพราะเวลาคุยกันทุกฝ่ายอ้างถึง "ชุดของวันที่ไปแลก"
 * สร้าง Plan ล่วงหน้าสองวันแล้วเลขเป็นวันที่กด จะหาไม่เจอว่าชุดของวันพรุ่งนี้คือใบไหน
 */
export function planNo(planDate: string, existingToday: number): string {
  const digits = planDate.slice(0, 10).replace(/-/g, '');
  return `PLAN-${digits}-${String(existingToday + 1).padStart(2, '0')}`;
}

/** ความคืบหน้าของชุดหนึ่ง — ทำไปแล้วกี่ใบจากทั้งหมดกี่ใบ */
export type PlanProgress = { done: number; total: number; complete: boolean };

/**
 * นับความคืบหน้าจากรายการงานในชุด
 *
 * ANN ส่ง `doExchangedAt` ส่วน MAY ส่ง `doClaimedAt` เข้ามาเป็น `doneAt`
 * ตัวนับจึงเป็นตัวเดียวกันทั้งสองหน้า ต่างแค่ว่านับช่องไหน
 * ชุดว่างถือว่ายังไม่ครบ ไม่ใช่ครบ — ไม่งั้น Plan ที่งานถูกย้ายออกหมดจะขึ้นว่าเสร็จแล้ว
 */
export function planProgress(jobs: Array<{ doneAt: unknown }>): PlanProgress {
  const total = jobs.length;
  const done = jobs.filter((job) => Boolean(job.doneAt)).length;
  return { done, total, complete: total > 0 && done === total };
}
