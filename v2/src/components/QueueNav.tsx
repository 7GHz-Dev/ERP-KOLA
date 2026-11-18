'use client';

import { useRouter } from 'next/navigation';

/**
 * แถบเลื่อนไปงานอื่นในชุดที่ติ๊กไว้ (◀ ก่อนหน้า · เลือกงาน · ถัดไป ▶) — ใช้ในแผงตรวจ/แก้ที่เปิดจากการเลือกหลายรายการ
 * ใช้ router.replace ไม่ใช่ push: กดปิดแผง (กลับ) แล้วถึงตารางเลย ไม่ต้องย้อนทีละงาน
 */
export function QueueNav({ labels, hrefs, index, disabled }: { labels: string[]; hrefs: string[]; index: number; disabled?: boolean }) {
  const router = useRouter();
  const go = (k: number) => { if (k >= 0 && k < hrefs.length && k !== index) router.replace(hrefs[k]); };
  return (
    <nav className="bl-queue" aria-label="รายการที่เลือก">
      <button type="button" className="button tiny" disabled={disabled || index === 0} onClick={() => go(index - 1)}>◀ ก่อนหน้า</button>
      <select value={index} disabled={disabled} onChange={(e) => go(Number(e.target.value))} aria-label="เลือกรายการ">
        {labels.map((l, k) => <option key={hrefs[k]} value={k}>{k + 1}/{labels.length} · {l}</option>)}
      </select>
      <button type="button" className="button tiny" disabled={disabled || index >= hrefs.length - 1} onClick={() => go(index + 1)}>ถัดไป ▶</button>
    </nav>
  );
}
