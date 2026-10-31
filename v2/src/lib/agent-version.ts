/**
 * เวอร์ชันของโค้ดฝั่งเครื่องในออฟฟิศ (worker · ตัว monitor ใบขน · ตัวเปิดลิงก์ · ตัวติดตั้ง)
 *
 * เพิ่มเลขทุกครั้งที่แก้โค้ดที่รันบนเครื่อง (scripts/, scripts/install/, public/install/) แล้ว push
 * ERP ที่ deploy แล้วถือเลขนี้เป็น "ล่าสุด" — เครื่องที่เลขต่ำกว่าอัปเดตตัวเองเบื้องหลัง
 * ตอนเปิด Windows และทุกครั้งที่ตัวเปิดถูกเรียก (กดปุ่ม/ลิงก์บนเว็บ) ดู start-worker.ps1 ใน windows-worker-launcher.ps1
 *
 * รูปแบบ ปี.เดือน.วัน.ครั้งที่ — ตัวเปิดบน Windows อ่านเลขจากไฟล์นี้ด้วย regex (AGENT_VERSION = '…') อย่าเปลี่ยนรูปบรรทัด
 * ไฟล์นี้ไม่แตะฐานข้อมูล worker ในเครื่อง import ได้ตรง ๆ
 */
export const AGENT_VERSION = '2026.10.31.1';

/** เทียบเลขเวอร์ชันทีละส่วน — ค่าว่าง/อ่านไม่ออกถือว่าเก่าที่สุด */
export function compareVersion(a: string | null | undefined, b: string | null | undefined) {
  const parts = (v: string | null | undefined) => String(v ?? '').split('.').map((x) => Number(x) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const isLatestAgent = (version: string | null | undefined) =>
  Boolean(version) && compareVersion(version, AGENT_VERSION) >= 0;
