import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BlEditPanel } from '@/components/BlEditPanel';
import { requireJobPage } from '@/lib/job-actor';
import { loadBlEdit } from '@/lib/queries/bl-edit';
import { intakeOptions } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงแก้ข้อมูล BL — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function BlEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Other cargo (MO / TO): Head Officer เปิดได้ด้วย
  await requireJobPage(id, ['PAINT']);
  const [data, options] = await Promise.all([loadBlEdit(id), intakeOptions()]);
  if (!data) notFound();

  return (
    <>
      <div className="page-head">
        <h1>แก้ข้อมูล BL · {data.job.jobNo}</h1>
        <p>
          BL {data.job.blNo ?? '-'} ·{' '}
          <Link className="cell-link" href="/pending">กลับไปหน้างานคงค้าง</Link>
        </p>
      </div>
      <BlEditPanel job={data.job} options={options} source={data.source} other={data.other}
        deletable={data.deletable ? { waiting: data.waitingApproval, returnTo: data.returnTo } : null} />
    </>
  );
}
