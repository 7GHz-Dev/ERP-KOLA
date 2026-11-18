import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BlEditPanel } from '@/components/BlEditPanel';
import { requireBlEditorPage } from '@/lib/job-actor';
import { backTo, editQueue, loadBlEdit } from '@/lib/queries/bl-edit';
import { intakeOptions } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงแก้ข้อมูล BL — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function BlEditPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Other cargo (MO / TO): Head Officer · งานใน Waiting list: Senior / Head Officer เปิดได้ด้วย
  const user = await requireBlEditorPage(id);
  const [data, options, queue] = await Promise.all([loadBlEdit(id), intakeOptions(), editQueue(id, (await searchParams).queue)]);
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
      <BlEditPanel key={data.job.id} queue={queue} job={data.job} options={options} source={data.source} other={data.other}
        deletable={data.deletable ? { waiting: data.waitingApproval, returnTo: backTo(data, user.role) } : null} />
    </>
  );
}
