'use client';

import { useState } from 'react';
import { stopModeWorker } from '@/lib/actions/worker';

/**
 * ปุ่มปิด worker สร้าง Draft / ปิดเช็คสถานะใบขน — สั่งผ่านหน้าเว็บ worker อ่านคำสั่งจากสัญญาณรอบถัดไป
 * ปิดหลังจบงาน/รอบที่ทำอยู่ ไม่ตัดกลางคัน จึงบอกไว้หลังกดว่ากำลังปิด (แถบสถานะเปลี่ยนเป็นปิดเองเมื่อปิดจริง)
 */
export function StopWorkerButton({ mode, label, confirmText }: {
  mode: 'draft' | 'customs';
  label: string;
  confirmText: string;
}) {
  const [sent, setSent] = useState(false);
  // ฟอร์มต้องอยู่ต่อหลังกด (ถอดออกระหว่างส่งเสี่ยงคำสั่งไม่ถึง) แค่ปิดปุ่มแล้วบอกว่ากำลังปิด
  return (
    <form
      action={stopModeWorker}
      className="inline-form"
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) { e.preventDefault(); return; }
        setSent(true);
      }}
    >
      <input type="hidden" name="mode" value={mode} />
      <button type="submit" className="button tiny ghost" disabled={sent}>{sent ? 'กำลังปิด…' : label}</button>
      {sent ? <small className="worker-launcher-note">สั่งปิดแล้ว — ปิดหลังจบงานที่ทำอยู่</small> : null}
    </form>
  );
}
