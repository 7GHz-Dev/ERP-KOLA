'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * กรอบของ Drawer สรุปงาน — โครงเดียวกับระบบเดิม
 *
 * หัวสีเข้ม มีปุ่ม ◀ ▶ เดินหน้าถอยหลังตามลำดับแถวในตาราง และปิดด้วย × หรือ Esc
 * ลำดับแถวอ่านจาก sessionStorage ที่ตารางเขียนไว้ตอนเปิดหน้า จึงไม่ต้องยิงฐานข้อมูลซ้ำ
 * ปิดแล้วใช้ router.back() เพื่อกลับไปหน้าเดิมพร้อมแท็บ คำค้น และตำแหน่งเลื่อนเดิม
 */

const ROWS_KEY = 'kola.rows';

export function DrawerShell({
  jobId, jobNo, children,
}: { jobId: string; jobNo: string; children: React.ReactNode }) {
  const router = useRouter();
  const [rows, setRows] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ROWS_KEY);
      setRows(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setRows([]);
    }
  }, [jobId]);

  const index = rows.indexOf(jobId);
  const canMove = index >= 0 && rows.length > 1;

  const go = useCallback((step: number) => {
    if (index < 0 || rows.length < 2) return;
    // replace ไม่ push เพื่อให้กดปิดครั้งเดียวกลับถึงตาราง ไม่ต้องย้อนทีละงาน
    router.replace(`/job/${rows[(index + step + rows.length) % rows.length]}`);
  }, [index, rows, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') router.back();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    // ล็อกไม่ให้หน้าหลังเลื่อนตามตอนแผงเปิดอยู่
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [go, router]);

  return (
    <div className="drawer-root">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="ปิดแผงสรุปงาน"
        onClick={() => router.back()}
      />
      <aside className="job-drawer open" role="dialog" aria-modal="true" aria-label={`สรุปงาน ${jobNo}`}>
        <header className="drawer-header">
          <div>
            <small>JOB DETAIL</small>
            <h2>{jobNo}</h2>
          </div>
          <div className="drawer-nav">
            <button type="button" className="button tiny" onClick={() => go(-1)}
              disabled={!canMove} title="งานก่อนหน้า (←)">◀</button>
            <span>{canMove ? `${index + 1} / ${rows.length}` : '—'}</span>
            <button type="button" className="button tiny" onClick={() => go(1)}
              disabled={!canMove} title="งานถัดไป (→)">▶</button>
            <a className="button tiny" href={`/job/${jobId}`} title="เปิดเต็มหน้า">⤢</a>
            <button type="button" className="icon-button" onClick={() => router.back()}
              title="ปิด (Esc)" aria-label="ปิด">×</button>
          </div>
        </header>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  );
}
