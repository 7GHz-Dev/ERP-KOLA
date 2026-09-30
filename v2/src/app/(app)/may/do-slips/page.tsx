import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { loadSlipChoices } from '@/lib/queries/do-files';
import { DoSlipBatch } from '@/components/DoSlipBatch';

export const dynamic = 'force-dynamic';

/**
 * MAY — อัป Slip ค่าแลก D/O ทีละหลายรูป
 *
 * แยกเป็นหน้าของตัวเอง ไม่ได้อยู่ใต้ /may/do-pay เพราะเส้นทาง /may/do-pay/[id]
 * ถูกดักไปเปิดเป็นแผงกรอกยอด หน้าที่อยู่ใต้นั้นจะถูกแผงแย่งไป
 */
export default async function MayDoSlipsPage() {
  await requireUserReady(['MAY']);
  const choices = await loadSlipChoices();

  return (
    <>
      <div className="page-head">
        <h1>อัป Slip ค่าแลก DO</h1>
        <p>
          เลือกรูป Slip หลายรูปพร้อมกัน · ระบบอ่านเลข BL จากบันทึกช่วยจำแล้วจับคู่ให้ · ตรวจแล้วกดแนบ ·{' '}
          <Link className="cell-link" href="/may/do-pay">กลับไปหน้ารอแลก DO</Link>
        </p>
      </div>
      <DoSlipBatch choices={choices} />
    </>
  );
}
