import { redirect } from 'next/navigation';

/** เมนู Waiting BL ถูกรวมเข้า Waiting list แล้ว — ลิงก์เก่าที่บันทึกไว้พาไปหน้าใหม่ */
export default function WaitingBlPage() {
  redirect('/waiting-list');
}
