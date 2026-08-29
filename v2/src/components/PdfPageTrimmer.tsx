'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadPdfjs } from '@/lib/parse-arrival';
import { keepPages } from '@/lib/pdf-pages';

/**
 * แผงดูตัวอย่างไฟล์ที่เพิ่งเลือก และตัดหน้าที่ไม่ต้องการออกก่อนบันทึก
 *
 * Arrival Notice ของสายเรือมักมีหน้าเงื่อนไขการขนส่งต่อท้ายอีกหลายหน้า
 * ซึ่งไม่ได้ใช้ในชุด E-Office แต่ไปเพิ่มขนาดไฟล์และทำให้คนตรวจต้องเลื่อนผ่าน
 * เดิมต้องไปตัดใน Acrobat ก่อนแล้วค่อยอัปโหลด ตรงนี้ตัดได้ในหน้าเดียวกันเลย
 *
 * ทำงานในเบราว์เซอร์ทั้งหมด ไฟล์ยังไม่ถูกส่งขึ้นเซิร์ฟเวอร์จนกว่าจะกดบันทึกงาน
 * เหมือนกับตอนอ่านข้อมูลจาก PDF
 */

/** ความกว้างของภาพตัวอย่างแต่ละหน้า กว้างกว่านี้ช้าโดยไม่ได้อ่านง่ายขึ้น */
const THUMB_WIDTH = 260;

type Thumb = { page: number; url: string };

export function PdfPageTrimmer({
  file, title, onApply, onClose,
}: {
  file: File;
  title: string;
  /** ส่ง null เมื่อไม่ได้ตัดหน้าไหนออก แปลว่าใช้ไฟล์เดิมได้เลย */
  onApply: (trimmed: File | null, kept: number, total: number) => void;
  onClose: () => void;
}) {
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [total, setTotal] = useState(0);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        // ไฟล์สายเรือบางใบล็อกไว้โดยที่รหัสผ่านผู้อ่านเป็นค่าว่าง ต้องถอดจริง ไม่ใช่ข้าม
        const doc = await pdfjs.getDocument({
          data: await file.arrayBuffer(), password: '',
        }).promise;
        if (cancelled) return;
        setTotal(doc.numPages);

        // วาดทีละหน้าแล้วโชว์ทันที ไฟล์หลายหน้าจะได้ไม่ค้างหน้าขาวจนกว่าจะเสร็จหมด
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('เบราว์เซอร์นี้วาดตัวอย่างหน้าไม่ได้');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          setThumbs((list) => [...list, { page: i, url: canvas.toDataURL('image/jpeg', 0.82) }]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'เปิดไฟล์ไม่ได้');
      }
    })();

    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const toggle = (page: number) => setDropped((set) => {
    const next = new Set(set);
    if (next.has(page)) next.delete(page); else next.add(page);
    return next;
  });

  const kept = total - dropped.size;

  const apply = useCallback(async () => {
    if (!total) return;
    const keep: number[] = [];
    for (let i = 1; i <= total; i += 1) if (!dropped.has(i)) keep.push(i - 1);
    if (!keep.length) {
      setError('ต้องเหลืออย่างน้อย 1 หน้า');
      return;
    }
    if (keep.length === total) {
      onApply(null, total, total);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const bytes = await keepPages(new Uint8Array(await file.arrayBuffer()), keep);
      onApply(
        new File([bytes as BlobPart], file.name, { type: 'application/pdf' }),
        keep.length,
        total,
      );
    } catch (e) {
      setError(`ตัดหน้าไม่สำเร็จ: ${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}`);
    } finally {
      setBusy(false);
    }
  }, [dropped, file, onApply, total]);

  return (
    <div className="drawer-root">
      <button type="button" className="drawer-backdrop" aria-label="ปิดตัวอย่างไฟล์" onClick={onClose} />
      <aside className="job-drawer open" role="dialog" aria-modal="true" aria-label={`ตัวอย่าง ${file.name}`}>
        <header className="drawer-header">
          <div>
            <small>{title}</small>
            <h2 className="drawer-file">{file.name}</h2>
          </div>
          <div className="drawer-nav">
            <span>{total ? `เหลือ ${kept} / ${total} หน้า` : 'กำลังเปิด…'}</span>
            <button type="button" className="icon-button" onClick={onClose} title="ปิด (Esc)" aria-label="ปิด">
              ×
            </button>
          </div>
        </header>

        <div className="drawer-content">
          {error ? <p className="drawer-note warn">{error}</p> : null}
          <p className="drawer-status meta">
            กดที่หน้าไหนเพื่อตัดหน้านั้นออก กดซ้ำเพื่อเอากลับ
            หน้าที่เหลือคือหน้าที่จะถูกบันทึกเข้าระบบ
          </p>

          <div className="page-grid">
            {thumbs.map((t) => {
              const isDropped = dropped.has(t.page);
              return (
                <button
                  type="button"
                  key={t.page}
                  className={`page-card${isDropped ? ' dropped' : ''}`}
                  onClick={() => toggle(t.page)}
                  aria-pressed={isDropped}
                  title={isDropped ? 'เอาหน้านี้กลับ' : 'ตัดหน้านี้ออก'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.url} alt={`หน้า ${t.page}`} />
                  <span className="page-card-bar">
                    <b>หน้า {t.page}</b>
                    <em>{isDropped ? 'ตัดออก' : 'เก็บไว้'}</em>
                  </span>
                </button>
              );
            })}
            {total > thumbs.length && !error
              ? <div className="page-card loading">กำลังวาดหน้า {thumbs.length + 1}…</div>
              : null}
          </div>
        </div>

        <div className="trimmer-foot">
          <span>
            {dropped.size
              ? `ตัดออก ${dropped.size} หน้า เหลือ ${kept} หน้า`
              : 'ยังไม่ได้ตัดหน้าไหนออก'}
          </span>
          <button type="button" className="button" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="button" className="button primary" onClick={() => void apply()} disabled={busy || !total}>
            {busy ? 'กำลังตัด…' : 'ใช้ไฟล์นี้'}
          </button>
        </div>
      </aside>
    </div>
  );
}
