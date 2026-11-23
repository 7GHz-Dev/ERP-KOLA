import { XlsxPdfView } from '@/components/XlsxPdfView';

/**
 * เนื้อในของแผงดูไฟล์ — ตัวไฟล์อย่างเดียว ส่วนหัวอยู่ที่กรอบแผง
 *
 * รูปใช้ <img> ส่วน PDF ใช้ตัวอ่านของเบราว์เซอร์
 * ไฟล์ที่แสดงในหน้าไม่ได้ (Excel/Word) ยังเปิดหรือโหลดลงเครื่องได้
 */
export type FileInfo = {
  id: string;
  fileName: string;
  mimeType: string | null;
  categoryLabel: string;
  jobNo: string;
};

const VIEWABLE = /^(image\/|application\/pdf$|text\/)/;

/** Excel ที่แปลงเป็น PDF ให้ดูในหน้าได้ (.xls รุ่นเก่าอ่านไม่ได้ ยังต้องโหลด) */
export const isXlsx = (file: Pick<FileInfo, 'fileName' | 'mimeType'>) =>
  /\.xlsx$/i.test(file.fileName) || file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function FilePreview({ file }: { file: FileInfo }) {
  const src = `/files/${file.id}`;
  const mime = file.mimeType ?? '';

  // Excel (Invoice สินค้า ฯลฯ) — ดูเป็น PDF ในหน้า ไม่ต้องโหลดลงเครื่อง
  if (isXlsx(file)) return <XlsxPdfView fileId={file.id} fileName={file.fileName} />;

  if (mime.startsWith('image/')) {
    return <img className="file-preview-view" src={src} alt={file.fileName} />;
  }
  if (VIEWABLE.test(mime)) {
    return (
      <object className="file-preview-view" data={src} type={mime || 'application/pdf'}>
        <p className="drawer-note warn">
          เบราว์เซอร์นี้แสดงไฟล์นี้ในหน้าไม่ได้ ·{' '}
          <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
        </p>
      </object>
    );
  }
  return (
    <p className="drawer-note">
      ไฟล์ชนิดนี้ดูในหน้าไม่ได้ ·{' '}
      <a href={src} target="_blank" rel="noreferrer">เปิด / ดาวน์โหลด</a>
    </p>
  );
}
