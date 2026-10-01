import { notFound } from 'next/navigation';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { MergedFileView } from '@/components/MergedFileView';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { REORDERABLE_CATEGORIES } from '@/lib/do-bundle-options';
import { loadFileOne } from '@/lib/queries/file-one';

export const dynamic = 'force-dynamic';

/** แผงดูไฟล์ที่เพิ่งอัปโหลด — โครงเดียวกับตัวอย่างไฟล์ตอนรับงาน AN/BL */
export default async function FileDrawer({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserReady();
  const { id } = await params;
  const file = await loadFileOne(id);
  if (!file) notFound();
  /*
   * เรียงหน้าได้เฉพาะชุดแลก DO ตัวปัจจุบันที่ยังไม่ได้ส่งแลก และเฉพาะ ANN ที่เป็นคนรวมชุด
   * ฝั่งเซิร์ฟเวอร์ตรวจซ้ำอีกรอบตอนบันทึก ตรงนี้แค่ตัดสินว่าจะโชว์ปุ่มไหม
   */
  const canReorder = REORDERABLE_CATEGORIES.includes(file.category) && file.isCurrent
    && !file.doExchangedAt && roleAllows(user.role, ['ANN']);

  return (
    <FileDrawerShell
      title={file.categoryLabel}
      fileName={file.fileName}
      meta={`งาน ${file.jobNo}`}
      viewHref={`/files/${file.id}`}
      wide
    >
      {file.note?.includes('ยังขาด:') ? <p className="drawer-note warn">{file.note}</p> : null}
      <MergedFileView file={file} canReorder={canReorder} />
    </FileDrawerShell>
  );
}
