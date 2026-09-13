/**
 * ปุ่มดาวน์โหลดตารางงานตามแบบฟอร์มที่ทีมใช้กันอยู่
 *
 * เป็นลิงก์ธรรมดา ไม่ใช่ปุ่มที่ต้องใช้ JavaScript เพราะเบราว์เซอร์โหลดไฟล์เองได้อยู่แล้ว
 * ตัวไฟล์สร้างที่ /api/jobs-template ซึ่งดึงข้อมูลสดทุกครั้งที่กด
 */
export function ExportTemplateButton({
  scope = 'approved', label, createdFrom, createdTo,
}: {
  /** approved = เฉพาะงานที่อนุมัติเข้าตารางหลักแล้ว · all = ทุกงาน */
  scope?: 'approved' | 'all';
  label?: string;
  createdFrom?: string;
  createdTo?: string;
}) {
  const params = new URLSearchParams({ scope });
  if (createdFrom) params.set('createdFrom', createdFrom);
  if (createdTo) params.set('createdTo', createdTo);
  return (
    <a className="button tiny" href={`/api/jobs-template?${params}`} download>
      {label ?? 'Export ตารางงาน'}
    </a>
  );
}
