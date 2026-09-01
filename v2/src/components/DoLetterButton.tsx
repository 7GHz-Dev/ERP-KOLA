'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ปุ่มออกจดหมายแลก D/O
 *
 * ออกจดหมายแล้วเปิดแผงดูไฟล์ให้เลย ขนาดเท่ากับแผงตัดหน้า AN/BL
 * เดิมเด้งแท็บใหม่ ทำให้ต้องสลับแท็บกลับมาเองทุกครั้งและตารางไม่รีเฟรช
 * ตอนนี้ได้ตรวจจดหมายในที่เดียวกับที่ทำงานอยู่ แล้วปิดแผงทำงานต่อได้ทันที
 *
 * ไม่มีสายเรือที่ตรงกับแบบฟอร์มก็กดไม่ได้ และบอกว่าให้ไปตั้งที่ไหน
 */
export function DoLetterButton({
  jobId, ready, done,
}: { jobId: string; ready: boolean; done: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  if (!ready) return <span className="badge pending">ไม่มีแบบฟอร์มของสายเรือนี้</span>;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/do-letter/${jobId}?json=1`, { method: 'GET' });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? 'ออกจดหมายไม่สำเร็จ');
      // เปิดแผงดูไฟล์ของจดหมายที่เพิ่งออก แล้วรีเฟรชตารางให้เห็นไฟล์ใหม่
      startTransition(() => {
        router.push(`/file/${data.id}`);
        router.refresh();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ออกจดหมายไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`button tiny ${done ? '' : 'primary'}`}
        onClick={() => void run()}
        disabled={busy}
      >
        {busy ? 'กำลังออก…' : done ? 'ออกใหม่' : 'ออกจดหมาย'}
      </button>
      {error ? <small className="client-cell-note bad">{error}</small> : null}
    </>
  );
}
