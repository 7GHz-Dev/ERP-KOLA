'use client';

import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PopoverHead } from '@/components/Interactions';

/**
 * อัปโหลดไฟล์แนบพร้อมแถบ % ความคืบหน้า
 *
 * ใช้ XMLHttpRequest เพราะ fetch ยังบอกความคืบหน้าของ "ขาส่ง" ไม่ได้
 * ไฟล์ Arrival Notice บางใบหลายเมกะไบต์ ถ้าไม่มีอะไรขยับผู้ใช้จะกดซ้ำ
 *
 * เสร็จแล้วต้องสั่ง refresh ใน startTransition และรอให้วาดเสร็จก่อนค่อยปิดแผง
 * ถ้าปิดแผงหรือแก้ DOM เองก่อน คำสั่ง refresh จะหลุดไปพร้อมกับ component ที่ถูกถอด
 * หน้าจึงยังเป็นข้อมูลเดิมจนกว่าผู้ใช้จะกดรีเฟรชเอง
 */
export function UploadForm({
  jobId, category, label, requireReason, thenOpen,
}: {
  jobId: string;
  category: string;
  label: string;
  requireReason?: boolean;
  /**
   * เส้นทางที่ให้ไปต่อหลังอัปโหลดสำเร็จ แทนแผงดูไฟล์ปกติ
   * เช่น Slip แลก DO ที่ต้องเปิดแผงเทียบยอดกับ Invoice DO แทน
   */
  thenOpen?: string;
}) {
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const finish = (form: HTMLFormElement, fileId?: string) => {
    setPercent(100);
    setDone(true);
    startTransition(() => {
      router.refresh();
      // ปิดแผงหลังข้อมูลใหม่ถูกวาดแล้ว ผู้ใช้จะได้เห็นชื่อไฟล์ขึ้นทันที
      setTimeout(() => {
        form.reset();
        setPercent(null);
        setDone(false);
        details.current?.removeAttribute('open');
        /*
         * เปิดแผงดูไฟล์ที่เพิ่งอัปให้เลย ผู้ใช้จะได้เห็นว่าอัปถูกใบไหม
         * push ไม่ replace เพื่อให้กดปิดแผงแล้วกลับมาที่ตารางได้ตามปกติ
         */
        const target = thenOpen ?? (fileId ? `/file/${fileId}` : null);
        if (target) router.push(target);
      }, 700);
    });
  };

  const send = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('กรุณาเลือกไฟล์');
      return;
    }

    setError('');
    setPercent(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
    });
    // ส่งครบแล้วแต่เซิร์ฟเวอร์ยังเก็บไฟล์อยู่ ค้างที่ 99 ไว้ก่อนจนกว่าจะตอบกลับ
    xhr.upload.addEventListener('load', () => setPercent(99));
    xhr.addEventListener('load', () => {
      let detail = 'อัปโหลดไม่สำเร็จ';
      try {
        const body = JSON.parse(xhr.responseText) as
          { ok?: boolean; detail?: string; fileId?: string };
        if (xhr.status < 400 && body.ok) {
          finish(form, body.fileId);
          return;
        }
        detail = body.detail ?? detail;
      } catch {
        /* ตอบกลับไม่ใช่ JSON ก็ใช้ข้อความตั้งต้น */
      }
      setPercent(null);
      setError(detail);
    });
    xhr.addEventListener('error', () => {
      setPercent(null);
      setError('เชื่อมต่อไม่ได้ กรุณาลองใหม่');
    });
    xhr.send(data);
  };

  const busy = percent !== null;

  return (
    <details className="disclosure" ref={details}>
      <summary className="button tiny">{label}</summary>
      <form
        className="popover wide"
        data-keep-open
        onSubmit={(e) => {
          e.preventDefault();
          send(e.currentTarget);
        }}
      >
        <PopoverHead title={label} />
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="category" value={category} />
        <label className="mini">
          <span>เลือกไฟล์ (ไม่เกิน 8 MB)</span>
          <input type="file" name="file" required disabled={busy} />
        </label>
        {requireReason ? (
          <label className="mini">
            <span>เหตุผลที่เปลี่ยนไฟล์</span>
            <textarea name="changeReason" rows={2} required disabled={busy} />
          </label>
        ) : null}
        <label className="mini">
          <span>หมายเหตุ</span>
          <input name="note" disabled={busy} />
        </label>

        {busy ? (
          <div className="progress" role="progressbar" aria-valuenow={percent ?? 0}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
            <span>{done ? 'เสร็จแล้ว' : `${percent}%`}</span>
          </div>
        ) : null}
        {error ? <p className="popover-error">{error}</p> : null}

        <button className="button tiny primary" type="submit" disabled={busy}>
          {done ? 'อัปโหลดแล้ว' : busy ? 'กำลังอัปโหลด…' : 'อัปโหลด'}
        </button>
      </form>
    </details>
  );
}
