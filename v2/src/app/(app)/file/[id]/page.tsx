import { notFound } from 'next/navigation';
import { FilePreview } from '@/components/FilePreview';
import { requireUser } from '@/lib/auth';
import { loadFileOne } from '@/lib/queries/file-one';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงดูไฟล์ — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const file = await loadFileOne(id);
  if (!file) notFound();

  return (
    <>
      <div className="page-head">
        <h1>{file.categoryLabel}</h1>
        <p>งาน {file.jobNo}</p>
      </div>
      <FilePreview file={file} />
    </>
  );
}
