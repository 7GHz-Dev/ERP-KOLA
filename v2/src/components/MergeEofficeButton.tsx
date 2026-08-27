'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ปุ่มรวมชุด E-Office พร้อมความคืบหน้าทีละชิ้น
 *
 * เส้นทาง /api/eoffice/merge ส่งกลับทีละบรรทัด (NDJSON) ว่ากำลังอ่านชิ้นไหน
 * เพิ่มเข้าไปกี่หน้า และข้ามชิ้นไหนเพราะอะไร จึงบอก % ได้จริงตามงานที่ทำเสร็จ
 * ไม่ใช่แถบวิ่งหลอกตา
 */

type Step = {
  index: number;
  total: number;
  label: string;
  status: 'reading' | 'added' | 'skipped' | 'saving' | 'done' | 'error';
  detail?: string;
};

export function MergeEofficeButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState<string>('');
  const [error, setError] = useState('');

  const run = async () => {
    setSteps([]);
    setDone('');
    setError('');
    setPercent(0);

    try {
      const res = await fetch('/api/eoffice/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.body) throw new Error('เซิร์ฟเวอร์ไม่ส่งข้อมูลกลับ');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const step = JSON.parse(line) as Step;
          if (step.status === 'error') {
            setError(step.detail ?? 'รวมชุดไม่สำเร็จ');
            setPercent(null);
            continue;
          }
          setPercent(Math.round(((step.index + 1) / step.total) * 100));
          if (step.status === 'done') setDone(step.detail ?? 'เสร็จแล้ว');
          if (step.status !== 'reading') setSteps((prev) => [...prev, step]);
        }
      }
      // รีเฟรชให้เห็นไฟล์ที่รวมแล้วทันที ไม่ต้องให้ผู้ใช้กดเอง
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'รวมชุดไม่สำเร็จ');
      setPercent(null);
    }
  };

  const busy = percent !== null && !done && !error;

  return (
    <>
      <button type="button" className="button tiny ok" onClick={() => dialog.current?.showModal()}>
        รวมชุด E-Office
      </button>

      <dialog ref={dialog} className="confirm-dialog wide">
        <div className="popover-head">
          <b>รวมชุด E-Office</b>
          <button
            type="button"
            className="popover-close"
            aria-label="ปิด"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>

        {!percent && !done && !error ? (
          <>
            <p className="confirm-text">รวมเอกสารเป็น PDF ไฟล์เดียวตามลำดับที่ยื่นจริงใช่ไหม</p>
            <p className="confirm-detail">คำร้อง → ใบขนสินค้า → Final Invoice → Arrival Notice / BL</p>
          </>
        ) : null}

        {percent !== null ? (
          <div className="progress" role="progressbar" aria-valuenow={percent}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
            <span>{percent}%</span>
          </div>
        ) : null}

        {steps.length ? (
          <ul className="merge-steps">
            {steps.map((s, i) => (
              <li key={`${s.label}-${i}`} className={s.status}>
                <b>{s.label}</b>
                <span>
                  {s.status === 'added' ? `เพิ่มแล้ว ${s.detail ?? ''}`
                    : s.status === 'skipped' ? `ข้าม — ${s.detail ?? ''}`
                      : s.status === 'saving' ? 'กำลังบันทึก…' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {done ? <p className="confirm-done">{done}</p> : null}
        {error ? <p className="popover-error">{error}</p> : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            {done || error ? 'ปิด' : 'ยกเลิก'}
          </button>
          {!done ? (
            <button type="button" className="button ok" disabled={busy} onClick={() => void run()}>
              {busy ? 'กำลังรวม…' : error ? 'ลองใหม่' : 'รวมชุด'}
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
