'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readMergeProgress, type MergeProgress } from '@/lib/merge-progress';

/**
 * ปุ่มรวมชุด E-Office พร้อมความคืบหน้าทีละชิ้น
 *
 * เส้นทาง /api/eoffice/merge ส่งกลับทีละบรรทัด (NDJSON) ว่ากำลังอ่านชิ้นไหน
 * เพิ่มเข้าไปกี่หน้า และข้ามชิ้นไหนเพราะอะไร จึงบอก % ได้จริงตามงานที่ทำเสร็จ
 * ไม่ใช่แถบวิ่งหลอกตา
 */

type Step = MergeProgress;

/** ปุ่มและลำดับชิ้นงานของชุดแต่ละแบบ — ปุ่มเดียวใช้ได้ทุกชุด */
const BUNDLE_CFG = {
  eoffice: {
    title: 'รวมชุด E-Office',
    label: 'รวมชุด E-Office',
    order: 'คำร้อง → ใบขนสินค้า → Final Invoice → Arrival Notice / BL',
  },
  do: {
    title: 'รวมชุดแลก DO (ประทับตรา)',
    label: 'เซ็นประทับตรา',
    order: 'จดหมายแลก DO ฉบับประทับตรา → Arrival Notice / BL → Invoice DO → Slip → เอกสารอื่น ๆ',
  },
  doPlain: {
    title: 'รวมชุดแลก DO (ไม่ประทับตรา)',
    label: 'ไม่เซ็นประทับตรา',
    order: 'จดหมายแลก DO ฉบับเปล่า → Arrival Notice / BL → Invoice DO → Slip → เอกสารอื่น ๆ',
  },
  doUploaded: {
    title: 'รวมชุดแลก DO (อัปโหลดเอง)', label: 'แบบอัปโหลดเอง',
    order: 'จดหมายที่อัปโหลดเอง → Arrival Notice / BL → Invoice DO → Slip → เอกสารอื่น ๆ',
  },
} as const;

export function MergeEofficeButton({
  jobId, jobIds, kind = 'eoffice',
}: {
  jobId?: string;
  jobIds?: string[];
  /** ชุดเอกสารที่จะรวม — ปุ่มและลำดับชิ้นงานเปลี่ยนตามนี้ */
  kind?: keyof typeof BUNDLE_CFG;
}) {
  const cfg = BUNDLE_CFG[kind];
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState<string>('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const ids = jobIds ?? (jobId ? [jobId] : []);

  const run = async () => {
    setSteps([]);
    setDone('');
    setError('');
    setPercent(0);
    setRunning(true);

    try {
      if (!ids.length) throw new Error('กรุณาเลือกรายการ');
      const fileIds: string[] = [];
      const summaries: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const res = await fetch('/api/eoffice/merge', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jobId: ids[i], kind }),
        });
        const result = await readMergeProgress(res, step => {
          setPercent(Math.min(99, Math.round((i + Math.min(1, (step.index + 1) / step.total)) / ids.length * 100)));
          if (step.status !== 'reading') setSteps(previous => [...previous, { ...step, label: `${i + 1}/${ids.length} · ${step.label}` }]);
        });
        fileIds.push(result.fileId!);
        summaries.push(result.detail ?? 'เสร็จแล้ว');
      }
      let previewId = fileIds[0];
      if (fileIds.length > 1) {
        const response = await fetch('/api/do-bundle/combine', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileIds, kind }),
        });
        const result = await response.json();
        if (!response.ok || !result.fileId) throw new Error(result.error ?? 'รวมหลายรายการไม่สำเร็จ');
        previewId = result.fileId;
      }
      setPercent(100);
      setDone(summaries.join('\n'));
      if (kind !== 'eoffice') {
        dialog.current?.close();
        router.push(`/file/${previewId}`);
      }
      // รีเฟรชให้เห็นไฟล์ที่รวมแล้วทันที ไม่ต้องให้ผู้ใช้กดเอง
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'รวมชุดไม่สำเร็จ');
      setPercent(null);
    } finally {
      setRunning(false);
    }
  };

  const busy = running;

  return (
    <>
      <button type="button" className="button tiny ok" disabled={busy || !ids.length} onClick={() => {
        dialog.current?.showModal();
        if (kind !== 'eoffice') void run();
      }}>
        {cfg.label}
      </button>

      <dialog ref={dialog} className="confirm-dialog wide">
        <div className="popover-head">
          <b>{cfg.title}</b>
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
            <p className="confirm-detail">{cfg.order}</p>
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
