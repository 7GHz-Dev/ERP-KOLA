import { eq, ne, sql } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
import { readParams, sheetColumns } from '@/lib/columns';
import { JobTable, Tabs } from '@/components/JobTable';
import { etaInPeriod, etaPeriodCounts, etaSince, listJobs } from '@/lib/queries/jobs';
import { ExportTemplateButton } from '@/components/ExportTemplateButton';
import { jobCreatedConditions, validJobDate } from '@/lib/job-created-date';
import { JobCreatedDateFilter } from '@/components/JobCreatedDateFilter';
import { sheetRowClass } from '@/lib/register-sheet';
import { RecentPeriodFilter } from '@/components/RecentPeriodFilter';
import { etaViewParams, readEtaView, recentFrom } from '@/lib/eta-period';

export const dynamic = 'force-dynamic';

/**
 * ทะเบียนงาน — งานทุกใบในระบบ หน้าตาเดียวกับตารางงาน Excel ที่ทีมใช้กันอยู่
 *
 * หัวคอลัมน์ ลำดับ และสีแถวตามไฟล์เดิม (lib/register-sheet.ts) คนย้ายจาก Excel มาดูที่นี่ได้ทันที
 * ส้ม = MUO (Partner ภายนอกปล่อยเอง) · ม่วง = ขนทางรถ · เขียว = งานอื่น
 * ไฟล์แนบดูได้ใน Drawer (คลิกเลขลำดับ / ดับเบิลคลิกแถว)
 *
 * หน้าคิวอื่น ๆ กรองเฉพาะงานที่ค้างในขั้นตอนของตัวเอง หน้านี้ไม่กรองอะไรเลย
 * ใช้ตอนอยากตามหางานใดงานหนึ่งโดยไม่รู้ว่ามันค้างอยู่ขั้นไหน
 */

/*
 * เปิดมาเห็นงานที่กำลังดำเนินการก่อน — เป็นสิ่งที่ทีมเปิดหน้านี้มาดูบ่อยที่สุด
 * "เสร็จสิ้น" = ได้เลขใบขนแล้ว (customs_status = FILED) เงื่อนไขเดิมของแท็บ "ยื่นใบขนแล้ว"
 */
const TABS = [
  { key: 'active', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'เสร็จสิ้น' },
  { key: 'all', label: 'ทั้งหมด' },
];

const SEARCH_KEYS = [
  'person', 'jobType', 'shipper', 'blNo', 'container', 'vessel', 'voyage', 'refNo', 'entryNo', 'consignee', 'notify',
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady();
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'active';
  const createdFrom = validJobDate(one('createdFrom'));
  const createdTo = validJobDate(one('createdTo'));
  if (createdFrom) carry.createdFrom = createdFrom;
  if (createdTo) carry.createdTo = createdTo;
  // แถบ ETA — ค่าตั้งต้น 12 เดือนล่าสุด · ติดไปกับทุกลิงก์ (แท็บ · ค้นหา · เรียง) เหมือนตัวกรองอื่น
  const etaView = readEtaView(one('eta'), one('year'), one('month'));
  const baseCarry = { ...carry };
  Object.assign(carry, etaViewParams(etaView));
  const etaWhere = etaView.kind === 'recent' ? etaSince(recentFrom())
    : etaView.kind === 'period' ? etaInPeriod(etaView.period) : undefined;

  const tabWhere = () => [
    ...jobCreatedConditions(sql`${jobs.createdAt}`, createdFrom, createdTo),
    tab === 'done' ? eq(jobs.customsStatus, 'FILED') : undefined,
    tab === 'active' ? ne(jobs.customsStatus, 'FILED') : undefined,
  ];
  const [{ rows, total }, periods] = await Promise.all([
    listJobs({
      where: () => [...tabWhere(), etaWhere],
      search,
      sortBy: sortBy ?? 'jobNo',
      sortDir,
    }),
    etaPeriodCounts(tabWhere),
  ]);

  const columns = sheetColumns();

  return (
    <>
      <div className="page-head with-action">
        <div>
          <h1>Bookings table</h1>
          <p>งานทุกใบตามตารางงานเดิม · ส้ม = MUO · ม่วง = BY TRUCK · ขาว = MU ยังไม่ส่งแพลนลากตู้ · คลิกเลขลำดับเพื่อดูสรุปงานและไฟล์แนบ</p>
        </div>
        {/* หน้านี้เห็นทุกงาน จึงโหลดได้ทั้งสองแบบ */}
        <span className="chip-row">
          <ExportTemplateButton label="Export (อนุมัติแล้ว)" createdFrom={createdFrom} createdTo={createdTo} />
          <ExportTemplateButton scope="all" label="Export (ทุกงาน)" createdFrom={createdFrom} createdTo={createdTo} />
        </span>
      </div>

      <Tabs basePath="/jobs" items={TABS} active={tab} carry={carry} />

      <JobCreatedDateFilter key={`${createdFrom}:${createdTo}`} createdFrom={createdFrom} createdTo={createdTo} />
      <RecentPeriodFilter basePath="/jobs" carry={{ ...baseCarry, tab }} view={etaView} counts={periods} />

      <JobTable
        basePath="/jobs"
        columns={columns}
        rows={rows}
        total={total}
        carry={{ ...carry, tab }}
        sortBy={sortBy ?? 'jobNo'}
        sortDir={sortDir}
        empty="ไม่พบงานที่ตรงกับคำค้น"
        hint="อยากเห็นเฉพาะงานที่ค้างในขั้นตอนของคุณ ให้ใช้เมนูงานคงค้าง"
        rowClass={sheetRowClass}
        tableClassName="sheet-table"
      />
    </>
  );
}
