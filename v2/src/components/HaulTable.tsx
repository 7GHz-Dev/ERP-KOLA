import { PickAllBox, PickBox } from '@/components/BulkBar';
import type { Column } from '@/components/JobTable';
import { sheetColumns } from '@/lib/columns';
import { formatDate, formatDateTime } from '@/lib/format';
import { demLeft, demUntil, DO_TEXT, haulRiskOf, SHORT_DET_DAYS, todayBangkok } from '@/lib/haul-risk';
import type { JobRow } from '@/lib/queries/jobs';
import { freeLastDate, freeUrgency, storageLastDate } from '@/lib/free-time';
import type { HaulSummary, HaulView } from '@/lib/queries/haul';

/**
 * คอลัมน์ของแพลนลากตู้ — ใช้ทั้งหน้า NAMKANG (Transport Request) และหน้า MAY
 *
 * แถวละงานแบบทะเบียนงาน: ช่องติ๊ก · วันลากตู้ · สถานะ แล้วตามด้วยข้อมูลที่ใช้ตัดสินใจสั่งลากก่อน
 *   Shipper · จำนวนตู้ · BL · เลขตู้ · สายเรือ · D/O · ท่า · ETA (กรมยืนยันหรือยัง) · free time DEM · DET
 * ที่เหลือเป็นคอลัมน์ทะเบียนงานตามลำดับเดิม คนที่ดูทะเบียนงานอยู่แล้วจึงอ่านต่อได้ทันที
 */
const FRONT = ['SHIPPER', 'CON', 'BILL OF LADING', 'CONTAINER NO.', 'SHIPLINE'] as const;
const HIDDEN = new Set<string>([...FRONT, 'PORT', 'ETA', 'DEM', 'DEM DATE', 'DET', 'DET DATE']);

export function haulColumns(
  view: HaulView,
  summaries: Map<string, HaulSummary>,
  pickable: boolean,
): Column[] {
  const today = todayBangkok();
  const planDate = (r: JobRow) => {
    const s = summaries.get(r.id);
    if (!s?.firstDate) return '-';
    // ตู้ในงานเดียวกันวันไม่ตรงกัน (แพลนเก่ารายตู้) บอกเป็นช่วง จะได้รู้ว่าต้องตั้งวันใหม่ทั้งงานไหม
    return s.firstDate === s.lastDate
      ? formatDate(s.firstDate)
      : `${formatDate(s.firstDate)} – ${formatDate(s.lastDate)}`;
  };
  const ttnBadge = (s: HaulSummary) => {
    if (!s.planned) return null;
    if (s.ttnError) return <span className="badge rejected" title={s.ttnError}>TTN ส่งไม่สำเร็จ</span>;
    if (s.ttnSent >= s.planned) return <span className="badge approved">ถึง TTN แล้ว</span>;
    return <span className="badge neutral">ยังไม่ส่ง TTN{s.ttnSent ? ` (${s.ttnSent}/${s.planned})` : ''}</span>;
  };
  const status = (r: JobRow) => {
    const s = summaries.get(r.id);
    if (!s) return '-';
    if (view === 'wait') {
      return s.planned
        ? <span className="badge pending">สั่งลากแล้ว {s.planned}/{s.containers} ตู้</span>
        : <span className="badge neutral">ยังไม่สั่งลาก</span>;
    }
    const may = s.acked >= s.planned && s.planned > 0
      ? <span className="badge approved">MAY รับแล้ว · {formatDateTime(s.ackAt)}</span>
      : (
        <span className="badge pending">
          รอ MAY รับแพลน{s.acked ? ` (${s.acked}/${s.planned} ตู้)` : ''} · ส่งเมื่อ {formatDateTime(s.sentAt)}
        </span>
      );
    return <span className="haul-badges">{may}{ttnBadge(s)}</span>;
  };
  // วันอ้างอิงของ free time: ยังไม่สั่งลาก = วันนี้ · สั่งแล้ว = วันลากที่ตั้งไว้
  const refDay = (r: JobRow) => (view === 'wait' ? today : summaries.get(r.id)?.firstDate ?? today);

  const sheet = new Map(sheetColumns().map((c) => [c.label, c]));
  const take = (label: string) => sheet.get(label)!;

  const doCol: Column = {
    label: 'D/O',
    kind: 'wrap',
    render: (r) => {
      const stage = haulRiskOf(r).doStage;
      const cls = stage === 'DONE' ? 'approved' : stage === 'SENT' ? 'pending' : 'rejected';
      return (
        <span className={`badge ${cls}`} title={r.doExchangedAt ? `ส่งชุดแลก D/O เมื่อ ${formatDateTime(r.doExchangedAt)}` : undefined}>
          {DO_TEXT[stage]}
        </span>
      );
    },
  };
  const portCol: Column = { ...take('PORT'), label: 'ท่า', render: (r) => <b>{r.terminalName || '-'}</b> };
  const etaCol: Column = {
    ...take('ETA'),
    kind: 'wrap',
    render: (r) => (
      <span className="haul-port">
        <span>{formatDate(r.eta)}</span>
        {r.eta ? (
          r.etaIsOfficial
            ? <small className="ok">กรมยืนยัน</small>
            : <small className="warn" title="ยังไม่ยืนยันจากระบบกรม — เรืออาจเลื่อน ตู้อาจยังไม่ลง">ประมาณ</small>
        ) : null}
      </span>
    ),
  };
  const demCol: Column = {
    label: 'DEM ฟรีถึง',
    kind: 'wrap',
    render: (r) => {
      const risk = haulRiskOf(r);
      const last = demUntil(risk);
      if (!last) return '-';
      const left = demLeft(risk, refDay(r)) ?? 0;
      const cls = left < 0 ? 'rejected' : left <= 1 ? 'pending' : 'neutral';
      return (
        <span className="haul-port">
          <span>{formatDate(last)} <small>({risk.demDays} วัน)</small></span>
          <span className={`badge ${cls}`}>{left < 0 ? `เกิน ${-left} วัน` : left === 0 ? 'วันสุดท้าย' : `เหลือ ${left} วัน`}</span>
        </span>
      );
    },
  };
  const detCol: Column = {
    label: 'DET ฟรีถึง',
    kind: 'wrap',
    render: (r) => {
      const d = r.detDays;
      if (d === null) return 'N/A';
      const last = freeLastDate(r.eta, d);
      if (!last) return '-';
      const u = freeUrgency(last, refDay(r));
      const short = d <= SHORT_DET_DAYS;
      return (
        <span className="haul-port">
          <span>{formatDate(last)} <small>({d} วัน{r.demDetCombined ? ' · Combine' : ''})</small></span>
          {u && u.level !== 'ok' ? <span className="badge rejected">{u.text}</span>
            : short ? <span className="badge rejected" title="free time คืนตู้สั้น — รีบคืน เลี่ยงลากวันศุกร์">DET สั้น</span> : null}
        </span>
      );
    },
  };
  const storageCol: Column = {
    label: 'Storage ฟรีถึง',
    kind: 'wrap',
    render: (r) => {
      const last = storageLastDate(r.eta, r.storageFreeDays);
      if (!last) return '-';
      const u = freeUrgency(last, refDay(r));
      return (
        <span className="haul-port">
          <span>{formatDate(last)} <small>({r.storageFreeDays} วัน)</small></span>
          {u && u.level !== 'ok' ? <span className="badge rejected">{u.text}</span> : null}
        </span>
      );
    },
  };

  return [
    ...(pickable ? [{
      label: '', kind: 'actions' as const, className: 'col-pick',
      header: <PickAllBox />,
      render: (r: JobRow) => <PickBox id={r.id} />,
    }] : []),
    // วันลากตู้อยู่หน้าสุด เพราะเป็นสิ่งที่หน้านี้ตั้ง/ดู ส่วนแท็บรอสั่งลากบอกวันที่ส่ง Partner แทน
    view === 'wait'
      ? { label: 'ส่ง Partner เมื่อ', render: (r: JobRow) => formatDateTime(r.eofficeSentAt) }
      : { label: 'วันลากตู้', render: (r: JobRow) => <b>{planDate(r)}</b> },
    { label: 'สถานะ', kind: 'wrap' as const, render: status },
    ...FRONT.map(take),
    doCol, portCol, etaCol, storageCol, demCol, detCol,
    ...[...sheet.values()].filter((c) => !HIDDEN.has(c.label)),
  ];
}
