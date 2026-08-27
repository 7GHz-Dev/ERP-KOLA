'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * แถบแจ้งผลของคำสั่งล่าสุด
 *
 * คำสั่งที่ล้มเหลวจะพากลับหน้าเดิมพร้อม ?err= ส่วนที่สำเร็จใช้ ?created=
 * อ่านจาก URL ตรง ๆ จึงกดรีเฟรชหรือกดย้อนกลับแล้วข้อความยังตรงกับที่เกิดขึ้นจริง
 */
export function ActionAlert() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const err = params.get('err');
  const ok = params.get('ok');
  const created = params.get('created');
  if (!err && !ok && !created) return null;

  const dismiss = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('err');
    next.delete('ok');
    next.delete('created');
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  return (
    <div className={`alert-bar ${err ? 'bad' : 'good'}`} role="status">
      <span>
        {err ? `ทำรายการไม่สำเร็จ: ${err}` : ok ? ok : `สร้างงาน ${created} เรียบร้อย`}
      </span>
      <button type="button" onClick={dismiss} aria-label="ปิดข้อความ">✕</button>
    </div>
  );
}
