import { requireUserReady } from '@/lib/auth';
import { PendingView } from '@/components/PendingView';

export const dynamic = 'force-dynamic';

/** Pending jobs ของ Import Officer (PAINT) — งาน Other cargo (MO / TO) ไม่อยู่ที่นี่ Head Officer ทำเองที่หน้า Other job */
export default async function PendingPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['PAINT']);
  return (
    <PendingView
      mode="paint"
      basePath="/pending"
      title="Pending jobs"
      subtitle="BL → Final Invoice → Draft ใบขน → เตรียมเอกสารเดิน E (คำร้อง → รวมชุด → ส่งมอบคนเดินเอกสาร)"
      searchParams={await searchParams}
    />
  );
}
