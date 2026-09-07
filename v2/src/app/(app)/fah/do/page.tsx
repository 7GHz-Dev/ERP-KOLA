import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RequestEditButton, UploadForm } from '@/components/ActionForms';
import { DoRowForm } from '@/components/DoRowForm';
import { DoFillBoard } from '@/components/DoFillBoard';
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
  await requireUserReady(['FAH']);
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
          {/*
            ส่ง Partner แล้วล็อกไว้ ต้องขออนุมัติก่อนจึงแก้ได้

            อัปหรือเปลี่ยนไฟล์เสร็จให้กลับมาที่หน้าเดิมพร้อม ?fill=<งาน>
            แผงกรอกคู่กับไฟล์จะเปิดให้เอง ได้กรอกต่อทันทีโดยไม่ต้องกดปุ่มอีกที
            ไม่ใช้แผงดูไฟล์ปกติ เพราะแผงของหน้านี้แสดงไฟล์อยู่แล้ว
          */}
          {sent ? null : (
            <UploadForm
              jobId={r.id}
              category="INVOICE_DO"
              thenOpen={`/fah/do?${new URLSearchParams({ ...carry, tab, fill: r.id })}`}
              label={r.currentFiles?.INVOICE_DO ? 'เปลี่ยนไฟล์' : 'อัปโหลด'}
            />
          )}
        </div>
      ),
    },
    {
      /*
       * ฝั่งรอส่งกรอกในแผงซ้ายคู่กับไฟล์ ตารางจึงเหลือไว้อ่านอย่างเดียว
       * เดิมยัดสี่ช่องกับสองปุ่มไว้ในเซลล์เดียวจนซ้อนกันสามบรรทัด
       * และพอเปิดไฟล์ดูยอดก็บังตารางอีก กรอกไปดูไปไม่ได้สักทาง
       *
       * ฝั่งที่ส่งแล้วยังเป็นแผงอ่านค่าแบบเดิม เพราะแก้อะไรไม่ได้อยู่แล้ว
       */
      label: 'ETA official · Port · Terminal · Partner', kind: 'wrap',
      render: (r) => (
        <DoRowForm
          readOnly
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
      : [{
          /*
           * ปุ่มเปิดแผงกรอกคู่กับไฟล์
           * เป็นปุ่มเปล่า ๆ ที่ตารางเรนเดอร์ฝั่งเซิร์ฟเวอร์ได้ ส่วนตัวจัดการคลิก
           * อยู่ที่ DoFillBoard ซึ่งดักจาก data-fill-job ที่ชั้นนอกทีเดียว
           */
          label: 'กรอกข้อมูล', kind: 'actions' as const,
          render: (r: JobRow) => (
            <button type="button" className="button tiny fill-open" data-fill-job={r.id}>
              กรอกข้อมูล
            </button>
          ),
        }]),
  ];

  const table = (
    <JobTable
      basePath="/fah/do"
      columns={columns}
      rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
      empty={tab === 'sent' ? 'ยังไม่มีงานที่ส่ง Partner แล้ว' : 'ไม่มีงานรอส่ง Partner'}
      hint={sent
        ? 'ขอแก้ไขได้ที่ปุ่มท้ายแถว'
        : 'กดปุ่ม "กรอกข้อมูล" เพื่อเปิดแผงกรอกคู่กับ Invoice DO · ดับเบิลคลิกที่แถวเพื่อดูสรุปงาน · อัปไฟล์แล้วแผงเปิดให้เอง'}
    />
  );

  return (
    <>
      <div className="page-head">
        <h1>Upload InvDO / ETA Official / Terminal / Send Partner</h1>
        <p>ใส่ ETA official (บันทึกแล้วขึ้น OFC และใช้เป็นวันหลัก) · Port · Terminal · Partner แล้วจึงส่ง Partner</p>
      </div>
      <Tabs basePath="/fah/do" items={TABS} active={tab} carry={carry} />
      {sent ? table : (
        <DoFillBoard
          jobs={rows.map((r) => ({
            id: r.id,
            jobNo: r.jobNo,
            blNo: r.blNo,
            consigneeName: r.consigneeName,
            eta: r.eta,
            portId: r.portId,
            terminalId: r.terminalId,
            releasePartner: r.releasePartner,
            invoiceFileId: r.currentFiles?.INVOICE_DO?.id ?? null,
            invoiceFileName: r.currentFiles?.INVOICE_DO?.fileName ?? null,
          }))}
          ports={ports}
          terminals={terminals}
          partners={partners}
          defaultPortId={defaultPortId}
          defaultPartnerId={defaultPartnerId}
          sentAt={Object.fromEntries(sentMap)}
          openFor={one('fill') || null}
        >
          {table}
        </DoFillBoard>
      )}
    </>
  );
}
