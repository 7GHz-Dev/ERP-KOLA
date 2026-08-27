import { eq, ne } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, type Column } from '@/components/JobTable';
import { listJobs } from '@/lib/queries/jobs';
import { FILE_ORDER, fileLabel } from '@/lib/queries/job-detail';

export const dynamic = 'force-dynamic';

/**
 * ทะเบียนงาน — งานทุกใบในระบบพร้อมไฟล์แนบปัจจุบันทั้งหมดในแถวเดียว
 *
 * หน้าคิวอื่น ๆ กรองเฉพาะงานที่ค้างในขั้นตอนของตัวเอง หน้านี้ไม่กรองอะไรเลย
 * ใช้ตอนอยากตามหางานใดงานหนึ่งโดยไม่รู้ว่ามันค้างอยู่ขั้นไหน
 */

const TABS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'active', label: 'กำลังดำเนินการ' },
  { key: 'done', label: 'ยื่นใบขนแล้ว' },
];

const SEARCH_KEYS = ['jobNo', 'person', 'shipper', 'blNo', 'consignee', 'vessel', 'refNo', 'entryNo'];

/** ไฟล์แนบปัจจุบันทุกหมวดของงานนั้น เรียงตามลำดับขั้นงาน */
const filesColumn = (): Column => ({
  label: 'ไฟล์แนบปัจจุบัน',
  kind: 'wrap',
  render: (r) => {
    const current = r.currentFiles ?? {};
    const categories = Object.keys(current).sort(
      (a, b) => (FILE_ORDER.indexOf(a) + 1 || 99) - (FILE_ORDER.indexOf(b) + 1 || 99),
    );
    if (!categories.length) return <span className="badge pending">ยังไม่มีไฟล์</span>;
    return (
      <span className="chip-row">
        {categories.map((category) => (
          <a
            key={category}
            className="badge approved file-link"
            href={`/files/${current[category].id}`}
            target="_blank"
            rel="noreferrer"
            title={current[category].fileName}
          >
            {fileLabel(category)}
          </a>
        ))}
      </span>
    );
  },
});

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'all';

  const { rows, total } = await listJobs({
    where: () => [
      tab === 'done' ? eq(jobs.customsStatus, 'FILED') : undefined,
      tab === 'active' ? ne(jobs.customsStatus, 'FILED') : undefined,
    ],
    search,
    sortBy: sortBy ?? 'jobNo',
    sortDir,
    pageSize: 300,
  });

  const columns: Column[] = [
    col.jobNo(), col.source(), col.clientInCharge(), col.shipper(), col.blNo(),
    col.consignee(), col.eta(), col.lastDem(), col.lastDet(),
    col.refNo(), col.declarationNo(), col.anStatus(), col.fnStatus(),
    filesColumn(),
  ];

  return (
    <>
      <div className="page-head">
        <h1>ทะเบียนงาน</h1>
        <p>งานทุกใบพร้อมไฟล์แนบ · คลิกเลขลำดับหรือ Job No. เพื่อดูสรุปทั้งใบ</p>
      </div>

      <Tabs basePath="/jobs" items={TABS} active={tab} carry={carry} />

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
      />
    </>
  );
}
