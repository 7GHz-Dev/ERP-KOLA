import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, FileChip, type Column } from '@/components/JobTable';
import { formatDateTime } from '@/lib/format';
import { claimAmount } from '@/lib/do-claim';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const SEARCH_KEYS = ['blNo', 'consignee', 'entryNo'];

/**
 * MAY — รายการรอแลก DO ชุดเดียวกับของ ANN แต่ดูอย่างเดียว
 *
 * MAY ไม่ได้ทำจดหมายหรือรวมชุด หน้าที่คือดู Invoice DO แล้วกรอกยอดที่ต้องจ่าย
 * และคัดลอกข้อความไปเบิกเงิน คอลัมน์จึงเหลือเฉพาะที่ใช้ระบุงานกับที่ต้องใช้ทำงานนั้น
 * ใช้ QUEUE.doExchange('wait') ตัวเดียวกับ ANN สองหน้าจึงเห็นรายการตรงกันเสมอ
 */
export default async function MayDoPayPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['MAY']);
  const params = readParams(await searchParams, SEARCH_KEYS);
  const { search, carry } = params;
  // เรียงตามเวลาที่รายการส่งเข้ามา ใหม่สุดอยู่บน เหมือนหน้าของ ANN
  const sortBy = params.sortBy ?? 'arrivedAt';
  const sortDir = params.sortDir;

  const { rows, total } = await listJobs({
    where: QUEUE.doExchange('wait'), search, sortBy, sortDir,
  });

  const columns: Column[] = [
    {
      label: 'วันที่ส่งรายการมา', sortKey: 'arrivedAt', kind: 'wrap',
      render: (r) => formatDateTime(r.arrivedAt),
    },
    col.eta(), col.lastDem(),
    col.blNo(), col.consignee(), col.declarationNo(),
    {
      label: 'SHIPLINE', kind: 'wrap', className: 'col-shipline',
      render: (r) => r.shipline ?? '-',
    },
    col.terminal(),
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
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.DO_SLIP} />
        </div>
      ),
    },
    {
      /*
       * ปุ่มดู — เปิดแผงที่มี Invoice DO คู่กับช่องกรอกยอดและข้อความเบิก
       * เป็นลิงก์จริง ไม่ใช่ปุ่มเปิดแผงในหน้า จึงส่งต่อและกดรีเฟรชได้
       * ยอดที่บันทึกไว้แล้วขึ้นข้างปุ่ม จะได้รู้ว่าใบไหนกรอกแล้วโดยไม่ต้องเปิดทีละใบ
       */
      label: 'ยอดชำระ', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          {r.doPayAmount ? (
            <b className="do-pay-cell">{claimAmount(r.doPayAmount)}</b>
          ) : null}
          <Link className="button tiny primary" href={`/may/do-pay/${r.id}`}>ดู</Link>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>รอแลก DO — ยอดชำระ</h1>
        <p>
          กดปุ่ม ดู เพื่อเปิด Invoice DO · กรอกยอดที่ต้องชำระ ·
          แล้วคัดลอกข้อความเบิกไปวางได้เลย
        </p>
      </div>
      <JobTable
        basePath="/may/do-pay"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ยังไม่มีงานที่รอแลก DO"
        hint="รายการชุดเดียวกับหน้าจัดการแลก DO ของ ANN · งานที่ ANN กดส่งแลกแล้วจะหายไปจากหน้านี้"
      />
    </>
  );
}
