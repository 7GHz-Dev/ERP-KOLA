import Link from 'next/link';
import { DoAttachments } from '@/components/DoAttachments';
import type { DoAttachment } from '@/lib/do-attachments';
import { claimAmounts } from '@/lib/do-claim';
import { addDays, formatDate, formatDateTime } from '@/lib/format';
import type { JobRow } from '@/lib/queries/jobs';
import { DoPayCheckbox } from '@/components/DoPaySelection';

/**
 * รายการแบบการ์ดสำหรับจอมือถือ — ใช้แทนตารางที่ต้องเลื่อนซ้ายขวา
 *
 * ตารางของระบบกว้างขั้นต่ำ 900px ซึ่งบนมือถืออ่านทีละคอลัมน์ไม่ไหว
 * การ์ดใบหนึ่งคืองานหนึ่ง วางเฉพาะข้อมูลที่ MAY ใช้ระบุใบกับปุ่มที่ต้องกด
 * ตัวตารางยังอยู่ครบสำหรับจอใหญ่ สองแบบใช้ข้อมูลชุดเดียวกัน สลับด้วย CSS อย่างเดียว
 */
export function DoPayCards({
  rows, claimed, slips,
}: {
  rows: JobRow[];
  claimed: boolean;
  /** Slip ทุกใบของแต่ละงาน — มีได้หลายใบ ใบละหัวข้อ */
  slips: Record<string, DoAttachment[]>;
}) {
  if (!rows.length) return null;
  return (
    <div className="do-cards">
      {rows.map((r) => (
        <article className="do-card" key={r.id}>
          <div className="do-card-head">
            <DoPayCheckbox id={r.id} label={r.blNo ?? r.jobNo} />
            <div>
              <b>{r.blNo ?? '-'}</b>
              <small>{r.consigneeName ?? '-'}</small>
            </div>
            {r.doPayAmount ? <span className="do-card-amount">{claimAmounts(r.doPayAmount, r.doDepositAmount, r.doOtherAmount, r.doOtherLabel)}</span> : null}
          </div>

          <dl className="do-card-kv">
            <dt>ETA</dt>
            <dd>{formatDate(r.eta)}{r.etaIsOfficial ? ' (OFC)' : ''}</dd>
            <dt>Last DEM</dt>
            <dd>{formatDate(addDays(r.eta, r.demDays))}</dd>
            <dt>SHIPLINE</dt>
            <dd>{r.shipline ?? '-'}</dd>
            <dt>Terminal</dt>
            <dd>{r.terminalName ?? '-'}</dd>
            <dt>เลขใบขน</dt>
            <dd>{r.declarationNo ?? '-'}</dd>
            <dt>ส่งมาเมื่อ</dt>
            <dd>{formatDateTime(r.arrivedAt)}</dd>
          </dl>

          <div className="do-card-files">
            <span className="do-card-file">
              <small>Invoice DO</small>
              {r.currentFiles?.INVOICE_DO ? (
                <Link className="badge approved file-link" href={`/may/do-pay/${r.id}`} title={r.currentFiles.INVOICE_DO.fileName}>
                  {r.currentFiles.INVOICE_DO.fileName}
                </Link>
              ) : <span className="badge pending">รอดำเนินการ</span>}
            </span>
            <span className="do-card-file">
              <small>Slip</small>
              <DoAttachments jobId={r.id} kind="slip" files={slips[r.id] ?? []} canEdit={!claimed} />
            </span>
          </div>

          {/* ปุ่มเต็มความกว้าง นิ้วโป้งกดพลาดยาก */}
          <Link className="button primary do-card-open" href={`/may/do-pay/${r.id}`}>
            {claimed ? 'ดูรายละเอียด' : 'เปิดดู Invoice DO'}
          </Link>
        </article>
      ))}
    </div>
  );
}
