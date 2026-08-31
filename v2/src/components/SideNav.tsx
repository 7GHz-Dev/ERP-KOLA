'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * เมนูซ้าย
 *
 * เป็น client component เพราะต้องรู้ว่าตอนนี้อยู่หน้าไหนถึงจะไฮไลต์ได้
 * layout ฝั่งเซิร์ฟเวอร์ไม่ได้รับ pathname มาให้ ก่อนหน้านี้จึงไม่มีเมนูไหนถูกไฮไลต์เลย
 *
 * ตัวเลขงานค้างต้องดึงเองหลังหน้าเปลี่ยน
 * เพราะ router.refresh() ขอกลับมาเฉพาะส่วนของหน้า ไม่ได้ขอ layout ด้วย
 * ค่าที่ส่งมาจากเซิร์ฟเวอร์จึงค้างอยู่ค่าเดิมจนกว่าจะโหลดทั้งหน้าใหม่
 */

export type NavLink = { href: string; label: string; count: number; countKey?: string };
export type NavGroupView = { label: string; color: string; items: NavLink[] };

export function SideNav({ groups }: { groups: NavGroupView[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [live, setLive] = useState<Record<string, number> | null>(null);

  /*
   * ดึงใหม่ทุกครั้งที่เส้นทางหรือ query เปลี่ยน
   *
   * การกดปุ่มในระบบนี้จบด้วย redirect กลับหน้าเดิม (POST-redirect-GET)
   * หรือ router.refresh() ซึ่งทั้งคู่ทำให้ค่าพวกนี้เปลี่ยน จึงใช้เป็นสัญญาณได้
   * ยิงตอนหน้าโฟกัสกลับมาด้วย เผื่อมีคนอื่นแก้ข้อมูลระหว่างที่สลับแท็บไป
   */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/nav-counts', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, number>;
        if (alive) setLive(data);
      } catch {
        /* ดึงไม่ได้ก็ใช้ค่าที่เซิร์ฟเวอร์ส่งมาต่อไป ไม่ต้องรบกวนผู้ใช้ */
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
    };
  }, [pathname, searchParams]);

  return (
    <nav className="main-nav" aria-label="เมนูหลัก">
      {groups.map((group) => (
        <div key={group.label} className="nav-group">
          <div className="nav-group-title">
            <span className="nav-group-dot" style={{ background: group.color }} />
            {group.label}
          </div>
          {group.items.map((item) => {
            // /job/xxx ถือว่าอยู่ในทะเบียนงาน จะได้ไม่มีเมนูไหนสว่างค้างผิดที่
            const active = pathname === item.href
              || pathname.startsWith(`${item.href}/`)
              || (item.href === '/jobs' && pathname.startsWith('/job/'));
            return (
              <Link
                key={item.href}
                className={`nav-button ${active ? 'active' : ''}`}
                href={item.href}
                prefetch
                aria-current={active ? 'page' : undefined}
              >
                <span>{item.label}</span>
                {(() => {
                  const count = item.countKey && live ? live[item.countKey] ?? item.count : item.count;
                  return count ? <span className="nav-count">{count}</span> : null;
                })()}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
