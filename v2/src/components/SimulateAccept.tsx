import { simulateCustomsAccept } from '@/lib/actions/automation';
import { ConfirmSubmit } from '@/components/Interactions';

/**
 * ปุ่ม "จำลอง ACCEPT (ทดสอบ)" — ADMIN ใช้ทดสอบทั้งเส้นทางด้วยไฟล์ทดสอบที่ส่ง Customs จริงไม่ได้
 * ได้เลขใบขน A999… + PDF ทดสอบ แล้วงานไปที่ 4. เตรียมเอกสารเดิน E เหมือนตัว monitor เจอ ACCEPT
 */
export function SimulateAcceptButton({ taskId }: { taskId: string }) {
  return (
    <form action={simulateCustomsAccept} className="inline-form">
      <input type="hidden" name="taskId" value={taskId} />
      <ConfirmSubmit
        label="จำลอง ACCEPT (ทดสอบ)"
        tone="danger"
        confirm="จำลอง ACCEPT ให้งานนี้ใช่ไหม — ใช้กับงานทดสอบเท่านั้น"
        detail="ระบบใส่เลขใบขนทดสอบ (A999…) + PDF ทดสอบลงงานนี้ โดยไม่ผ่าน NETBAY แล้วงานไปที่ 4. เตรียมเอกสารเดิน E · ห้ามกดกับงานจริง"
      />
    </form>
  );
}
