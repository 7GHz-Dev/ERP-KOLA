import { PickAllBox, PickBox } from '@/components/BulkBar';
import type { Column } from '@/components/JobTable';
import { sheetColumns } from '@/lib/columns';
import { formatDate, formatDateTime } from '@/lib/format';
import type { JobRow } from '@/lib/queries/jobs';
import type { HaulSummary, HaulView } from '@/lib/queries/haul';

/**
 * คอลัมน์ของแพลนลากตู้ — ใช้ทั้งหน้า NAMKANG และหน้า MAY
 *
 * แถวละงานแบบทะเบียนงาน: ช่องติ๊ก · วันลากตู้ · สถานะแพลน แล้วต่อด้วยคอลัมน์ชุดเดียวกับทะเบียนงาน
 * คนที่ดูทะเบียนงานอยู่แล้วจึงอ่านหน้านี้ได้ทันที ไม่ต้องจำตารางใหม่
 * ติ๊กงานแล้วแพลนลงทุกตู้ของงานนั้น (แถบเลือกหลายรายการอยู่ที่หน้า)
 */
export function haulColumns(
  view: HaulView,
  summaries: Map<string, HaulSummary>,
  pickable: boolean,
): Column[] {
  const planDate = (r: JobRow) => {
    const s = summaries.get(r.id);
    if (!s?.firstDate) return '-';
    // ตู้ในงานเดียวกันวันไม่ตรงกัน (แพลนเก่ารายตู้) บอกเป็นช่วง จะได้รู้ว่าต้องตั้งวันใหม่ทั้งงานไหม
    return s.firstDate === s.lastDate
      ? formatDate(s.firstDate)
      : `${formatDate(s.firstDate)} – ${formatDate(s.lastDate)}`;
  };
  const status = (r: JobRow) => {
    const s = summaries.get(r.id);
    if (!s) return '-';
    if (view === 'wait') {
      return s.planned
        ? <span className="badge pending">ส่งแพลนแล้ว {s.planned}/{s.containers} ตู้</span>
        : <span className="badge neutral">ยังไม่ส่งแพลน</span>;
    }
    if (s.acked >= s.planned && s.planned > 0) {
      return <span className="badge approved">MAY รับแล้ว · {formatDateTime(s.ackAt)}</span>;
    }
    return (
      <span className="badge pending">
        รอ MAY รับแพลน{s.acked ? ` (${s.acked}/${s.planned} ตู้)` : ''} · ส่งเมื่อ {formatDateTime(s.sentAt)}
      </span>
    );
  };

  return [
    ...(pickable ? [{
      label: '', kind: 'actions' as const, className: 'col-pick',
      header: <PickAllBox />,
      render: (r: JobRow) => <PickBox id={r.id} />,
    }] : []),
    // วันลากตู้อยู่หน้าสุด เพราะเป็นสิ่งที่หน้านี้ตั้ง/ดู ส่วนแท็บรอวางแพลนบอกวันที่ส่ง Partner แทน
    view === 'wait'
      ? { label: 'ส่ง Partner เมื่อ', render: (r: JobRow) => formatDateTime(r.eofficeSentAt) }
      : { label: 'วันลากตู้', render: (r: JobRow) => <b>{planDate(r)}</b> },
    { label: 'สถานะแพลน', kind: 'wrap' as const, render: status },
    ...sheetColumns(),
  ];
}
