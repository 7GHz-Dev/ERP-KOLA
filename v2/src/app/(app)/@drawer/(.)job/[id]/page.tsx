import { notFound } from 'next/navigation';
import { DrawerShell } from '@/components/DrawerShell';
import { JobSummary } from '@/components/JobSummary';
import { requireUser } from '@/lib/auth';
import { loadJobDetail } from '@/lib/queries/job-detail';

export const dynamic = 'force-dynamic';

/**
 * แผงสรุปงานที่กางทับหน้าเดิม
 *
 * เป็น intercepting route — กดจากตารางจะได้แผงนี้ ส่วนการเปิด URL ตรง ๆ
 * หรือกดรีเฟรชจะได้หน้าเต็มที่ /job/[id] แทน ลิงก์จึงยังส่งต่อให้คนอื่นได้
 */
export default async function JobDrawer({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await loadJobDetail(id);
  if (!detail) notFound();

  return (
    <DrawerShell jobId={id} jobNo={detail.job.jobNo}>
      <JobSummary detail={detail} canAck={['PAINT', 'FAH', 'ADMIN'].includes(user.role)} />
    </DrawerShell>
  );
}
