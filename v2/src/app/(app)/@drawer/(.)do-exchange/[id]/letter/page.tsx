import { notFound } from 'next/navigation';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { DoLetterEditPanel } from '@/components/DoLetterEditPanel';
import { requireUserReady } from '@/lib/auth';
import { loadDoLetterText } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

/**
 * แผงแก้ข้อความจดหมายแลก D/O
 *
 * เป็น intercepting route แบบเดียวกับแผงเทียบยอด Slip — กดจากตารางได้แผงนี้
 * เปิด URL ตรง ๆ หรือกดรีเฟรชจะได้หน้าเต็มแทน ลิงก์จึงส่งต่อให้คนอื่นได้
 */
export default async function DoLetterTextDrawer({
  params,
}: { params: Promise<{ id: string }> }) {
  await requireUserReady(['ANN']);
  const { id } = await params;
  const data = await loadDoLetterText(id);
  if (!data) notFound();

  return (
    <FileDrawerShell
      title="แก้ข้อความจดหมายแลก DO"
      fileName={data.letter?.fileName ?? 'ยังไม่เคยออกจดหมาย'}
      meta={`งาน ${data.job.jobNo}${data.line ? ` · ${data.line}` : ''}`}
      viewHref={data.letter ? `/files/${data.letter.id}` : '#'}
      wide
    >
      <DoLetterEditPanel
        jobId={id}
        line={data.line}
        fromJob={data.fromJob}
        edited={data.edited}
        letter={data.letter}
      />
    </FileDrawerShell>
  );
}
