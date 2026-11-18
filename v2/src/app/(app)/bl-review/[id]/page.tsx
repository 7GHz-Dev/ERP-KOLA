import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BlReviewPanel } from '@/components/BlReviewPanel';
import { requireUserReady } from '@/lib/auth';
import { loadBlReview, reviewQueue } from '@/lib/queries/bl-review';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงตรวจก่อนอนุมัติ — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function BlReviewPage({ params, searchParams }: {
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
    <>
      <div className="page-head">
        <h1>ตรวจก่อนอนุมัติ · {data.job.jobNo}</h1>
        <p>
          BL {data.job.blNo ?? '-'} ·{' '}
          <Link className="cell-link" href="/nam/approve">กลับไปหน้าอนุมัติ</Link>
        </p>
      </div>
      <BlReviewPanel
        key={jobId}
        queue={queue}
        rows={data.rows}
        approvalId={data.approvalId}
        source={data.source}
        other={data.other}
      />
    </>
  );
}
