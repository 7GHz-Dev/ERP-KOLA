import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, FileChip, type Column } from '@/components/JobTable';
import { UploadForm } from '@/components/ActionForms';
import { DoRowForm } from '@/components/DoRowForm';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { listMaster } from '@/lib/queries/master';
import { doHandoffSentAt } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee'];

export default async function FahDoPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['FAH']);
  const params = readParams(await searchParams, SEARCH_KEYS);
  const { search, carry } = params;
  // หน้านี้ทำงานไล่จากงานที่ ETA ใกล้ที่สุดก่อน จึงเรียงน้อยไปมากเป็นค่าตั้งต้น
  const sortBy = params.sortBy ?? 'eta';
  const sortDir = params.sortBy ? params.sortDir : 'asc';

  const [{ rows, total }, portRows, terminalRows, partnerRows] = await Promise.all([
    listJobs({ where: QUEUE.fahDo(), search, sortBy, sortDir }),
    listMaster('ports'),
    listMaster('terminals'),
    listMaster('partners'),
  ]);
  const active = (list: typeof portRows) =>
    list.filter((p) => p.isActive).map((p) => ({ id: p.id, code: p.code, name: p.name }));
  const ports = active(portRows);
  const terminals = active(terminalRows);
  const partners = active(partnerRows);
  const sentMap = await doHandoffSentAt(rows.map((r) => r.id));

  const columns: Column[] = [
    col.shipper(), col.blNo(), col.consignee(), col.lastDem(),
    {
      label: 'Invoice DO', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          <FileChip file={r.currentFiles?.INVOICE_DO} />
          <UploadForm jobId={r.id} category="INVOICE_DO"
            label={r.currentFiles?.INVOICE_DO ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} />
        </div>
      ),
    },
    {
      // แก้ได้ในตารางเลย ทั้ง ETA · Port · Terminal · Partner แล้วกดบันทึกทีเดียว
      label: 'ETA official · Port · Terminal · Partner', kind: 'wrap',
      render: (r) => (
        <DoRowForm
          jobId={r.id}
          eta={r.eta}
          transportDate={r.transportDate}
          portId={r.portId}
          terminalId={r.terminalId}
          partnerName={r.releasePartner}
          ports={ports}
          terminals={terminals}
          partners={partners}
          sentAt={sentMap.get(r.id) ?? null}
        />
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>จัดการ Invoice DO</h1>
        <p>ใส่ ETA official (บันทึกแล้วขึ้น OFC และใช้เป็นวันหลัก) · Port · Terminal · Partner แล้วจึงส่ง Partner</p>
      </div>
      <JobTable
        basePath="/fah/do"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ยังไม่มีงานที่ผ่าน AN"
        hint="Port · Terminal · Partner มาจาก Master Data"
      />
    </>
  );
}
