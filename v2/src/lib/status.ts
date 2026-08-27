/**
 * คำอธิบายสถานะงาน ยกมาจากระบบเดิมทั้งชุด
 * ให้ Drawer และไทม์ไลน์อ่านเหมือนที่ทีมคุ้นอยู่แล้ว ไม่ต้องจำรหัสใหม่
 */
export const STATUS_LABELS: Record<string, string> = {
  WAITING_ARRIVAL_NOTICE_BL: 'BL Waiting Confirm',
  WAITING_ENTER_BL: 'Waiting ENTER BL',
  WAITING_AN_APPROVAL: 'รอ NAMKANG อนุมัติ AN',
  AN_REJECTED: 'AN ไม่อนุมัติ',
  AN_APPROVED: 'AN อนุมัติแล้ว',
  WAITING_INVOICE_DO: 'Waiting Invoice / DO',
  WAITING_FN_APPROVAL: 'รอ FAH อนุมัติ Final Invoice',
  FN_REJECTED: 'Final Invoice ไม่อนุมัติ',
  FN_APPROVED: 'Final Invoice อนุมัติแล้ว',
  DO_SENT: 'ส่ง DO ให้ Partner แล้ว',
  ENTRY_DRAFTED: 'Entry Drafted',
  DRAFT_REJECTED: 'Draft ถูกตีกลับ',
  CUSTOMS_FILED: 'Entry Filed',
  PORT_RELEASED: 'Port Released',
  RELEASED: 'Released',
};

export function statusLabel(status: string | null | undefined) {
  if (!status) return '-';
  return STATUS_LABELS[status] ?? status;
}

/** สีป้ายสถานะ ใช้เกณฑ์เดียวกับระบบเดิม */
export function statusTone(status: string | null | undefined) {
  const s = status ?? '';
  if (/REJECTED/.test(s)) return 'rejected';
  if (/WAITING|DRAFTED/.test(s)) return 'pending';
  if (/APPROVED|FILED|RELEASED|SENT/.test(s)) return 'approved';
  return 'neutral';
}

export function surrenderLabel(status: string | null | undefined) {
  return {
    PENDING: 'รอตรวจ Surrender',
    CLEARED: 'Surrender เคลียร์แล้ว',
    ISSUE: 'Surrender มีปัญหา',
  }[status ?? 'PENDING'] ?? 'รอตรวจ Surrender';
}
