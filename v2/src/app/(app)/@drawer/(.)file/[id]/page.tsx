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

  /*
   * Invoice DO เปิดมาเพื่ออ่านยอดแล้วกรอก ETA · Port · Terminal · Partner
   * ในตารางหน้า Upload InvDO ต่อทันที แผงจึงจอดซ้ายและไม่บังตาราง
   * ไฟล์หมวดอื่นเปิดมาเพื่อดูอย่างเดียว ใช้แผงขวาทับหน้าตามเดิม
   */
  const dockLeft = file.category === 'INVOICE_DO';

  return (
    <FileDrawerShell
      title={file.categoryLabel}
      fileName={file.fileName}
      meta={`งาน ${file.jobNo}`}
      viewHref={`/files/${file.id}`}
      wide
      dockLeft={dockLeft}
    >
      <FilePreview file={file} />
    </FileDrawerShell>
  );
}
