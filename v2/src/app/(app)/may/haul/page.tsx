import { requireUserReady } from '@/lib/auth';
import { readParams } from '@/lib/columns';
import { JobTable, Tabs } from '@/components/JobTable';
import { BulkBar } from '@/components/BulkBar';
import { haulColumns } from '@/components/HaulTable';
import { ackHaulPlan } from '@/lib/actions/haul-plan';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { haulSummaries } from '@/lib/queries/haul';
import { sheetRowClass } from '@/lib/register-sheet';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'new', label: 'แพลนใหม่' },
  { key: 'ack', label: 'รับแพลนแล้ว' },
];
const SEARCH_KEYS = [
  'person', 'jobType', 'shipper', 'blNo', 'container', 'vessel', 'refNo', 'entryNo', 'consignee', 'notify',
];

/**
 * MAY — แพลนลากตู้ที่ NAMKANG ส่งมา จัดการแพลนฝั่ง Partner ต่อ (เชื่อม ERP SHIPME ภายหลัง)
 *
 * แถวละงานแบบทะเบียนงานเหมือนหน้าของ NAMKANG · เลือกหลายงานแล้วกดรับแพลนทีเดียว (รับทุกตู้ของงาน)
 * NAMKANG เปลี่ยนวันหลังรับแล้ว แพลนกลับมาที่แท็บแพลนใหม่พร้อมวันใหม่
 */
export default async function MayHaulPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['MAY']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = one('tab') === 'ack' ? 'ack' : 'new';
  const sort = sortBy ?? 'eta';
  const dir = sortBy ? sortDir : 'asc';
  const { rows, total } = await listJobs({ where: QUEUE.haul(tab), search, sortBy: sort, sortDir: dir });
  const summaries = await haulSummaries(rows.map((r) => r.id));

  const table = (
    <JobTable
      basePath="/may/haul"
      columns={haulColumns(tab, summaries, tab === 'new')}
      rows={rows}
      total={total}
      carry={{ ...carry, tab }}
      sortBy={sort}
      sortDir={dir}
      empty={tab === 'new' ? 'ไม่มีแพลนใหม่' : 'ยังไม่มีแพลนที่รับแล้ว'}
      rowClass={sheetRowClass}
    />
  );

  return (
    <>
      <div className="page-head">
        <h1>แพลนลากตู้</h1>
        <p>แพลนจาก NAMKANG · รับแพลนแล้วจัดการแพลนฝั่ง Partner ต่อ</p>
      </div>
      <Tabs basePath="/may/haul" items={TABS} active={tab} carry={carry} />
      {tab === 'new' ? (
        <BulkBar
          action={ackHaulPlan}
          idName="jobIds"
          label="รับแพลน {n} งาน"
          confirmText="รับแพลนลากตู้ {n} งาน (ทุกตู้ที่ส่งมา) ใช่ไหม"
        >
          {table}
        </BulkBar>
      ) : table}
    </>
  );
}
