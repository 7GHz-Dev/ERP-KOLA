import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, FileChip, type Column } from '@/components/JobTable';
import { MergeEofficeButton, UploadForm } from '@/components/ActionForms';
import { DoLetterButton } from '@/components/DoLetterButton';
import { OriginPortCell } from '@/components/OriginPortCell';
import { matchShippingLine } from '@/lib/do-letter';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

export default async function DoExchangePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['ANN']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.doExchange(), search, sortBy, sortDir });

  const columns: Column[] = [
    col.clientInCharge(), col.shipper(), col.blNo(), col.consignee(), col.declarationNo(),
    {
      // สายเรือมาจาก SHIPLINE ของงาน ไม่ต้องเลือกซ้ำที่นี่
      label: 'SHIPLINE', kind: 'wrap', className: 'col-shipline',
      render: (r) => {
        const matched = matchShippingLine(r.shipline);
        return (
          <div className="shipline-cell">
            <b>{r.shipline ?? '-'}</b>
            {r.shipline && !matched ? (
              <small className="client-cell-note bad">ยังไม่มีแบบฟอร์ม</small>
            ) : null}
          </div>
        );
      },
    },
    {
      // เมืองต้นทางมีที่ใช้ที่เดียวคือจดหมาย จึงกรอกตรงนี้แทนการเพิ่มช่องตอนรับงาน
      label: 'เมืองต้นทาง', kind: 'wrap', className: 'col-origin',
      render: (r) => <OriginPortCell jobId={r.id} originPort={r.originPort} />,
    },
    {
      label: 'จดหมายแลก DO', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.DO_LETTER} />
          <DoLetterButton
            jobId={r.id}
            ready={Boolean(matchShippingLine(r.shipline))}
            done={Boolean(r.currentFiles?.DO_LETTER)}
          />
        </div>
      ),
    },
    {
      label: 'Invoice DO', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.INVOICE_DO} />
        </div>
      ),
    },
    {
      label: 'Slip โอนเงิน', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.DO_SLIP;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {/* อัปโหลดเสร็จแล้วเปิดแผงเทียบยอดกับ Invoice DO ให้เลย */}
            <UploadForm jobId={r.id} category="DO_SLIP"
              label={file ? 'เปลี่ยนไฟล์' : 'อัปโหลด Slip'}
              thenOpen={`/do-exchange/${r.id}`} />
          </div>
        );
      },
    },
    {
      label: 'เอกสารอื่น ๆ', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.DO_OTHER} />
          <UploadForm jobId={r.id} category="DO_OTHER" label="+ เพิ่มเอกสาร" />
        </div>
      ),
    },
    {
      label: 'ชุดแลก DO', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          <FileChip file={r.currentFiles?.DO_MERGED} />
          <MergeEofficeButton jobId={r.id} kind="do" />
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>จัดการแลก DO</h1>
        <p>
          งานที่ส่ง Partner แล้วจะเข้ามาที่นี่ · สายเรือใช้ SHIPLINE ของงาน ·
          ออกจดหมาย · อัปโหลด Slip · แล้วรวมเป็นชุดเดียว
        </p>
      </div>
      <JobTable
        basePath="/do-exchange"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ยังไม่มีงานที่ต้องแลก DO"
        hint="แบบฟอร์มจดหมายแต่ละสายเรือตั้งได้ที่ Master Data → ฟอร์มจดหมายแลก DO"
      />
    </>
  );
}
