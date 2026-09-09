import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { UploadForm } from '@/components/ActionForms';
import { DoPayCards } from '@/components/DoPayCards';
import { formatDateTime } from '@/lib/format';
import { claimAmount } from '@/lib/do-claim';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'รอตั้งเบิก' },
  { key: 'claimed', label: 'ตั้งเบิกแล้ว' },
];
const SEARCH_KEYS = ['blNo', 'consignee', 'entryNo'];

/**
 * MAY — รายการรอแลก DO ชุดเดียวกับของ ANN แต่ทำคนละอย่าง
 *
 * MAY ไม่ได้ทำจดหมายหรือรวมชุด หน้าที่คือดู Invoice DO แล้วกรอกยอดที่ต้องจ่าย
 * และคัดลอกข้อความไปเบิกเงิน คอลัมน์จึงเหลือเฉพาะที่ใช้ระบุงานกับที่ต้องใช้ทำงานนั้น
 *
 * แยกสองแท็บด้วยเวลาที่กดตั้งเบิก แต่ทั้งสองแท็บยังอยู่ใต้คิวรอแลก DO เดียวกับ ANN
 * งานที่ ANN กดส่งแลกแล้วจึงหายไปจากหน้านี้เองโดยไม่ต้องทำอะไรเพิ่ม
 *
 * ใช้งานบนมือถือเป็นหลัก จอแคบแสดงเป็นการ์ด จอกว้างแสดงเป็นตาราง
 */
export default async function MayDoPayPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['MAY']);
  const params = readParams(await searchParams, SEARCH_KEYS);
  const { one, search, carry } = params;
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';
  const claimed = tab === 'claimed';
  /*
   * ฝั่งรอตั้งเบิกเรียงจากใบที่เข้าคิวก่อน ให้ไล่ทำจากบนลงล่างได้ตามลำดับที่มาถึง
   * ตรงกับลำดับที่ปุ่ม "ดูไฟล์ต่อไป" ในแผงพาไป สองทางจึงไม่สลับกัน
   */
  const sortBy = params.sortBy ?? 'arrivedAt';
  const sortDir = params.sortBy ? params.sortDir : (claimed ? 'desc' : 'asc');

  const { rows, total } = await listJobs({
    where: QUEUE.mayDoPay(tab as 'wait' | 'claimed'), search, sortBy, sortDir,
  });

  const columns: Column[] = [
    {
      /*
       * ปุ่มดู — เปิดแผงที่มี Invoice DO คู่กับช่องกรอกยอดและข้อความเบิก
       * เป็นลิงก์จริง ไม่ใช่ปุ่มเปิดแผงในหน้า จึงส่งต่อและกดรีเฟรชได้
       *
       * อยู่คอลัมน์แรกเพราะเป็นสิ่งที่ต้องกดทุกแถว ไม่ต้องกวาดตาไปสุดขวาก่อน
       * ยอดที่บันทึกไว้แล้วขึ้นใต้ปุ่ม จะได้รู้ว่าใบไหนกรอกแล้วโดยไม่ต้องเปิดทีละใบ
       */
      label: 'ยอดชำระ', kind: 'wrap', className: 'col-do-pay',
      render: (r) => (
        <div className="do-pay-cell">
          <Link className="button tiny primary" href={`/may/do-pay/${r.id}`}>ดู</Link>
          {r.doPayAmount ? <b>{claimAmount(r.doPayAmount)}</b> : null}
        </div>
      ),
    },
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
      /*
       * MAY เป็นคนจ่ายเงินค่าแลก D/O จึงถือสลิปตัวจริง อัปได้จากแถวนี้เลย
       * อัปเสร็จอยู่หน้าเดิม ไม่เด้งไปแผงดูไฟล์ จะได้อัปใบถัดไปต่อได้ทันที
       */
      label: 'Slip โอนเงิน', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.DO_SLIP;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {claimed ? null : (
              <UploadForm
                jobId={r.id}
                category="DO_SLIP"
                label={file ? 'เปลี่ยนไฟล์' : 'อัปโหลด Slip'}
                stayHere
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>รอแลก DO — ยอดชำระ</h1>
        <p>
          เปิดดู Invoice DO · กรอกยอดที่ต้องชำระ · คัดลอกข้อความเบิก ·
          แล้วกดตั้งเบิกเพื่อไปใบถัดไป
        </p>
      </div>
      <Tabs basePath="/may/do-pay" items={TABS} active={tab} carry={carry} />

      {/* จอมือถือใช้การ์ด จอใหญ่ใช้ตาราง สลับด้วย CSS ข้อมูลเป็นชุดเดียวกัน */}
      <div className="only-narrow">
        <DoPayCards rows={rows} claimed={claimed} />
        {rows.length ? null : (
          <p className="do-cards-empty">
            {claimed ? 'ยังไม่มีงานที่ตั้งเบิกแล้ว' : 'ยังไม่มีงานที่รอตั้งเบิก'}
          </p>
        )}
      </div>

      <div className="only-wide">
        <JobTable
          basePath="/may/do-pay"
          columns={columns}
          rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
          empty={claimed ? 'ยังไม่มีงานที่ตั้งเบิกแล้ว' : 'ยังไม่มีงานที่รอตั้งเบิก'}
          hint={claimed
            ? 'รายการที่คัดลอกข้อความไปตั้งเบิกแล้ว · งานที่ ANN กดส่งแลกแล้วจะหายไปจากหน้านี้'
            : 'กดปุ่ม ดู ที่ต้นแถวเพื่อเปิด Invoice DO คู่กับช่องกรอกยอด · อัป Slip ได้จากในแถว · ในแผงมีปุ่มไปใบถัดไปให้ไล่ทำจนครบ'}
        />
      </div>
    </>
  );
}
