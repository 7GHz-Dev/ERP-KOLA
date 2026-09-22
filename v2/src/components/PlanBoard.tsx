import Link from 'next/link';
import { addDays, formatDate, formatDateTime } from '@/lib/format';
import { claimAmount } from '@/lib/do-claim';
import type { PlanRow, PlanTrack } from '@/lib/queries/do-plans';

/**
 * หน้า Plan แลก DO ที่ ANN กับ MAY ใช้ร่วมกัน
 *
 * ทั้งสองคนทำคนละอย่างบนงานชุดเดียวกัน (ANN ทำจดหมาย·รวมชุด·ส่งแลก / MAY กรอกยอด·ตั้งเบิก)
 * สิ่งที่ทั้งคู่ต้องการเหมือนกันคือ "ชุดของวันนี้มีกี่ใบ และเหลือใบไหน"
 * จึงเป็น component เดียวกัน ต่างแค่ช่องที่นับว่าเสร็จและลิงก์ที่พาไปทำงานต่อ
 *
 * จัดเป็นการ์ดต่อหนึ่ง Plan ไม่ใช่ตารางยาวใบเดียว เพราะหน่วยของงานที่นี่คือ "ชุด"
 * ต้องเห็นขอบของชุดชัด ๆ ว่าเริ่มตรงไหนจบตรงไหน ถึงจะรู้ว่าตกหล่นใบไหน
 */
export function PlanBoard({ plans, track, emptyText }: {
  plans: PlanRow[];
  track: PlanTrack;
  emptyText: string;
}) {
  if (!plans.length) return <p className="do-cards-empty">{emptyText}</p>;

  return (
    <div className="plan-board">
      {plans.map((plan) => (
        <section key={plan.id} className={`plan-card ${plan.progress.complete ? 'done' : ''}`}>
          <header className="plan-card-head">
            <div>
              <b>{plan.planNo}</b>
              <span className="plan-date">แลกวันที่ {formatDate(plan.planDate)}</span>
            </div>
            <div className="plan-progress">
              <span className={`badge ${plan.progress.complete ? 'approved' : 'pending'}`}>
                {plan.progress.done} / {plan.progress.total} รายการ
              </span>
              {/*
                แถบความคืบหน้าเป็นตัวที่กวาดตาเห็นก่อนตัวเลข
                เวลามีหลายชุดบนจอเดียว จะได้รู้ทันทีว่าชุดไหนยังเหลือเยอะ
              */}
              <span className="plan-bar" aria-hidden="true">
                <span style={{ width: `${plan.progress.total ? Math.round((plan.progress.done / plan.progress.total) * 100) : 0}%` }} />
              </span>
            </div>
          </header>

          <p className="plan-meta">
            สร้างโดย {plan.createdByName ?? '-'} · {formatDateTime(plan.createdAt)}
            {plan.note ? <> · <i>{plan.note}</i></> : null}
          </p>

          <table className="table plan-table">
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>BL No.</th>
                <th>Consignee</th>
                <th>Vessel / Voyage</th>
                <th>Last Date of DEM</th>
                <th>SHIPLINE</th>
                <th>Terminal</th>
                <th>{track === 'exchange' ? 'จดหมาย · Slip · ชุดแลก' : 'Invoice DO · Slip · ยอด'}</th>
                <th>ทำต่อ</th>
              </tr>
            </thead>
            <tbody>
              {plan.jobs.map((job) => (
                <tr key={job.id} className={job.doneAt ? 'plan-row-done' : ''}>
                  <td>
                    {job.doneAt
                      ? <span className="badge approved">{track === 'exchange' ? 'ส่งแลกแล้ว' : 'ตั้งเบิกแล้ว'}</span>
                      : <span className="badge pending">ยังไม่ทำ</span>}
                  </td>
                  <td>{job.blNo ?? job.jobNo}</td>
                  <td>{job.consigneeName ?? '-'}</td>
                  <td>{[job.vessel, job.voyage].filter(Boolean).join(' / ') || '-'}</td>
                  <td>{formatDate(addDays(job.eta, job.demDays))}</td>
                  <td>{job.shipline ?? '-'}</td>
                  <td>{job.terminalName ?? '-'}</td>
                  <td className="plan-marks">
                    {track === 'exchange' ? (
                      <>
                        <Mark on={job.hasSlip} label="Slip" />
                        <Mark on={job.hasMerged} label="ชุดแลก" />
                      </>
                    ) : (
                      <>
                        <Mark on={job.hasInvoiceDo} label="Invoice DO" />
                        <Mark on={job.hasSlip} label="Slip" />
                        {job.doPayAmount ? <b>{claimAmount(job.doPayAmount)}</b> : <span className="badge pending">ยังไม่กรอกยอด</span>}
                      </>
                    )}
                  </td>
                  <td>
                    {/*
                      พาไปหน้าที่ทำงานจริง ไม่ได้ให้กดทำจากหน้านี้
                      หน้านี้มีหน้าที่บอกว่าเหลือใบไหน ส่วนขั้นตอนทำงานยังอยู่ที่เดิมทั้งหมด
                      ถ้าย้ายมาทำที่นี่ด้วยจะกลายเป็นสองที่ที่ทำเรื่องเดียวกัน
                    */}
                    {track === 'exchange'
                      ? <Link className="button tiny" href={`/do-exchange?blNo=${encodeURIComponent(job.blNo ?? '')}`}>ไปจัดการแลก DO</Link>
                      : <Link className="button tiny primary" href={`/may/do-pay/${job.id}`}>เปิดดู</Link>}
                  </td>
                </tr>
              ))}
              {plan.jobs.length ? null : (
                <tr><td colSpan={9} className="table-empty">ไม่มีรายการในชุดนี้แล้ว</td></tr>
              )}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function Mark({ on, label }: { on: boolean; label: string }) {
  return <span className={`badge ${on ? 'approved' : 'pending'}`}>{on ? '✓' : '—'} {label}</span>;
}
