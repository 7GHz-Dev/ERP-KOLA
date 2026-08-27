'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * เมนูซ้าย
 *
 * เป็น client component เพราะต้องรู้ว่าตอนนี้อยู่หน้าไหนถึงจะไฮไลต์ได้
 * layout ฝั่งเซิร์ฟเวอร์ไม่ได้รับ pathname มาให้ ก่อนหน้านี้จึงไม่มีเมนูไหนถูกไฮไลต์เลย
 */

export type NavLink = { href: string; label: string; count: number };
export type NavGroupView = { label: string; color: string; items: NavLink[] };

export function SideNav({ groups }: { groups: NavGroupView[] }) {
  const pathname = usePathname();

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
                {item.count ? <span className="nav-count">{item.count}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
