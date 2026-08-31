'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * แผงตัวอย่างที่กางอยู่ข้างฟอร์ม ปรับค่าแล้วดูผลได้โดยไม่ต้องสลับแท็บ
 *
 * ตั้งพิกัดบนแบบฟอร์มต้องแก้แล้วดู แก้แล้วดูหลายรอบ
 * เดิมต้องกดเปิดแท็บใหม่ทุกครั้ง เลยเสียจังหวะและจำไม่ได้ว่าเลื่อนไปเท่าไร
 * แผงนี้เปิดค้างไว้ได้ กดโหลดใหม่หลังบันทึกก็เห็นผลทันที
 *
 * ตัวอย่างมาจากเซิร์ฟเวอร์ จึงเป็นค่าที่บันทึกแล้วเสมอ ไม่ใช่ค่าที่กำลังพิมพ์
 */
export function FormPreviewPane({
  src, title, label,
}: {
  src: string;
  title: string;
  /** ข้อความบนปุ่มเปิด */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  // เปลี่ยนค่านี้เพื่อบังคับให้ <object> โหลดไฟล์ใหม่ ไม่ใช้ของที่ cache ไว้
  const [stamp, setStamp] = useState(0);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // เปิดแผงแล้วบีบฟอร์มให้แคบลง เพื่อให้ปรับค่าไปพร้อมดูตัวอย่างได้
  useEffect(() => {
    document.body.classList.toggle('has-preview-pane', open);
    return () => document.body.classList.remove('has-preview-pane');
  }, [open]);

  const url = `${src}${src.includes('?') ? '&' : '?'}v=${stamp}`;

  return (
    <>
      <button
        type="button"
        className={`button${open ? ' primary' : ''}`}
        onClick={() => { setStamp(Date.now()); setOpen((v) => !v); }}
      >
        {open ? 'ปิดตัวอย่าง' : label}
      </button>

      {open ? (
        <aside className="preview-pane" aria-label={title}>
          <header className="preview-pane-head">
            <b>{title}</b>
            <button type="button" className="button tiny" onClick={() => setStamp(Date.now())}>
              โหลดใหม่
            </button>
            <a className="button tiny" href={url} target="_blank" rel="noreferrer">แท็บใหม่</a>
            <button type="button" className="icon-button" onClick={close} title="ปิด (Esc)" aria-label="ปิด">
              ×
            </button>
          </header>
          <object key={stamp} className="preview-pane-view" data={url} type="application/pdf">
            <p className="drawer-note warn">
              เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ ·{' '}
              <a href={url} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
            </p>
          </object>
          <p className="preview-pane-note">
            เป็นค่าที่บันทึกไว้ล่าสุด · แก้แล้วกด <b>บันทึก</b> จากนั้นกด <b>โหลดใหม่</b>
          </p>
        </aside>
      ) : null}
    </>
  );
}
