'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchSelect, type Choice } from '@/components/SearchSelect';
import { saveClientInCharge } from '@/lib/actions/jobs';

/**
 * ช่องเลือก Client in Charge ในตาราง — พิมพ์ค้นหาได้ เลือกแล้วบันทึกทันที
 *
 * NAMKANG ไล่คีย์ทีละหลายสิบแถว การกดปุ่มบันทึกแยกทุกแถวช้ากว่าเลือกแล้วจบ
 * ต้อง refresh เพราะปุ่ม "ยืนยันข้อมูล" จะกดได้ก็ต่อเมื่อมีคนรับผิดชอบแล้ว
 * ถ้าไม่ดึงข้อมูลใหม่ ปุ่มจะยังเทาอยู่ทั้งที่เลือกไปแล้ว
 */
export function ClientInChargeCell({
  jobId, personId, people, disabled,
}: {
  jobId: string;
  personId: string | null;
  people: Choice[];
  /** ยืนยันข้อมูลไปแล้ว แสดงเป็นข้อความอย่างเดียว */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(personId ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = people.find((p) => p.id === value);

  if (disabled) return <span>{selected?.name ?? '-'}</span>;

  const save = async (id: string) => {
    const previous = value;
    setValue(id);
    setState('saving');

    const data = new FormData();
    data.set('jobId', jobId);
    data.set('personId', id);

    /*
     * runAction ไม่ได้คืน { error } แต่ redirect ไปหน้าเดิมพร้อม ?err= ให้ ActionAlert แสดง
     * ที่นี่จึงจับได้แค่กรณีเน็ตหลุดหรือเซิร์ฟเวอร์ล่ม ส่วนข้อความจากกติกาจะไปโผล่บนแถบแจ้งเตือน
     */
    try {
      await saveClientInCharge(data);
    } catch {
      setValue(previous);
      setState('error');
      return;
    }

    setState('saved');
    startTransition(() => router.refresh());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1400);
  };

  return (
    <div className="client-cell">
      <SearchSelect
        choices={people}
        value={value}
        placeholder="พิมพ์ค้นหาผู้รับผิดชอบ"
        onChange={(id) => { void save(id); }}
      />
      {state === 'saving' ? <small className="client-cell-note">กำลังบันทึก…</small> : null}
      {state === 'saved' ? <small className="client-cell-note ok">บันทึกแล้ว</small> : null}
      {state === 'error' ? <small className="client-cell-note bad">บันทึกไม่สำเร็จ</small> : null}
    </div>
  );
}
