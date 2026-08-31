'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveOriginPort } from '@/lib/actions/jobs';

/**
 * ช่องกรอกเมืองต้นทางในตารางแลก DO — พิมพ์แล้วบันทึกตอนออกจากช่อง
 *
 * ค่านี้ไม่มีที่อื่นในระบบ อ่านจาก Arrival Notice แล้วพิมพ์เองอย่างเดียว
 * จึงเป็นข้อความอิสระ ไม่ใช่ตัวเลือกจาก Master Data เหมือนท่าปลายทาง
 * บันทึกตอน blur แทนการมีปุ่มแยกทุกแถว เพราะ ANN ไล่คีย์ทีละหลายสิบงาน
 */
export function OriginPortCell({
  jobId, originPort, disabled,
}: {
  jobId: string;
  originPort: string | null;
  /** ออกจดหมายไปแล้ว แก้ได้แต่เตือนว่าต้องออกใหม่ */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(originPort ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ค่าที่บันทึกสำเร็จล่าสุด ใช้เทียบว่าต้องยิงบันทึกไหมตอนออกจากช่อง
  const saved = useRef(originPort ?? '');

  if (disabled) return <span>{value || '-'}</span>;

  const save = async () => {
    const next = value.trim();
    if (next === saved.current) return;
    setState('saving');

    const data = new FormData();
    data.set('jobId', jobId);
    data.set('originPort', next);

    /*
     * runAction ไม่ได้คืน { error } แต่ redirect พร้อม ?err= ให้ ActionAlert แสดง
     * ที่นี่จึงจับได้แค่เน็ตหลุดหรือเซิร์ฟเวอร์ล่ม ส่วนข้อความจากกติกาจะไปโผล่บนแถบแจ้งเตือน
     */
    try {
      await saveOriginPort(data);
    } catch {
      setValue(saved.current);
      setState('error');
      return;
    }

    saved.current = next;
    setValue(next);
    setState('saved');
    startTransition(() => router.refresh());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1400);
  };

  return (
    <div className="client-cell">
      <input
        value={value}
        placeholder="เช่น NAGOYA"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { void save(); }}
        // Enter บันทึกเลย ไม่ต้องคลิกออกจากช่อง
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      {state === 'saving' ? <small className="client-cell-note">กำลังบันทึก…</small> : null}
      {state === 'saved' ? <small className="client-cell-note ok">บันทึกแล้ว</small> : null}
      {state === 'error' ? <small className="client-cell-note bad">บันทึกไม่สำเร็จ</small> : null}
    </div>
  );
}
