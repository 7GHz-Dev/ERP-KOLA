import Link from 'next/link';
import { PickAllBox, PickBox } from '@/components/BulkBar';
import { addDays, formatDate, formatDateTime } from '@/lib/format';
import type { HaulRow, HaulView } from '@/lib/queries/haul';

/**
 * ตารางตู้ของแพลนลากตู้ — ใช้ทั้งหน้า NAMKANG และหน้า MAY
 * แถวละตู้ ติ๊กได้ทุกแถวเมื่อ pickable (แถบเลือกหลายรายการอยู่ที่หน้า)
 * Last Date of DEM อยู่ใกล้วันลากตู้ เพราะเป็นตัวกำหนดว่าต้องลากก่อนวันไหน
 */
export function HaulTable({ rows, view, pickable }: { rows: HaulRow[]; view: HaulView; pickable: boolean }) {
  const planned = view !== 'wait';
  const cols = 10 + (pickable ? 1 : 0) + (planned ? 1 : 0);
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {pickable ? <th className="col-pick"><PickAllBox /></th> : null}
            <th className="col-no">No.</th>
            {planned ? <th>วันลากตู้</th> : null}
            <th>Container No.</th>
            <th>ประเภท</th>
            <th>เลขประจำตู้</th>
            <th>BL No.</th>
            <th>Consignee</th>
            <th>Terminal</th>
            <th>ETA</th>
            <th>Last Date of DEM</th>
            <th>{{ wait: 'ส่ง Partner เมื่อ', sent: 'สถานะแพลน', new: 'ส่งแพลนเมื่อ', ack: 'รับแพลนเมื่อ' }[view]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="empty" colSpan={cols}>
              {view === 'wait' ? 'ไม่มีตู้รอวางแพลน'
                : view === 'sent' ? 'ยังไม่ได้ส่งแพลน'
                : view === 'new' ? 'ไม่มีแพลนใหม่' : 'ยังไม่มีแพลนที่รับแล้ว'}
            </td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.containerId}>
              {pickable ? <td className="col-pick"><PickBox id={r.containerId} /></td> : null}
              <td>{i + 1}</td>
              {planned ? <td><b>{formatDate(r.haulDate)}</b></td> : null}
              <td><b>{r.containerNo ?? '-'}</b></td>
              <td>{r.containerType ?? '-'}</td>
              <td>{r.runningNo ?? '-'}</td>
              <td><Link href={`/job/${r.jobId}`}>{r.blNo || r.jobNo}</Link></td>
              <td>{r.consigneeName ?? '-'}</td>
              <td>{r.terminalName ?? '-'}</td>
              <td>{formatDate(r.eta)}</td>
              <td>{formatDate(addDays(r.eta, r.demDays))}</td>
              {view === 'wait' ? <td>{formatDateTime(r.eofficeSentAt)}</td>
                : view === 'ack' ? <td>{formatDateTime(r.ackAt)}</td>
                : view === 'new' ? <td>{formatDateTime(r.sentAt)}</td>
                : (
                  <td>
                    {r.ackAt
                      ? <span className="badge approved">MAY รับแพลนแล้ว</span>
                      : <span className="badge pending">รอ MAY รับแพลน</span>}
                  </td>
                )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** ช่องค้นหาของหน้าแพลนลากตู้ — อยู่นอกตาราง และมีปุ่ม submit จริง (กติกาใน README) */
export function HaulSearch({ basePath, tab, q }: { basePath: string; tab: string; q: string }) {
  return (
    <form className="filter-bar" method="get" action={basePath}>
      <input type="hidden" name="tab" value={tab} />
      <input type="search" name="q" defaultValue={q} placeholder="ค้นหา BL · Container · Job · Consignee" />
      <button className="button tiny" type="submit">ค้นหา</button>
      {q ? <a className="button tiny" href={`${basePath}?tab=${tab}`}>ล้าง</a> : null}
    </form>
  );
}
