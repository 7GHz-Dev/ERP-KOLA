import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JobSummary } from '@/components/JobSummary';
import { requireUser } from '@/lib/auth';
import { loadJobDetail } from '@/lib/queries/job-detail';

export const dynamic = 'force-dynamic';

/** หน้าสรุปงานแบบเต็ม — เปิดตรงจาก URL หรือกดจากแผงก็ได้ ส่งลิงก์ให้กันได้ */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await loadJobDetail(id);
  if (!detail) notFound();

  return (
    <>
      <div className="page-head with-back">
        <Link className="button tiny" href="/jobs">← ทะเบียนงาน</Link>
        <div>
          <h1>สรุปงาน {detail.job.jobNo}</h1>
          <p>ข้อมูลรายการและไฟล์แนบทั้งหมดของงานนี้</p>
        </div>
      </div>
      <div className="sum-page">
        <JobSummary detail={detail} canAck={['PAINT', 'FAH', 'ADMIN'].includes(user.role)} />
      </div>
    </>
  );
}
