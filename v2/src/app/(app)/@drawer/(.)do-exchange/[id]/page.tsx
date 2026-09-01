import { notFound } from 'next/navigation';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { SlipCheckPanel } from '@/components/SlipCheckPanel';
import { requireUser } from '@/lib/auth';
import { loadSlipCheck } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

/**
 * แผงเทียบยอด Invoice DO กับ Slip
 *
 * เป็น intercepting route แบบเดียวกับแผงสรุปงาน — กดจากตารางได้แผงนี้
 * เปิด URL ตรง ๆ หรือกดรีเฟรชจะได้หน้าเต็มแทน ลิงก์จึงส่งต่อให้คนอื่นได้
 */
export default async function SlipDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['ANN']);
  const { id } = await params;
  const data = await loadSlipCheck(id);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="เทียบยอด Invoice DO กับ Slip"
      fileName={data.slip?.fileName ?? 'ยังไม่มีไฟล์ Slip'}
      meta={`งาน ${data.job.jobNo}`}
      viewHref={data.slip ? `/files/${data.slip.id}` : '#'}
      wide
    >
      <SlipCheckPanel jobId={id} invoiceDo={data.invoiceDo} slip={data.slip} />
    </FileDrawerShell>
  );
}
