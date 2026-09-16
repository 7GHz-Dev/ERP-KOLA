/**
 * หน้าแรกของแต่ละ role
 *
 * ทุกคนเคยถูกพาไปหน้าภาพรวมงานหลังล็อกอิน แต่ role ที่ไม่ได้ดูแลงานทั้งระบบ
 * (ANN · MAY · ACCOUNT ซึ่งเป็นพนักงาน SHIPME) ไม่มีเมนูนั้นในแถบซ้ายอยู่แล้ว
 * เปิดมาเจอหน้าที่ตัวเองไม่ได้ใช้ ต้องกดไปหาเมนูตัวเองทุกครั้ง
 *
 * พาไปหน้างานของตัวเองเลย ส่วน role ที่ดูแลงานทั้งระบบยังเข้าภาพรวมเหมือนเดิม
 * ใช้ที่เดียวกันทั้งตอนล็อกอิน เปิด / และหลังเปลี่ยนรหัสผ่าน จะได้ไม่หลุดทางใดทางหนึ่ง
 */
const HOME: Record<string, string> = {
  ACCOUNT: '/account/invoice-print',
  MAY: '/may/do-pay',
  ANN: '/do-exchange',
};

export function homePageFor(role: string | null | undefined): string {
  return HOME[String(role ?? '')] ?? '/overview';
}
