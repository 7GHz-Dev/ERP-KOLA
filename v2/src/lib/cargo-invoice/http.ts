import { currentUser, requireActiveSession, roleAllows, type SessionUser } from '@/lib/auth';

/**
 * อ่านอย่างเดียว (อ่านไฟล์ · หาพิกัด) ตรวจแค่คุกกี้ที่เซ็นชื่อ เหมือนการเปิดหน้าทั่วไปในระบบ
 * ไม่ต้องไปถามฐานข้อมูลทุกครั้ง — การเขียน (เพิ่มพิกัด · บันทึก) ใช้ cargoUser ที่ตรวจ session จริง
 */
export async function cargoReader(): Promise<SessionUser | Response> {
  const user = await currentUser();
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
  if (!roleAllows(user.role, ['PAINT'])) return json({ error: 'คุณไม่มีสิทธิ์ใช้หน้านี้' }, 403);
  return user;
}

/** หน้า Create Cargo Invoice เป็นงานของ PAINT (ADMIN / EMPLOYEE ผ่านด้วย roleAllows) — ใช้กับการเขียนข้อมูล */
export async function cargoUser(): Promise<SessionUser | Response> {
  try {
    const user = await requireActiveSession(['PAINT']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    return user;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'ไม่มีสิทธิ์' }, 401);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * ไฟล์ Invoice จาก FormData — จำกัด 4 MB เพราะ Vercel รับคำขอได้ราว 4.5 MB
 * (ไฟล์ตัวอย่างใหญ่สุด 0.4 MB จึงเหลือที่อีกมาก)
 */
export async function invoiceFile(form: FormData): Promise<{ bytes: Buffer; name: string } | string> {
  const blob = form.get('file');
  if (!(blob instanceof File) || blob.size === 0) return 'กรุณาเลือกไฟล์ Invoice (.xlsx)';
  if (!/\.xlsx$/i.test(blob.name)) return 'รองรับเฉพาะไฟล์ .xlsx — ถ้าเป็น .xls ให้เปิดใน Excel แล้ว Save As เป็น .xlsx';
  if (blob.size > 4 * 1024 * 1024) return 'ไฟล์ต้องไม่เกิน 4 MB';
  return { bytes: Buffer.from(await blob.arrayBuffer()), name: blob.name };
}
