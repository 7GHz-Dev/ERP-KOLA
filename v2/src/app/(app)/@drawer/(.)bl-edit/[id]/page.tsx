import { notFound } from 'next/navigation';
import { BlEditPanel } from '@/components/BlEditPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireUserReady } from '@/lib/auth';
import { loadBlEdit } from '@/lib/queries/bl-edit';
import { intakeOptions } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

/**
 * แผงแก้ข้อมูล BL คู่กับไฟล์ AN/BL
 *
 * เป็น intercepting route แบบเดียวกับแผงอื่น กดแก้ไขจากตารางได้แผงนี้ทับหน้าเดิม
 * ปิดแล้วกลับมาที่รายการตำแหน่งเดิมพร้อมแท็บและคำค้นเดิม
 */
export default async function BlEditDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['PAINT']);
  const { id } = await params;
  const [data, options] = await Promise.all([loadBlEdit(id), intakeOptions()]);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="แก้ข้อมูล BL"
      fileName={data.job.blNo ?? data.job.jobNo}
      meta={`งาน ${data.job.jobNo}`}
      viewHref={data.source ? `/files/${data.source.id}` : '#'}
      wide
    >
      <BlEditPanel
        job={data.job}
        options={options}
        source={data.source}
        other={data.other}
      />
    </FileDrawerShell>
  );
}
