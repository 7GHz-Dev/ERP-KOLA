import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { latestApproval, QUEUE, type JoinContext } from './jobs';

/**
 * หน้าภาพรวมงาน — งานค้างของ PAINT และ FAH แยกตามขั้น
 *
 * ทำไว้ให้ NAMKANG เปิดดูว่าตอนนี้งานติดอยู่ที่ใคร ขั้นไหน กี่งาน โดยไม่ต้องเปิดหน้างานของคนอื่น
 * (NAMKANG ไม่มีสิทธิ์เข้าหน้า PAINT / FAH อยู่แล้ว)
 *
 * แต่ละขั้นใช้เงื่อนไข QUEUE ตัวเดียวกับหน้างานจริง ตัวเลขบนหน้านี้จึงเท่ากับจำนวนแถว
 * ที่ PAINT / FAH เห็นในหน้าของตัวเองเสมอ แก้เงื่อนไขที่ QUEUE ที่เดียว หน้านี้ตามไปเอง
 */

export type StageOwner = 'PAINT' | 'FAH';

export type Stage = {
  key: string;
  owner: StageOwner;
  /** ชื่อขั้นที่คนนอกแผนกอ่านแล้วเข้าใจ ไม่ใช้ชื่อเมนูของแผนกนั้นตรง ๆ */
  label: string;
  /** อธิบายสั้น ๆ ว่ารออะไรอยู่ */
  hint: string;
  /** หน้างานจริงของขั้นนี้ — แสดงลิงก์เฉพาะคนที่เข้าหน้านั้นได้ */
  href: string;
  /**
   * งานที่รอระบบภายนอก (รอผลใบขนจาก NETBAY) ไม่ได้รอคนในแผนกลงมือ
   * แสดงให้เห็นแต่ไม่นับรวมเป็นงานค้างของแผนก ไม่งั้นตัวเลขรวมจะดูเหมือนแผนกทำช้า
   */
  passive?: boolean;
  where: (ctx: JoinContext) => (SQL | undefined)[];
};

export const STAGES: Stage[] = [
  {
    key: 'paint-bl', owner: 'PAINT', label: 'ใส่ข้อมูล BL / ส่ง AN',
    hint: 'ยังไม่ได้ส่ง AN ให้ NAMKANG อนุมัติ หรือถูกตีกลับ',
    href: '/pending?tab=bl', where: QUEUE.pendingBl('wait'),
  },
  {
    key: 'paint-fn', owner: 'PAINT', label: 'ทำ Final Invoice',
    hint: 'AN ผ่านแล้ว รอ PAINT ส่ง Final Invoice ให้ FAH',
    href: '/pending?tab=fn', where: QUEUE.pendingFn('wait'),
  },
  {
    key: 'paint-draft', owner: 'PAINT', label: 'สร้าง Draft ใบขน',
    hint: 'FN ผ่านแล้ว รอสร้าง Draft ส่งให้ FAH ตรวจ',
    href: '/pending?tab=draft', where: QUEUE.pendingDraft('wait'),
  },
  {
    key: 'paint-edoc', owner: 'PAINT', label: 'เตรียมเอกสาร E-Office',
    hint: 'ได้เลขใบขนแล้ว รอทำคำร้อง รวมชุด และส่งมอบคนเดินเอกสาร',
    href: '/pending?tab=edoc', where: QUEUE.pendingEdoc(),
  },
  {
    key: 'paint-signed', owner: 'PAINT', label: 'ชุดปล่อยเซ็นแล้ว → ส่ง Partner',
    hint: 'รออัปชุดปล่อยที่เซ็นแล้ว และกดส่งให้ Partner',
    href: '/paint/eoffice-signed', where: QUEUE.eofficeSigned('wait'),
  },
  {
    key: 'fah-do', owner: 'FAH', label: 'Invoice DO → ส่ง Partner',
    hint: 'AN ผ่านแล้ว รอ FAH อัป Invoice DO / ETA / Terminal แล้วส่ง Partner',
    href: '/fah/do', where: QUEUE.fahDo('wait'),
  },
  {
    key: 'fah-fn', owner: 'FAH', label: 'อนุมัติ Final Invoice',
    hint: 'PAINT ส่ง Final Invoice มาแล้ว รอ FAH อนุมัติ',
    href: '/fah/fn', where: QUEUE.fahFn(),
  },
  {
    key: 'fah-draft', owner: 'FAH', label: 'ตรวจ Draft / ทำใบขน',
    hint: 'PAINT ส่ง Draft มาแล้ว รอ FAH ตรวจและยื่นใบขน',
    href: '/fah/draft', where: QUEUE.fahDraftReview(),
  },
  {
    key: 'fah-customs', owner: 'FAH', label: 'รอผลใบขนจาก NETBAY',
    hint: 'ยื่นแล้ว รอศุลกากร ACCEPT — ระบบดึงเลขใบขนให้เอง',
    href: '/fah/draft?tab=waiting', where: QUEUE.fahDraftWaiting(), passive: true,
  },
];

export const OWNERS: Array<{ key: StageOwner; label: string; color: string }> = [
  { key: 'PAINT', label: 'PAINT', color: '#0075de' },
  { key: 'FAH', label: 'FAH', color: '#dd5b00' },
];

export function stageByKey(key: string) {
  return STAGES.find((s) => s.key === key);
}

/** เงื่อนไขของขั้นเดียวรวมเป็นก้อนเดียว — ไม่มีเงื่อนไขเลยถือว่าไม่ตรง (ไม่ใช่ตรงทุกงาน) */
function stageCondition(stage: Stage, ctx: JoinContext): SQL {
  return and(...stage.where(ctx)) ?? sql`false`;
}

/**
 * เงื่อนไขของมุมที่เลือก ใช้กรองตารางด้านล่าง
 *   ขั้นเดียว       → เฉพาะขั้นนั้น (รวมขั้นที่รอระบบด้วย ถ้าเลือกตรง ๆ)
 *   PAINT / FAH    → งานที่ค้างอยู่ขั้นใดขั้นหนึ่งของแผนกนั้น
 *   ไม่เลือก        → งานที่ค้าง PAINT หรือ FAH อย่างน้อยหนึ่งขั้น
 */
export function viewCondition(view: string) {
  return (ctx: JoinContext): SQL[] => {
    const one = stageByKey(view);
    if (one) return [stageCondition(one, ctx)];
    const pool = STAGES.filter((s) => !s.passive && (view === 'PAINT' || view === 'FAH' ? s.owner === view : true));
    return [or(...pool.map((s) => stageCondition(s, ctx))) ?? sql`false`];
  };
}

/**
 * ระดับความเร่งด่วนของงานที่ค้าง — ดูจาก ETA ตามวันที่ไทย
 *   urgent    ETA วันนี้หรือผ่านไปแล้ว (เรือถึงแล้ว ค่า DEM เริ่มเดิน)
 *   priority  ETA ภายใน 7 วันข้างหน้า
 * งานที่ไม่มี ETA หรือ ETA ไกลกว่านั้น ไม่อยู่ในทั้งสองระดับ
 */
export const LEVELS = [
  { key: 'urgent', label: 'Urgent', hint: 'ETA วันนี้หรือเลยมาแล้ว' },
  { key: 'priority', label: 'Priority', hint: 'ETA ภายใน 7 วันข้างหน้า' },
] as const;
export type LevelKey = (typeof LEVELS)[number]['key'];
export const PRIORITY_DAYS = 7;

const TODAY = sql`(now() at time zone 'Asia/Bangkok')::date`;

/** เงื่อนไข ETA ของระดับนั้น — ใช้กรองตาราง ต้องตรงกับที่ overviewStats จัดระดับ */
export function levelCondition(level: string): SQL | undefined {
  if (level === 'urgent') return sql`${jobs.eta} <= ${TODAY}`;
  if (level === 'priority') return sql`${jobs.eta} > ${TODAY} and ${jobs.eta} <= ${TODAY} + ${sql.raw(String(PRIORITY_DAYS))}`;
  return undefined;
}

export type StageStat = { jobs: number; containers: number; overdue: number };
export type Bucket = {
  stages: Record<string, StageStat>;
  owners: Record<StageOwner, StageStat>;
  all: StageStat;
};
export type OverviewStats = Bucket & {
  /** แยกตามระดับความเร่งด่วน — ใช้ทำการ์ด Urgent / Priority และตัวเลขบนตัวกรองขั้นในตาราง */
  levels: Record<LevelKey, Bucket>;
  /** ขั้นที่แต่ละงานค้างอยู่ — ใช้เขียนป้าย "ค้างที่" ในตาราง */
  stagesOf: Map<string, string[]>;
};

/**
 * นับทุกขั้นใน query เดียว
 *
 * ดึงแถวละงานพร้อมธงว่าอยู่ขั้นไหนบ้าง แล้วรวมในหน่วยความจำ
 * งานหนึ่งค้างได้หลายขั้นพร้อมกัน (FAH ทำ Invoice DO ขนานกับขั้นของ PAINT)
 * ยอดรวมของแผนกจึงนับงานไม่ซ้ำ ไม่ใช่เอาตัวเลขของแต่ละขั้นมาบวกกัน
 *
 * "เลย ETA" นับงานที่ ETA ผ่านมาแล้วตามวันที่ไทย — เรือเทียบท่าแล้วแต่งานยังค้าง ค่า DEM เริ่มเดิน
 */
export async function overviewStats(): Promise<OverviewStats> {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const ctx = { an, fn };
  const flags = Object.fromEntries(
    STAGES.map((s) => [s.key, sql<boolean>`coalesce(${stageCondition(s, ctx)}, false)`]),
  ) as Record<string, SQL<boolean>>;

  const rows = await db
    .select({
      id: jobs.id,
      containers: sql<number>`(select count(*) from containers c where c.job_id = ${jobs.id})::int`,
      overdue: sql<boolean>`coalesce(${jobs.eta} < ${TODAY}, false)`,
      level: sql<string | null>`case when ${levelCondition('urgent')} then 'urgent'
                                     when ${levelCondition('priority')} then 'priority' end`,
      ...flags,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .where(and(eq(jobs.isArchived, false), or(...STAGES.map((s) => stageCondition(s, ctx)))));

  const empty = (): StageStat => ({ jobs: 0, containers: 0, overdue: 0 });
  const bucket = (): Bucket => ({
    stages: Object.fromEntries(STAGES.map((s) => [s.key, empty()])) as Record<string, StageStat>,
    owners: { PAINT: empty(), FAH: empty() },
    all: empty(),
  });
  const add = (stat: StageStat, containers: number, overdue: boolean) => {
    stat.jobs += 1;
    stat.containers += containers;
    if (overdue) stat.overdue += 1;
  };

  const total = bucket();
  const levels: Record<LevelKey, Bucket> = { urgent: bucket(), priority: bucket() };
  const stagesOf = new Map<string, string[]>();

  for (const row of rows) {
    const r = row as unknown as Record<string, unknown> & { id: string; containers: number; overdue: boolean; level: string | null };
    const containers = Number(r.containers) || 0;
    const overdue = Boolean(r.overdue);
    const hit = STAGES.filter((s) => r[s.key] === true);
    if (!hit.length) continue;
    stagesOf.set(r.id, hit.map((s) => s.key));
    const active = hit.filter((s) => !s.passive);
    const targets = [total, ...(r.level === 'urgent' || r.level === 'priority' ? [levels[r.level]] : [])];
    for (const b of targets) {
      hit.forEach((s) => add(b.stages[s.key], containers, overdue));
      (['PAINT', 'FAH'] as const).forEach((owner) => {
        if (active.some((s) => s.owner === owner)) add(b.owners[owner], containers, overdue);
      });
      if (active.length) add(b.all, containers, overdue);
    }
  }

  return { ...total, levels, stagesOf };
}
