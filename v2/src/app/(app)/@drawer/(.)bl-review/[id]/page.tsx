import { notFound } from 'next/navigation';
import { BlReviewPanel } from '@/components/BlReviewPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireUserReady } from '@/lib/auth';
import { loadBlReview, reviewQueue } from '@/lib/queries/bl-review';

export const dynamic = 'force-dynamic';

/** แผงตรวจเอกสารก่อนอนุมัติ — ข้อมูลที่กรอกไว้คู่กับไฟล์ AN/BL */
export default async function BlReviewDrawer({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['NAMKANG']);
  const { id } = await params;
  // ?aq= ชุดที่ติ๊กตรวจต่อกัน · id ใบแรกเป็น id รายการอนุมัติได้
  const { jobId, queue } = await reviewQueue(id, (await searchParams).aq);
  const data = await loadBlReview(jobId);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="ตรวจก่อนอนุมัติ"
      fileName={data.job.blNo ?? data.job.jobNo}
      meta={queue ? `งาน ${data.job.jobNo} · ${queue.index + 1}/${queue.jobIds.length}` : `งาน ${data.job.jobNo}`}
      viewHref={data.source ? `/files/${data.source.id}` : '#'}
      wide
    >
      <BlReviewPanel
        key={jobId}
        queue={queue}
        rows={data.rows}
        approvalId={data.approvalId}
        source={data.source}
        other={data.other}
      />
    </FileDrawerShell>
  );
}
