import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { listJobs } from '@/lib/queries/jobs';
import { getPriceSet, isMissingTable, lastPriceForClient } from '@/lib/sale/price-store';
import { baht } from '@/lib/sale/pricing';
import { PriceEditor } from '@/components/PriceEditor';
import { ApprovalBadge } from '@/components/JobTable';

export const dynamic = 'force-dynamic';

/** กำหนดราคาเก็บลูกค้าของงานหนึ่ง — SALE OFFICER / SALE SUPERVISOR */
export default async function PriceJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  await requireUserReady(['SALE', 'SALE_SUPERVISOR']);
  const { jobId } = await params;
  const { rows } = await listJobs({ where: () => [eq(jobs.id, jobId)] });
  const job = rows[0];
  if (!job) notFound();

  let price: Awaited<ReturnType<typeof getPriceSet>> = null;
  let copyFrom: Awaited<ReturnType<typeof lastPriceForClient>> = null;
  try {
    [price, copyFrom] = await Promise.all([getPriceSet(jobId), lastPriceForClient(job.personId, jobId)]);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    return <p className="notice">ยังไม่ได้สร้างตารางของงาน Sale — ผู้ดูแลระบบต้องรัน <code>npm run migrate:sale</code> ก่อน</p>;
  }

  return (
    <>
      <div className="page-head">
        <h1>กำหนดราคา · {job.jobNo}</h1>
        <p><Link href="/sale/pricing">← กลับไปรายการ</Link></p>
      </div>
      <section className="cgi-card price-job">
        <div className="cgi-head">
          <div><span>BL</span><b>{job.blNo ?? '-'}</b></div>
          <div><span>Client in charge</span><b>{job.personName ?? '-'}</b></div>
          <div><span>Shipper</span><b>{job.shipperName ?? '-'}</b></div>
          <div><span>ประเภทงาน</span><b>{job.jobTypeName ?? '-'}</b></div>
          <div><span>ETA</span><b>{formatDate(job.eta)}</b></div>
          <div><span>ตู้</span><b>{job.containerCount || '-'}</b><small>{job.containerNos?.replaceAll(',', ', ')}</small></div>
          <div><span>AN / FN</span><b><ApprovalBadge status={job.anStatus} /> <ApprovalBadge status={job.fnStatus} /></b></div>
          <div><span>ราคาปัจจุบัน</span><b>{price ? `${baht(price.total)} บาท` : '-'}</b>
            <small>{price?.confirmedAt ? `ยืนยันแล้ว ${formatDateTime(price.confirmedAt)}` : price ? 'ร่าง — ยังไม่ยืนยัน' : 'ยังไม่ได้กำหนด'}</small></div>
        </div>
      </section>
      <section className="cgi-card">
        <PriceEditor
          jobId={jobId}
          containers={job.containerCount}
          initial={price?.lines ?? []}
          note={price?.note ?? ''}
          confirmed={Boolean(price?.confirmedAt)}
          copyFrom={copyFrom}
        />
      </section>
    </>
  );
}
