import Link from 'next/link';
import { FileChip } from '@/components/JobTable';
import { UploadForm } from '@/components/ActionForms';
import { claimAmount } from '@/lib/do-claim';
import { addDays, formatDate, formatDateTime } from '@/lib/format';
import type { JobRow } from '@/lib/queries/jobs';

/**
 * รายการแบบการ์ดสำหรับจอมือถือ — ใช้แทนตารางที่ต้องเลื่อนซ้ายขวา
 *
 * ตารางของระบบกว้างขั้นต่ำ 900px ซึ่งบนมือถืออ่านทีละคอลัมน์ไม่ไหว
 * การ์ดใบหนึ่งคืองานหนึ่ง วางเฉพาะข้อมูลที่ MAY ใช้ระบุใบกับปุ่มที่ต้องกด
 * ตัวตารางยังอยู่ครบสำหรับจอใหญ่ สองแบบใช้ข้อมูลชุดเดียวกัน สลับด้วย CSS อย่างเดียว
 */
export function DoPayCards({ rows, claimed }: { rows: JobRow[]; claimed: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="do-cards">
      {rows.map((r) => (
        <article className="do-card" key={r.id}>
          <div className="do-card-head">
            <div>
              <b>{r.blNo ?? '-'}</b>
              <small>{r.consigneeName ?? '-'}</small>
            </div>
            {r.doPayAmount ? <span className="do-card-amount">{claimAmount(r.doPayAmount)}</span> : null}
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
              <FileChip file={r.currentFiles?.INVOICE_DO} />
            </span>
            <span className="do-card-file">
              <small>Slip</small>
              <FileChip file={r.currentFiles?.DO_SLIP} />
              {claimed ? null : (
                <UploadForm
                  jobId={r.id}
                  category="DO_SLIP"
                  label={r.currentFiles?.DO_SLIP ? 'เปลี่ยน' : 'อัป Slip'}
                  stayHere
                />
              )}
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
