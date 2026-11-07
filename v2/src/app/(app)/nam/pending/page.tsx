import { requireUserReady } from '@/lib/auth';
import { col } from '@/lib/columns';
import { PersonPendingPage } from '@/components/PersonPendingPage';
import { HEAD_QUEUES } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

/** Head Officer (NAMKANG) — งานที่ค้างอยู่ที่ตัวเองทุกคิว แท็บละคิว */
export default async function HeadPendingPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['NAMKANG']);
  return (
    <PersonPendingPage
      title="Pending Jobs"
      subtitle="งานที่ค้างอยู่ที่ Head Officer : NAMKANG แยกตามขั้น · กดแท็บเพื่อดูรายการ แล้วไปทำที่หน้าของขั้นนั้น"
      basePath="/nam/pending"
      searchParams={await searchParams}
      tabs={[
        {
          key: 'an', label: 'Approve B/L', where: HEAD_QUEUES.an,
          hint: 'Import Officer ส่งข้อมูล BL มาแล้ว รออนุมัติเข้าตารางหลัก',
          href: '/nam/approve', hrefLabel: 'Approve B/L', extra: [col.anStatus()],
        },
        {
          key: 'customer', label: 'Upload cargo Invoice', where: HEAD_QUEUES.customer,
          hint: 'ยังไม่ได้ใส่ Client in Charge / ยืนยันข้อมูลลูกค้า (Invoice สินค้า & Surrender)',
          href: '/nam/customer', hrefLabel: 'Upload cargo Invoice', extra: [col.surrender()],
        },
        {
          key: 'haul', label: 'Transport Request', where: HEAD_QUEUES.haul,
          hint: 'ส่งชุดปล่อยให้ Partner แล้ว ยังมีตู้ที่ไม่ได้ส่งแพลนลากตู้',
          href: '/nam/haul', hrefLabel: 'Transport Request',
        },
      ]}
    />
  );
}
