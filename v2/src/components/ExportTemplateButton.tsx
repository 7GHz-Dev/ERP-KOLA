/**
 * ปุ่มดาวน์โหลดตารางงานตามแบบฟอร์มที่ทีมใช้กันอยู่
 *
 * เป็นลิงก์ธรรมดา ไม่ใช่ปุ่มที่ต้องใช้ JavaScript เพราะเบราว์เซอร์โหลดไฟล์เองได้อยู่แล้ว
 * ตัวไฟล์สร้างที่ /api/jobs-template ซึ่งดึงข้อมูลสดทุกครั้งที่กด
 */
export function ExportTemplateButton({
  scope = 'approved', label,
}: {
  /** approved = เฉพาะงานที่อนุมัติเข้าตารางหลักแล้ว · all = ทุกงาน */
  scope?: 'approved' | 'all';
  label?: string;
}) {
  return (
    <a className="button tiny" href={`/api/jobs-template?scope=${scope}`} download>
      {label ?? 'Export ตารางงาน'}
    </a>
  );
}
