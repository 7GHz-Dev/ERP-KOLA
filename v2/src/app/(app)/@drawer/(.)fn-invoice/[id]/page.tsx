import { notFound } from 'next/navigation';
import { CargoInvoiceTool } from '@/components/CargoInvoiceTool';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireUserReady } from '@/lib/auth';
import { loadFnInvoice } from '@/lib/queries/fn-invoice';

export const dynamic = 'force-dynamic';

/**
 * Create FN Invoice — หน้าต่าง popup จากปุ่มในแท็บ 2. Final Invoice (แทนปุ่มอัปโหลด Final Invoice)
 * ใช้เครื่องมือเดียวกับเมนู Create Cargo Invoice แต่ผูกกับงานนี้ · บันทึกแล้วเป็นไฟล์ Final Invoice ของงาน
 */
export default async function FnInvoiceDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['PAINT']);
  const { id } = await params;
  const data = await loadFnInvoice(id);
  if (!data) notFound();
  return (
    <FileDrawerShell title="Create FN Invoice" fileName={data.job.blNo ?? data.job.jobNo} meta={`งาน ${data.job.jobNo}`} viewHref={`/fn-invoice/${id}`} wide>
      <div className="fn-popup">
        <CargoInvoiceTool shippers={data.shippers} presetJob={data.job} />
      </div>
    </FileDrawerShell>
  );
}
