import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { loadAdminJob } from '@/lib/queries/admin-job';
import { intakeOptions, masterCounts } from '@/lib/queries/master';
import { MasterMenu, JOBS_MENU_KEY } from '@/components/MasterMenu';
import { AdminJobForm } from '@/components/AdminJobForm';

export const dynamic = 'force-dynamic';

/** ADMIN แก้ไขข้อมูล JOB ได้ทุกหัวข้อ — อยู่ในหมวดเดียวกับการปิดใช้งาน JOB */
export default async function AdminJobEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['ADMIN']);
  const { id } = await params;
  const [data, options, counts] = await Promise.all([loadAdminJob(id), intakeOptions(), masterCounts()]);
  if (!data) notFound();

  return (
    <>
      <div className="page-head">
        <h1>แก้ไข JOB · {data.job.jobNo}</h1>
        <p>
          แก้ได้ทุกหัวข้อ · ไม่ขยับขั้นงานเว้นแต่จะเปลี่ยนช่องสถานะเอง
          {data.job.isArchived ? ' · งานนี้ถูกปิดการใช้งานอยู่' : ''}
        </p>
      </div>
      <div className="master-layout">
        <MasterMenu current={JOBS_MENU_KEY} counts={counts} />
        <div style={{ minWidth: 0 }}>
          <AdminJobForm data={data} options={options} />
        </div>
      </div>
    </>
  );
}
