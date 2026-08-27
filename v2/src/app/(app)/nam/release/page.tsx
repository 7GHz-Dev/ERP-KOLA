import { requireUser } from '@/lib/auth';
import { col, readParams, surrenderBadge } from '@/lib/columns';
import { JobTable, FileChip } from '@/components/JobTable';
import { ReleaseButton, UploadForm } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['jobNo', 'blNo', 'consignee'];

export default async function NamReleasePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['NAMKANG']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.namRelease(), search, sortBy, sortDir });

  return (
    <>
      <div className="page-head">
        <h1>ตรวจ &amp; ปล่อยสินค้า</h1>
        <p>ปล่อยได้เมื่อมี E-Office ครบและ Surrender เคลียร์แล้ว</p>
      </div>
      <JobTable
        basePath="/nam/release"
        columns={[
          col.jobNo(), col.blNo(), col.consignee(),
          {
            label: 'E-Office', kind: 'actions',
            render: (r) => (
              <div className="row-actions">
                <FileChip file={r.currentFiles?.EOFFICE} />
                <UploadForm jobId={r.id} category="EOFFICE"
                  label={r.currentFiles?.EOFFICE ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} />
              </div>
            ),
          },
          { label: 'Surrender', render: (r) => surrenderBadge(r.surrenderStatus) },
          {
            label: 'จัดการ', kind: 'actions',
            render: (r) => (
              <ReleaseButton
                jobId={r.id}
                released={r.releaseStatus === 'RELEASED'}
                ready={Boolean(r.currentFiles?.EOFFICE) && r.surrenderStatus === 'CLEARED'}
              />
            ),
          },
        ]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
      />
    </>
  );
}
