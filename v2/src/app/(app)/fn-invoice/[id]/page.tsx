import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CargoInvoiceTool } from '@/components/CargoInvoiceTool';
import { requireUserReady } from '@/lib/auth';
import { loadFnInvoice } from '@/lib/queries/fn-invoice';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของ Create FN Invoice — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function FnInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['PAINT']);
  const { id } = await params;
  const data = await loadFnInvoice(id);
  if (!data) notFound();
  return (
    <>
      <div className="page-head">
        <h1>Create FN Invoice · {data.job.jobNo}</h1>
        <p>BL {data.job.blNo ?? '-'} · <Link className="cell-link" href="/pending?tab=fn">กลับไปหน้างานคงค้าง</Link></p>
      </div>
      <CargoInvoiceTool shippers={data.shippers} presetJob={data.job} presetFile={data.goods} />
    </>
  );
}
