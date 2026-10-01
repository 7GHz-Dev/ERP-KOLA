'use client';

import Link from 'next/link';
import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PopoverHead } from '@/components/Interactions';
import { removeDoAttachment } from '@/lib/actions/files';
import {
  DO_DOC_TYPES, DO_SLIP_TYPES, doAttachLabel, type DoAttachKind, type DoAttachment,
} from '@/lib/do-attachments';

/**
 * Slip หรือเอกสารแลก D/O ของงานหนึ่ง — ดู อัปเพิ่ม และเอาใบที่อัปผิดออก ในเซลล์เดียว
 *
 * หนึ่งงานมีได้หลายใบ แต่ละใบมีหัวข้อกำกับ (ค่า DO · ค่า DEM · Invoice DET …)
 * หัวข้อเลือกจาก dropdown ตอนอัป ไม่ให้พิมพ์เอง เพราะชุดแลกเรียงไฟล์ตามหัวข้อ
 * ถ้าพิมพ์กันคนละแบบ ระบบจะจัดลำดับให้ไม่ได้
 *
 * เลือกได้หลายไฟล์ในครั้งเดียว ทุกไฟล์ได้หัวข้อเดียวกัน
 * สลิปค่า DO ที่โอนสองรอบจึงอัปทีเดียวจบ ไม่ต้องเปิดกล่องซ้ำ
 */
export function DoAttachments({
  jobId, kind, files, canEdit, thenOpen,
}: {
  jobId: string;
  kind: DoAttachKind;
  files: DoAttachment[];
  /** ส่งแลก/ตั้งเบิกไปแล้วเหลือไว้ดูอย่างเดียว */
  canEdit: boolean;
  /** อัปเสร็จแล้วไปหน้านี้ต่อ เช่นแผงเทียบยอดกับ Invoice DO */
  thenOpen?: string;
}) {
  const router = useRouter();
  const [removing, setRemoving] = useState('');
  const [error, setError] = useState('');

  const remove = async (file: DoAttachment) => {
    if (!window.confirm(`เอา ${doAttachLabel(file.category)} · ${file.fileName} ออกใช่ไหม`)) return;
    setRemoving(file.id);
    setError('');
    const fd = new FormData();
    fd.set('fileId', file.id);
    const res = await removeDoAttachment(fd).catch(() => ({ ok: false, detail: 'เชื่อมต่อไม่ได้' }));
    setRemoving('');
    if (!res.ok) {
      setError(res.detail ?? 'เอาไฟล์ออกไม่สำเร็จ');
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="file-cell do-attach">
      {files.length ? (
        <ul className="do-attach-list">
          {files.map((f) => (
            <li key={f.id}>
              <small>{doAttachLabel(f.category)}{f.note ? ` · ${f.note}` : ''}</small>
              <span className="do-attach-row">
                <Link className="badge approved file-link" href={`/file/${f.id}`} title={f.fileName}>
                  {f.fileName}
                </Link>
                {canEdit ? (
                  <button
                    type="button"
                    className="icon-button do-attach-remove"
                    aria-label={`เอา ${f.fileName} ออก`}
                    title="เอาออก"
                    disabled={removing === f.id}
                    onClick={() => void remove(f)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : kind === 'slip' ? (
        <span className="badge pending">รอดำเนินการ</span>
      ) : null}
      {error ? <small className="client-cell-note bad">{error}</small> : null}
      {canEdit ? <DoAttachUpload jobId={jobId} kind={kind} hasFiles={files.length > 0} thenOpen={thenOpen} /> : null}
    </div>
  );
}

/**
 * กล่องอัปไฟล์ — เลือกหัวข้อจาก dropdown แล้วเลือกไฟล์ได้หลายไฟล์
 *
 * ส่งทีละไฟล์ผ่านเส้นทางอัปโหลดตัวเดียวกับไฟล์อื่นของระบบ
 * ได้การตรวจสิทธิ์ ขนาด และชนิดไฟล์ชุดเดียวกัน และบอก % ได้จริงจากขาส่ง
 * ไฟล์ไหนพลาดบอกที่ไฟล์นั้น ไฟล์ที่ขึ้นไปแล้วไม่ต้องอัปซ้ำ
 */
function DoAttachUpload({
  jobId, kind, hasFiles, thenOpen,
}: {
  jobId: string;
  kind: DoAttachKind;
  hasFiles: boolean;
  thenOpen?: string;
}) {
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const types = kind === 'slip' ? DO_SLIP_TYPES : DO_DOC_TYPES;
  const [percent, setPercent] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const sendOne = (data: FormData, onProgress: (ratio: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener('load', () => {
        try {
          const body = JSON.parse(xhr.responseText) as { ok?: boolean; detail?: string };
          if (xhr.status < 400 && body.ok) return resolve();
          reject(new Error(body.detail ?? 'อัปโหลดไม่สำเร็จ'));
        } catch {
          reject(new Error('อัปโหลดไม่สำเร็จ'));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('เชื่อมต่อไม่ได้ กรุณาลองใหม่')));
      xhr.send(data);
    });

  const send = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const category = String(data.get('category') ?? '');
    const picked = data.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
    if (!category) return setError('กรุณาเลือกหัวข้อ');
    if (!picked.length) return setError('กรุณาเลือกไฟล์');

    setError('');
    setPercent(0);
    const failed: string[] = [];
    for (let i = 0; i < picked.length; i += 1) {
      setStatus(picked.length > 1 ? `ไฟล์ ${i + 1} / ${picked.length}` : '');
      const one = new FormData();
      one.set('jobId', jobId);
      one.set('category', category);
      one.set('note', String(data.get('note') ?? ''));
      one.set('file', picked[i]);
      try {
        await sendOne(one, (ratio) => setPercent(Math.round(((i + ratio) / picked.length) * 99)));
      } catch (e) {
        failed.push(`${picked[i].name}: ${e instanceof Error ? e.message : 'อัปโหลดไม่สำเร็จ'}`);
      }
    }

    setStatus('');
    if (failed.length) {
      setPercent(null);
      setError(failed.join('\n'));
      // ไฟล์ที่ขึ้นไปแล้วต้องเห็นในตารางเลย จะได้ไม่อัปซ้ำ
      startTransition(() => router.refresh());
      return;
    }
    setPercent(100);
    startTransition(() => {
      router.refresh();
      setTimeout(() => {
        form.reset();
        setPercent(null);
        details.current?.removeAttribute('open');
        if (thenOpen) router.push(thenOpen);
      }, 600);
    });
  };

  const busy = percent !== null && percent < 100;
  const title = kind === 'slip' ? 'อัปโหลด Slip' : 'เพิ่มเอกสาร';

  return (
    <details className="disclosure" ref={details}>
      <summary className="button tiny">
        {kind === 'slip' ? (hasFiles ? '+ เพิ่ม Slip' : 'อัปโหลด Slip') : '+ เพิ่มเอกสาร'}
      </summary>
      <form
        className="popover wide"
        data-keep-open
        onSubmit={(e) => {
          e.preventDefault();
          void send(e.currentTarget);
        }}
      >
        <PopoverHead title={title} />
        <label className="mini">
          <span>หัวข้อ</span>
          {/* สลิปเริ่มที่ค่า DO เพราะเป็นใบหลักของทุกงาน เอกสารต้องเลือกเองทุกครั้ง */}
          <select name="category" defaultValue={kind === 'slip' ? 'DO_SLIP' : ''} required disabled={busy}>
            {kind === 'doc' ? <option value="">— เลือกหัวข้อ —</option> : null}
            {types.map((t) => <option key={t.category} value={t.category}>{t.label}</option>)}
          </select>
        </label>
        <label className="mini">
          <span>เลือกไฟล์ (เลือกได้หลายไฟล์ · ไฟล์ละไม่เกิน 8 MB)</span>
          <input type="file" name="file" multiple required disabled={busy} />
        </label>
        <label className="mini">
          <span>หมายเหตุ</span>
          <input name="note" disabled={busy} />
        </label>

        {percent !== null ? (
          <div className="progress" role="progressbar" aria-valuenow={percent}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
            <span>{percent === 100 ? 'เสร็จแล้ว' : status ? `${status} · ${percent}%` : `${percent}%`}</span>
          </div>
        ) : null}
        {error ? <p className="popover-error do-attach-error">{error}</p> : null}

        <button className="button tiny primary" type="submit" disabled={busy}>
          {percent === 100 ? 'อัปโหลดแล้ว' : busy ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
        </button>
      </form>
    </details>
  );
}
