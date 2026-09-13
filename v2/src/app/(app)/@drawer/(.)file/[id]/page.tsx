import { notFound } from 'next/navigation';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { FilePreview } from '@/components/FilePreview';
import { requireUserReady } from '@/lib/auth';
import { loadFileOne } from '@/lib/queries/file-one';

export const dynamic = 'force-dynamic';

/** แผงดูไฟล์ที่เพิ่งอัปโหลด — โครงเดียวกับตัวอย่างไฟล์ตอนรับงาน AN/BL */
export default async function FileDrawer({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady();
  const { id } = await params;
  const file = await loadFileOne(id);
  if (!file) notFound();

  return (
    <FileDrawerShell
      title={file.categoryLabel}
      fileName={file.fileName}
      meta={`งาน ${file.jobNo}`}
      viewHref={`/files/${file.id}`}
      wide
    >
      {file.note?.includes('ยังขาด:') ? <p className="drawer-note warn">{file.note}</p> : null}
      <FilePreview file={file} />
    </FileDrawerShell>
  );
}
