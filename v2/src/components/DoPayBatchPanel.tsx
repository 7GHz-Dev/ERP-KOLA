import { DoPayBatchForms } from './DoPayBatchForms';
import { InvoicePdfPages } from './InvoicePdfPages';
import type { loadDoPayBatch } from '@/lib/queries/do-files';
import type { DoCharge, DoChargeTopic } from '@/lib/do-charges';

export function DoPayBatchPanel({ entries, charges = {}, topics = [] }: {
  entries: NonNullable<Awaited<ReturnType<typeof loadDoPayBatch>>>;
  /** หัวข้อค่าใช้จ่ายของแต่ละงาน (jobId → หัวข้อ) */
  charges?: Record<string, DoCharge[]>;
  topics?: DoChargeTopic[];
}) {
  return <div className="do-pay do-pay-batch">
    <div className="do-pay-view do-pay-batch-preview">
      {entries.map(({ job, invoiceDo }, index) => <section key={job.id} id={`invoice-${job.id}`} className="do-pay-invoice">
        <h3>{index + 1}. {job.jobNo} · BL {job.blNo ?? '-'}</h3>
        {!invoiceDo ? <p className="drawer-note warn">ยังไม่มี Invoice DO ของรายการนี้</p>
          : invoiceDo.mimeType?.startsWith('image/') ? <img className="do-pay-invoice-image" src={`/files/${invoiceDo.id}`} alt={invoiceDo.fileName} />
            : <InvoicePdfPages fileId={invoiceDo.id} fileName={invoiceDo.fileName} />}
      </section>)}
    </div>
    <DoPayBatchForms entries={entries} charges={charges} topics={topics} />
  </div>;
}
