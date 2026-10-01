import { notFound } from 'next/navigation';
import { MergedFileView } from '@/components/MergedFileView';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { REORDERABLE_CATEGORIES } from '@/lib/do-bundle-options';
import { loadFileOne } from '@/lib/queries/file-one';

export const dynamic = 'force-dynamic';

/** หน้าเต็มของแผงดูไฟล์ — ใช้ตอนเปิด URL ตรง ๆ หรือกดรีเฟรช */
export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
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
    <>
      <div className="page-head">
        <h1>{file.categoryLabel}</h1>
        <p>งาน {file.jobNo}</p>
      </div>
      <MergedFileView file={file} canReorder={canReorder} />
      {file.note?.includes('ยังขาด:') ? <p className="drawer-note warn">{file.note}</p> : null}
    </>
  );
}
