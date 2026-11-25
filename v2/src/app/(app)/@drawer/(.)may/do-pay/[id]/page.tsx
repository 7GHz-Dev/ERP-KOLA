import { notFound } from 'next/navigation';
import { DoPayPanel } from '@/components/DoPayPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { requireUserReady } from '@/lib/auth';
import { loadDoPay } from '@/lib/queries/do-files';
import { chargesFor, doChargeTopics } from '@/lib/queries/do-charges';

export const dynamic = 'force-dynamic';

/**
 * แผงกรอกยอดชำระคู่กับ Invoice DO
 *
 * เป็น intercepting route แบบเดียวกับแผงเทียบยอดของ ANN — กดปุ่ม ดู จากตารางได้แผงนี้
 * ทับหน้าเดิม ปิดแล้วกลับมาที่รายการตำแหน่งเดิม เปิด URL ตรง ๆ จะได้หน้าเต็มแทน
 */
export default async function DoPayDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['MAY']);
  const { id } = await params;
  const [data, charges, topics] = await Promise.all([loadDoPay(id), chargesFor([id]), doChargeTopics()]);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="ยอดชำระค่าแลก D/O"
      fileName={data.invoiceDo?.fileName ?? 'ยังไม่มีไฟล์ Invoice DO'}
      meta={`งาน ${data.job.jobNo} · BL ${data.job.blNo ?? '-'}`}
      viewHref={data.invoiceDo ? `/files/${data.invoiceDo.id}` : '#'}
      wide
    >
      <DoPayPanel
        jobId={id}
        invoiceDo={data.invoiceDo}
        blNo={data.job.blNo}
        eta={data.job.eta}
        shipline={data.job.shipline}
        amount={data.job.doPayAmount}
        charges={charges.get(id) ?? []}
        topics={topics}
        claimedAt={data.job.doClaimedAt}
        nextId={data.nextId}
      />
    </FileDrawerShell>
  );
}
