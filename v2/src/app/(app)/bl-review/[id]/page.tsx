import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BlReviewPanel } from '@/components/BlReviewPanel';
import { requireUserReady } from '@/lib/auth';
import { loadBlReview } from '@/lib/queries/bl-review';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงตรวจก่อนอนุมัติ — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function BlReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['NAMKANG']);
  const { id } = await params;
  const data = await loadBlReview(id);
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
        rows={data.rows}
        approvalId={data.approvalId}
        source={data.source}
        other={data.other}
      />
    </>
  );
}
