import { notFound } from 'next/navigation';
import { BlReviewPanel } from '@/components/BlReviewPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireUserReady } from '@/lib/auth';
import { loadBlReview } from '@/lib/queries/bl-review';

export const dynamic = 'force-dynamic';

/** แผงตรวจเอกสารก่อนอนุมัติ — ข้อมูลที่กรอกไว้คู่กับไฟล์ AN/BL */
export default async function BlReviewDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['NAMKANG']);
  const { id } = await params;
  const data = await loadBlReview(id);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="ตรวจก่อนอนุมัติ"
      fileName={data.job.blNo ?? data.job.jobNo}
      meta={`งาน ${data.job.jobNo}`}
      viewHref={data.source ? `/files/${data.source.id}` : '#'}
      wide
    >
      <BlReviewPanel
        rows={data.rows}
        approvalId={data.approvalId}
        source={data.source}
        other={data.other}
      />
    </FileDrawerShell>
  );
}
