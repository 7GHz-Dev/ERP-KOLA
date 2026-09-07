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
  title, fileName, meta, viewHref, wide, dockLeft, children,
}: {
  title: string;
  fileName: string;
  meta?: string;
  /** เปิดไฟล์ตัวจริงในแท็บใหม่ */
  viewHref: string;
  /** แผงกว้างพิเศษ สำหรับดูเอกสารทั้งใบ */
  wide?: boolean;
  /**
   * จอดแผงชิดซ้ายและไม่มีฉากหลังทึบ สำหรับหน้าที่ต้องดูเอกสารไปกรอกตารางไป
   * ตารางถูกดันไปทางขวาแทนที่จะถูกแผงทับ จึงยังกดกรอกได้ขณะแผงกางอยู่
   */
  dockLeft?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  /*
   * แผงที่จอดซ้ายต้องบีบเนื้อหน้าให้หลบ ไม่งั้นตารางจะอยู่ใต้แผงและกดไม่ได้
   * ทำด้วยคลาสที่ body เพราะตัวที่ต้องขยับอยู่คนละต้นไม้กับแผง (parallel route)
   */
  useEffect(() => {
    if (!dockLeft) return;
    document.body.classList.add('has-dock-pane');
    return () => document.body.classList.remove('has-dock-pane');
  }, [dockLeft]);

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
    <div className={`drawer-root${dockLeft ? ' dock-root' : ''}`}>
      {/* แผงที่จอดซ้ายไม่มีฉากหลัง เพราะตารางข้างหลังต้องกดกรอกได้ขณะแผงกางอยู่ */}
      {dockLeft ? null : (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="ปิดแผงดูไฟล์"
          onClick={() => router.back()}
        />
      )}
      <aside
        className={`job-drawer open${wide ? ' wide' : ''}${dockLeft ? ' dock-left' : ''}`}
        role="dialog"
        aria-modal={dockLeft ? undefined : true}
        aria-label={`ดูไฟล์ ${fileName}`}
      >
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
