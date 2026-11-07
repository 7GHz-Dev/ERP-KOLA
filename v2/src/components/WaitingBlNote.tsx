import type { WaitingMatch } from '@/lib/actions/waiting-bl';

/**
 * เตือนบนหน้ารับ AN ว่า BL นี้อยู่ใน Waiting BL — โชว์ข้อมูลที่ NAMKANG / FAH กรอกไว้ให้เทียบ
 * ไม่ขวางการบันทึก รายการจะถูกปิดเองตอนอนุมัติ AN เข้าตารางหลัก
 */
export function WaitingBlNote({ matches, compact }: { matches: WaitingMatch[]; compact?: boolean }) {
  if (!matches.length) return null;
  return (
    <small className="wbl-alert">
      📌 <b>BL นี้อยู่ใน Waiting BL</b> — ลูกค้าแจ้งข้อมูลมาก่อนแล้ว ตรวจให้ตรงกับ AN ก่อนบันทึก
      {compact ? null : matches.map((m) => (
        <span key={m.blNo + m.createdAt} style={{ display: 'block' }}>
          <b>{m.blNo}</b>
          {[
            m.customer && `ลูกค้า ${m.customer}`,
            m.shipper && `Shipper ${m.shipper}`,
            m.vessel && `เรือ ${m.vessel}`,
            m.eta && `ETA ${m.eta.split('-').reverse().join('/')}`,
            m.containerNos && `ตู้ ${m.containerNos}`,
            m.note,
          ].filter(Boolean).map((t) => ` · ${t}`).join('')}
          {` · แจ้งโดย ${m.createdByName ?? '-'}${m.channel ? ` ทาง ${m.channel}` : ''}`}
        </span>
      ))}
    </small>
  );
}
