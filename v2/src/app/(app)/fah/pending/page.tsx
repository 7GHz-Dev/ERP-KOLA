import { requireUserReady } from '@/lib/auth';
import { col, draftBadge } from '@/lib/columns';
import { PersonPendingPage } from '@/components/PersonPendingPage';
import { SENIOR_QUEUES } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

/** Senior Officer (FAH) — งานที่ค้างอยู่ที่ตัวเองทุกคิว แท็บละคิว */
export default async function SeniorPendingPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['FAH']);
  return (
    <PersonPendingPage
      title="Pending Jobs"
      subtitle="งานที่ค้างอยู่ที่ Senior Officer : FAH แยกตามขั้น · กดแท็บเพื่อดูรายการ แล้วไปทำที่หน้าของขั้นนั้น"
      basePath="/fah/pending"
      searchParams={await searchParams}
      tabs={[
        {
          key: 'do', label: 'Upload Invoice of D/O', where: SENIOR_QUEUES.do,
          hint: 'AN ผ่านแล้ว รออัป Invoice DO / ETA Official / Terminal แล้วส่ง Partner',
          href: '/fah/do', hrefLabel: 'Upload Invoice of D/O',
        },
        {
          key: 'fn', label: 'Approve cargo Invoice', where: SENIOR_QUEUES.fn,
          hint: 'Import Officer ส่ง Final Invoice มาแล้ว รออนุมัติ',
          href: '/fah/fn', hrefLabel: 'Approve cargo Invoice', extra: [col.fnStatus()],
        },
        {
          key: 'draft', label: 'ตรวจ Draft', where: SENIOR_QUEUES.draft,
          hint: 'Import Officer ส่ง Draft ใบขนมาแล้ว รอตรวจและยื่นใบขน',
          href: '/fah/draft', hrefLabel: 'Submit import decl.',
          extra: [col.refNo(), { label: 'Draft', render: (r) => draftBadge(r) }],
        },
        {
          key: 'customs', label: 'รอผลใบขน (NETBAY)', where: SENIOR_QUEUES.customs,
          hint: 'ยื่นแล้ว รอศุลกากร ACCEPT — ระบบดึงเลขใบขนให้เอง',
          href: '/fah/draft?tab=waiting', hrefLabel: 'Submit import decl.', extra: [col.refNo()],
        },
      ]}
    />
  );
}
