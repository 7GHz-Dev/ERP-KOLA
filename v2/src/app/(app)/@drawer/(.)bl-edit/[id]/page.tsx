import { notFound } from 'next/navigation';
import { BlEditPanel } from '@/components/BlEditPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireBlEditorPage } from '@/lib/job-actor';
import { backTo, editQueue, loadBlEdit } from '@/lib/queries/bl-edit';
import { intakeOptions } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

/**
 * แผงแก้ข้อมูล BL คู่กับไฟล์ AN/BL
 *
 * เป็น intercepting route แบบเดียวกับแผงอื่น กดแก้ไขจากตารางได้แผงนี้ทับหน้าเดิม
 * ปิดแล้วกลับมาที่รายการตำแหน่งเดิมพร้อมแท็บและคำค้นเดิม
 */
export default async function BlEditDrawer({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Other cargo (MO / TO): Head Officer · งานใน Waiting list: Senior / Head Officer เปิดได้ด้วย
  const user = await requireBlEditorPage(id);
  const [data, options, queue] = await Promise.all([loadBlEdit(id), intakeOptions(), editQueue(id, (await searchParams).queue)]);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="แก้ข้อมูล BL"
      fileName={data.job.blNo ?? data.job.jobNo}
      meta={queue ? `งาน ${data.job.jobNo} · ${queue.index + 1}/${queue.ids.length}` : `งาน ${data.job.jobNo}`}
      viewHref={data.source ? `/files/${data.source.id}` : '#'}
      wide
    >
      <BlEditPanel
        key={data.job.id}
        queue={queue}
        containers={data.containers}
        job={data.job}
        options={options}
        source={data.source}
        other={data.other}
        deletable={data.deletable ? { waiting: data.waitingApproval, returnTo: backTo(data, user.role) } : null}
      />
    </FileDrawerShell>
  );
}
