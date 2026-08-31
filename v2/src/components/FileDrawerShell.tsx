'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * กรอบแผงดูไฟล์ — โครงเดียวกับตัวอย่างไฟล์ตอนรับงาน AN/BL
 *
 * หัวแผงบอกหมวดไฟล์กับชื่อไฟล์ ไม่ใช่เลขงาน เพราะคนเปิดมาเพื่อดูว่าอัปถูกใบไหม
 * ปิดด้วย × หรือ Esc แล้ว router.back() กลับหน้าเดิมพร้อมแท็บและคำค้นเดิม
 */
export function FileDrawerShell({
  title, fileName, meta, viewHref, wide, children,
}: {
  title: string;
  fileName: string;
  meta?: string;
  /** เปิดไฟล์ตัวจริงในแท็บใหม่ */
  viewHref: string;
  /** แผงกว้างพิเศษ สำหรับดูเอกสารทั้งใบ */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') router.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <div className="drawer-root">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="ปิดแผงดูไฟล์"
        onClick={() => router.back()}
      />
      <aside className={`job-drawer open${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={`ดูไฟล์ ${fileName}`}>
        <header className="drawer-header">
          <div>
            <small>{title}</small>
            <h2 className="drawer-file">{fileName}</h2>
          </div>
          <div className="drawer-nav">
            {meta ? <span>{meta}</span> : null}
            <a className="button tiny" href={viewHref} target="_blank" rel="noreferrer" title="เปิดแท็บใหม่">⤢</a>
            <button
              type="button"
              className="icon-button"
              onClick={() => router.back()}
              title="ปิด (Esc)"
              aria-label="ปิด"
            >
              ×
            </button>
          </div>
        </header>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  );
}
