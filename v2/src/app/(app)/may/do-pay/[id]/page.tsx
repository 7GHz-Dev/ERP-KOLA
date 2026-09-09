import { notFound } from 'next/navigation';
import Link from 'next/link';
import { DoPayPanel } from '@/components/DoPayPanel';
import { requireUserReady } from '@/lib/auth';
import { loadDoPay } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงกรอกยอด — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function DoPayPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['MAY']);
  const { id } = await params;
  const data = await loadDoPay(id);
  if (!data) notFound();

  return (
    <>
      <div className="page-head">
        <h1>ยอดชำระ · {data.job.jobNo}</h1>
        <p>
          BL {data.job.blNo ?? '-'} ·{' '}
          <Link className="cell-link" href="/may/do-pay">กลับไปหน้ารอแลก DO</Link>
        </p>
      </div>
      <DoPayPanel
        jobId={id}
        invoiceDo={data.invoiceDo}
        blNo={data.job.blNo}
        eta={data.job.eta}
        shipline={data.job.shipline}
        amount={data.job.doPayAmount}
      />
    </>
  );
}
