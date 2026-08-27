import { requireUser } from '@/lib/auth';
import { col, readParams, surrenderBadge } from '@/lib/columns';
import { JobTable, FileChip } from '@/components/JobTable';
import { AcknowledgeInvoice, SurrenderForm, UploadForm } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee'];

export default async function NamCustomerPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['NAMKANG']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.namCustomer(), search, sortBy, sortDir });

  return (
    <>
      <div className="page-head">
        <h1>ข้อมูลลูกค้า / File</h1>
        <p>Invoice สินค้าและ Surrender BL · แถวแดงคือมี Invoice ใหม่ที่ยังไม่มีใครรับทราบ</p>
      </div>
      <JobTable
        basePath="/nam/customer"
        columns={[
          col.shipper(), col.blNo(), col.consignee(),
          {
            label: 'Invoice สินค้า', kind: 'actions',
            render: (r) => {
              const file = r.currentFiles?.INVOICE_GOODS;
              return (
                <div className="row-actions">
                  <FileChip file={file} />
                  {r.hasInvoiceAlert ? <span className="badge rejected">เปลี่ยนใหม่</span> : null}
                  <UploadForm jobId={r.id} category="INVOICE_GOODS"
                    label={file ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} requireReason={Boolean(file)} />
                </div>
              );
            },
          },
          {
            label: 'Surrender BL', kind: 'actions',
            render: (r) => (
              <div className="row-actions">
                <FileChip file={r.currentFiles?.SURRENDER} />
                <UploadForm jobId={r.id} category="SURRENDER"
                  label={r.currentFiles?.SURRENDER ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} />
              </div>
            ),
          },
          {
            label: 'สถานะ Surrender', kind: 'actions',
            render: (r) => (
              <div className="row-actions">
                {surrenderBadge(r.surrenderStatus)}
                <SurrenderForm jobId={r.id} current={r.surrenderStatus} />
              </div>
            ),
          },
        ]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ยังไม่มีงานที่ผ่าน AN"
      />
    </>
  );
}
