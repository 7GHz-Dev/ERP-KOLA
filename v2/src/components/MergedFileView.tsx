'use client';

import { useState } from 'react';
import { FilePreview, type FileInfo } from '@/components/FilePreview';
import { PageOrderEditor } from '@/components/PageOrderEditor';

/**
 * ตัวดูไฟล์ที่มีปุ่มเรียงหน้าใหม่ — ใช้กับชุดแลก DO ที่รวมแล้ว
 *
 * คืนเป็น fragment ไม่ห่อด้วย div เพราะ CSS ของแผงดูไฟล์จับตัวดูที่เป็นลูกตรงของเนื้อแผง
 * ถ้าห่ออีกชั้น ตัวดูจะไม่ยืดเต็มความสูงแผง
 */
export function MergedFileView({ file, canReorder }: { file: FileInfo; canReorder: boolean }) {
  const [editing, setEditing] = useState(false);

  if (!canReorder) return <FilePreview file={file} />;

  return (
    <>
      {editing ? null : (
        <div className="file-order-bar">
          <span>ลำดับหน้ายังไม่ตรงกับที่สายเรือต้องการ? เรียงใหม่ได้ก่อนกดส่งแลก</span>
          <button type="button" className="button tiny primary" onClick={() => setEditing(true)}>
            เรียงหน้าใหม่
          </button>
        </div>
      )}
      {editing
        ? <PageOrderEditor fileId={file.id} onCancel={() => setEditing(false)} />
        : <FilePreview file={file} />}
    </>
  );
}
