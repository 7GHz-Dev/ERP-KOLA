import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { ActionAlert } from '@/components/ActionAlert';
import { DisclosureBehavior } from '@/components/Interactions';
import { SideNav } from '@/components/SideNav';
import { currentUser, logout } from '@/lib/auth';
import { navCounts } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

/**
 * เมนูซ้าย — จัดกลุ่มตามบทบาทเหมือนระบบเดิม
 *
 * แต่ละกลุ่มมีจุดสีประจำตัวเพื่อให้กวาดตาหาแถบของตัวเองเจอทันที
 * และมีตัวเลขงานค้างท้ายเมนู ใช้เกณฑ์เดียวกับ navCount() ของเดิม
 * ADMIN เห็นทุกกลุ่ม
 */
type NavItem = { href: string; label: string; count?: keyof Awaited<ReturnType<typeof navCounts>> };
type NavGroup = { label: string; color: string; roles: string[]; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    label: 'Overview', color: '#a4a097', roles: [],
    items: [
      { href: '/overview', label: 'ภาพรวมงาน' },
      { href: '/jobs', label: 'ทะเบียนงาน' },
    ],
  },
  {
    label: 'PAINT', color: '#0075de', roles: ['PAINT'],
    items: [
      { href: '/intake/an', label: 'Arrival Notice BL' },
      { href: '/intake/bl', label: 'BL Waiting Confirm' },
      { href: '/pending', label: 'งานคงค้าง', count: 'openJobs' },
      { href: '/paint/eoffice-signed', label: 'Upload ชุดปล่อย E-Office / ส่ง Partner', count: 'eofficeSignedWait' },
      { href: '/automation', label: 'คิว Automation', count: 'queue' },
    ],
  },
  {
    label: 'FAH', color: '#dd5b00', roles: ['FAH'],
    items: [
      { href: '/fah/do', label: 'Upload InvDO / ETA Official / Terminal / Send Partner', count: 'fahDoWait' },
      { href: '/fah/fn', label: 'อนุมัติ Final Invoice', count: 'pendingFn' },
      { href: '/fah/draft', label: 'ตรวจ Draft / ทำใบขน', count: 'draftReview' },
    ],
  },
  {
    label: 'NAMKANG', color: '#1aae39', roles: ['NAMKANG'],
    items: [
      { href: '/nam/approve', label: 'อนุมัติข้อมูล BL เข้าตารางหลัก', count: 'pendingAn' },
      { href: '/nam/customer', label: 'ใส่ Client in Charge / ติดตาม Invoice สินค้า & Surrender', count: 'namCustomerWait' },
      { href: '/nam/release', label: 'ตรวจ & ปล่อยสินค้า' },
    ],
  },
  {
    label: 'ANN', color: '#7b3fe4', roles: ['ANN'],
    items: [
      { href: '/do-exchange', label: 'จัดการแลก DO', count: 'doExchangeWait' },
    ],
  },
  {
    label: 'SYSTEM', color: '#793400', roles: ['ADMIN'],
    items: [
      { href: '/master', label: 'Master Data' },
    ],
  },
];

async function signOut() {
  'use server';
  await logout();
  redirect('/login');
}

export default async function AppLayout({
  children, drawer,
}: {
  children: React.ReactNode;
  /** แผงสรุปงานที่กางทับหน้าเดิม ว่างไว้ตอนไม่มีอะไรเปิดอยู่ */
  drawer: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const visible = NAV.filter(
    (g) => g.roles.length === 0 || user.role === 'ADMIN' || g.roles.includes(user.role),
  );
  const counts = await navCounts();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">K</div>
          <div>
            <strong>KOLA ERP</strong>
            <span>Import Operations</span>
          </div>
        </div>

        {/* useSearchParams ใน SideNav ต้องอยู่ใต้ Suspense เสมอ */}
        <Suspense fallback={null}>
          <SideNav
            groups={visible.map((group) => ({
              label: group.label,
              color: group.color,
              items: group.items.map((item) => ({
                href: item.href,
                label: item.label,
                count: item.count ? counts[item.count] : 0,
                // ส่งชื่อค่าไปด้วย เมนูจะได้ดึงตัวเลขใหม่เองหลังข้อมูลเปลี่ยน
                countKey: item.count,
              })),
            }))}
          />
        </Suspense>

        <div className="sidebar-user">
          <span>{user.displayName}</span>
          <small>{user.role}</small>
          <form action={signOut}>
            <button className="button tiny" type="submit">ออกจากระบบ</button>
          </form>
        </div>
      </aside>

      <main className="main">
        {/* useSearchParams ต้องอยู่ใต้ Suspense เสมอ */}
        <Suspense fallback={null}><ActionAlert /></Suspense>
        <DisclosureBehavior />
        {children}
      </main>
      {drawer}
    </div>
  );
}
