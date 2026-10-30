import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RejectDraftButton } from '@/components/ActionForms';
import { CustomsMonitorAutoLaunch, SubmitCustomsDone } from '@/components/CustomsMonitor';
import { TASK_TYPES } from '@/lib/automation';
import { netbayStatusLabel, netbayStatusTone } from '@/lib/customs-status';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'review', label: 'ตรวจ Draft' },
  { key: 'waiting', label: 'รอไฟล์และเลขใบขน' },
  { key: 'done', label: 'ใบขนเสร็จสิ้น' },
];
const SEARCH_KEYS = ['shipper', 'blNo', 'refNo', 'consignee', 'entryNo'];

/**
 * งานสร้างใบขนล่าสุดของแต่ละงาน — แท็บรอใช้แสดงสถานะใน NETBAY
 * แท็บตรวจ Draft ใช้บอกว่างานถูกคืนมาเพราะใบขนถูกยกเลิกใน NETBAY (งานในคิวเป็น ERROR)
 */
async function latestCustomsTasks(jobIds: string[]) {
  const map = new Map<string, { status: string; externalStatus: string | null; error: string | null }>();
  if (!jobIds.length) return map;
  const rows = await db.select({
    jobId: automationTasks.jobId, status: automationTasks.status,
    externalStatus: automationTasks.externalStatus, error: automationTasks.error,
  }).from(automationTasks)
    .where(and(eq(automationTasks.type, TASK_TYPES.CUSTOMS), inArray(automationTasks.jobId, jobIds)))
    .orderBy(desc(automationTasks.createdAt));
  for (const r of rows) if (r.jobId && !map.has(r.jobId)) map.set(r.jobId, r);
  return map;
}

export default async function FahDraftPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['FAH']);
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'review';

  const where =
    tab === 'waiting' ? QUEUE.fahDraftWaiting()
    : tab === 'done' ? QUEUE.fahDraftDone()
    : QUEUE.fahDraftReview();

  const [{ rows, total }, [latest]] = await Promise.all([
    listJobs({ where, search, sortBy, sortDir }),
    // งานสร้างใบขนล่าสุดในคิว — เปลี่ยนเมื่อกด "สร้างใบขนแล้ว" สำเร็จ ใช้กระตุ้นการเปิดตัว monitor
    db.select({ id: automationTasks.id }).from(automationTasks)
      .where(eq(automationTasks.type, TASK_TYPES.CUSTOMS))
      .orderBy(desc(automationTasks.createdAt)).limit(1),
  ]);
  const tasks = tab === 'done' ? new Map() : await latestCustomsTasks(rows.map((r) => r.id));

  const columns: Column[] =
    tab === 'done'
      ? [col.shipper(), col.blNo(), col.refNo(), col.consignee(), col.declarationNo(),
         { label: 'ไฟล์ใบขนสินค้า', render: (r) => <FileChip file={r.currentFiles?.CUSTOMS_ENTRY_DOC} /> }]
      : tab === 'waiting'
      ? [col.shipper(), col.blNo(), col.refNo(), col.consignee(),
         {
           label: 'สถานะใน NETBAY',
           render: (r) => {
             const t = tasks.get(r.id);
             return <span className={`badge ${netbayStatusTone(t?.externalStatus)}`}>{netbayStatusLabel(t?.externalStatus)}</span>;
           },
         }]
      : [col.shipper(), col.blNo(), col.refNo(), col.consignee(),
         { label: 'สถานะ Draft', render: draftBadge },
         {
           label: 'จัดการ',
           render: (r) => {
             const t = tasks.get(r.id);
             return (
               <div className="row-actions">
                 {t?.status === 'ERROR' && t.error
                   ? <span className="badge rejected" title={t.error}>ใบขนถูกยกเลิกใน NETBAY</span>
                   : null}
                 <SubmitCustomsDone jobId={r.id} />
                 <RejectDraftButton jobId={r.id} />
               </div>
             );
           },
         }];

  return (
    <>
      <CustomsMonitorAutoLaunch latestTaskId={latest?.id ?? null} />
      <div className="page-head">
        <h1>ตรวจ Draft / ทำใบขนสินค้า</h1>
        <p>ตรวจ Draft → กด SEND TO CUSTOMS ใน NETBAY → กด &quot;สร้างใบขนแล้ว&quot; → ระบบรอ ACCEPT แล้วดึงเลขใบขน + PDF ให้</p>
      </div>
      <Tabs basePath="/fah/draft" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/fah/draft"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={tab === 'done' ? 'ยังไม่มีใบขนที่เสร็จ' : tab === 'waiting' ? 'ไม่มีงานรอผล' : 'ยังไม่มี Draft ส่งมาตรวจ'}
        hint={tab === 'waiting'
          ? 'ตัว monitor เช็กใน NETBAY ทุก 5 นาที · ดูรายละเอียดที่ คิวงาน Automation → รอสร้างใบขน'
          : 'งานที่ได้เลขใบขนแล้วจะไปแสดงที่ งานคงค้าง → 4. เตรียมเอกสารเดิน E'}
      />
    </>
  );
}
