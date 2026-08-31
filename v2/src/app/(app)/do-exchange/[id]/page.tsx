import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SlipCheckPanel } from '@/components/SlipCheckPanel';
import { requireUser } from '@/lib/auth';
import { loadSlipCheck } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงเทียบยอด — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['ANN']);
  const { id } = await params;
  const data = await loadSlipCheck(id);
  if (!data) notFound();

  return (
    <>
      <div className="page-head">
        <h1>เทียบยอด · {data.job.jobNo}</h1>
        <p>
          BL {data.job.blNo ?? '-'} ·{' '}
          <Link className="cell-link" href="/do-exchange">กลับไปหน้าจัดการแลก DO</Link>
        </p>
      </div>
      <SlipCheckPanel jobId={id} invoiceDo={data.invoiceDo} slip={data.slip} />
    </>
  );
}
