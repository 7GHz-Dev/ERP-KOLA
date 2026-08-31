import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RequestEditButton, UploadForm } from '@/components/ActionForms';
import { DoRowForm } from '@/components/DoRowForm';
import { listJobs, QUEUE, type JobRow } from '@/lib/queries/jobs';
import { listMaster } from '@/lib/queries/master';
import { doHandoffSentAt } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';
const TABS = [
  { key: 'wait', label: 'รอส่ง Partner' },
  { key: 'sent', label: 'ส่ง Partner แล้ว' },
];
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee'];

export default async function FahDoPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['FAH']);
  const params = readParams(await searchParams, SEARCH_KEYS);
  const { search, carry, one } = params;
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';
  // หน้านี้ทำงานไล่จากงานที่ ETA ใกล้ที่สุดก่อน จึงเรียงน้อยไปมากเป็นค่าตั้งต้น
  const sortBy = params.sortBy ?? 'eta';
  const sortDir = params.sortBy ? params.sortDir : 'asc';

  const [{ rows, total }, portRows, terminalRows, partnerRows] = await Promise.all([
    listJobs({ where: QUEUE.fahDo(tab as 'wait' | 'sent'), search, sortBy, sortDir }),
    listMaster('ports'),
    listMaster('terminals'),
    listMaster('partners'),
  ]);
  const active = (list: typeof portRows) =>
    list.filter((p) => p.isActive).map((p) => ({ id: p.id, code: p.code, name: p.name }));
  const ports = active(portRows);
  const terminals = active(terminalRows);
  const partners = active(partnerRows);
  /*
   * ค่าเริ่มต้นของงานที่ยังไม่ได้เลือก — เกือบทุกงานเข้าแหลมฉบังและใช้ SHIPME
   * จับจาก Master Data ด้วยรหัส/ชื่อ ไม่ผูก id ตรง ๆ เผื่อ Master Data ถูกสร้างใหม่
   */
  const defaultPortId =
    ports.find((p) => p.code === 'THLCH')?.id
    ?? ports.find((p) => /แหลมฉบัง|laem\s*chabang/i.test(p.name))?.id
    ?? null;
  const defaultPartnerId =
    partners.find((p) => /shipme/i.test(p.name))?.id ?? null;
  const sentMap = await doHandoffSentAt(rows.map((r) => r.id));
  const sent = tab === 'sent';

  const columns: Column[] = [
    col.shipper(), col.blNo(), col.consignee(), col.lastDem(),
    {
      // ชื่อไฟล์อยู่คนละบรรทัดกับปุ่ม ช่องจึงแคบลงและชื่อยาวขึ้นบรรทัดใหม่ได้
      label: 'Invoice DO', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.INVOICE_DO} />
          {/* ส่ง Partner แล้วล็อกไว้ ต้องขออนุมัติก่อนจึงแก้ได้ */}
          {sent ? null : (
            <UploadForm jobId={r.id} category="INVOICE_DO"
              label={r.currentFiles?.INVOICE_DO ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} />
          )}
        </div>
      ),
    },
    {
      // แก้ได้ในตารางเลย ทั้ง ETA · Port · Terminal · Partner แล้วกดบันทึกทีเดียว
      label: 'ETA official · Port · Terminal · Partner', kind: 'wrap',
      render: (r) => (
        <DoRowForm
          readOnly={sent}
          jobId={r.id}
          eta={r.eta}
          portId={r.portId ?? defaultPortId}
          terminalId={r.terminalId}
          partnerName={r.releasePartner}
          defaultPartnerId={defaultPartnerId}
          ports={ports}
          terminals={terminals}
          partners={partners}
          sentAt={sentMap.get(r.id) ?? null}
        />
      ),
    },
    // แถบรอส่งไม่ต้องมีคอลัมน์นี้ จะได้ไม่เหลือช่องว่างเปล่า ๆ ทั้งตาราง
    ...(sent
      ? [{
          label: 'จัดการ', kind: 'actions' as const,
          render: (r: JobRow) => <RequestEditButton jobId={r.id} />,
        }]
      : []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>Upload InvDO / ETA Official / Terminal / Send Partner</h1>
        <p>ใส่ ETA official (บันทึกแล้วขึ้น OFC และใช้เป็นวันหลัก) · Port · Terminal · Partner แล้วจึงส่ง Partner</p>
      </div>
      <Tabs basePath="/fah/do" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/fah/do"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={tab === 'sent' ? 'ยังไม่มีงานที่ส่ง Partner แล้ว' : 'ไม่มีงานรอส่ง Partner'}
        hint="Port · Terminal · Partner มาจาก Master Data · กดส่ง Partner แล้วงานจะย้ายไปแท็บ ส่ง Partner แล้ว"
      />
    </>
  );
}
