import { notFound } from 'next/navigation';
import { DoLetterEditPanel } from '@/components/DoLetterEditPanel';
import { requireUser } from '@/lib/auth';
import { loadDoLetterText } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

/** หน้าแก้ข้อความจดหมายแลก D/O แบบเต็มจอ — เปิดตรงจาก URL หรือกดรีเฟรชก็ได้หน้านี้ */
export default async function DoLetterTextPage({
  params,
}: { params: Promise<{ id: string }> }) {
  await requireUser(['ANN']);
  const { id } = await params;
  const data = await loadDoLetterText(id);
  if (!data) notFound();

  return (
    <>
      <div className="page-head">
        <h1>แก้ข้อความจดหมายแลก DO</h1>
        <p>งาน {data.job.jobNo}{data.line ? ` · สายเรือ ${data.line}` : ''}</p>
      </div>
      <DoLetterEditPanel
        jobId={id}
        line={data.line}
        fromJob={data.fromJob}
        edited={data.edited}
        letter={data.letter}
      />
    </>
  );
}
