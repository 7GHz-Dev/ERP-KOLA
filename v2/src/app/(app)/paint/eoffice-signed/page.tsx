import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RequestEditButton, SendEofficeButton, UploadForm } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'Upload ชุดปล่อย / ส่ง Partner' },
  { key: 'sent', label: 'ส่ง Partner แล้ว' },
];
const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

export default async function PaintEofficeSignedPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['PAINT']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';

  const { rows, total } = await listJobs({
    where: QUEUE.eofficeSigned(tab as 'wait' | 'sent'),
    search, sortBy, sortDir,
  });
  const sent = tab === 'sent';

  const columns: Column[] = [
    col.clientInCharge(), col.shipper(), col.blNo(), col.refNo(),
    col.declarationNo(), col.consignee(),
    {
      // ชุดที่รวมไว้แล้ว เอาไว้ให้โหลดไปเดินพิธีการ
      label: 'ชุด E-Office รวม', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.EOFFICE_MERGED} />
        </div>
      ),
    },
    {
      label: 'ชุดปล่อย (เซ็นแล้ว)', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.EOFFICE_SIGNED;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {/* ส่ง Partner แล้วล็อกไฟล์ไว้ ต้องขออนุมัติก่อนจึงแก้ได้ */}
            {sent || file ? null : (
              <UploadForm jobId={r.id} category="EOFFICE_SIGNED" label="อัปโหลด" />
            )}
          </div>
        );
      },
    },
    {
      label: 'จัดการ', kind: 'actions',
      // ส่งแล้วแก้เองไม่ได้ ต้องขออนุมัติก่อน · ยังไม่ส่งและมีไฟล์แล้วจึงกดส่งได้
      render: (r) =>
        (sent
          ? <RequestEditButton jobId={r.id} />
          : r.currentFiles?.EOFFICE_SIGNED
            ? <SendEofficeButton jobId={r.id} ready />
            : null),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Upload ชุดปล่อย E-Office / ส่ง Partner</h1>
        <p>
          อัปโหลดชุด E-Office ที่เดินพิธีการและได้ลายเซ็นแล้ว ·
          BL ที่ได้ไฟล์แล้วจะถูกตัดออกจาก งานคงค้าง → 4. เตรียมเอกสารเดิน E
        </p>
      </div>
      <Tabs basePath="/paint/eoffice-signed" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/paint/eoffice-signed"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={sent ? 'ยังไม่มีงานที่ส่ง Partner แล้ว' : 'ไม่มีงานรออัปโหลดชุดปล่อย'}
        hint="อัปโหลดเสร็จรายการจะหายจากแท็บ 4 ทันที · อัปโหลดแล้วกดส่ง Partner ได้ในแถวเดียวกัน"
      />
    </>
  );
}
