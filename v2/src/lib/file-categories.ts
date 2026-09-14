/**
 * ชื่อและลำดับของหมวดไฟล์แนบ
 *
 * แยกออกจาก queries/job-detail.ts เพราะไฟล์นั้นดึงฐานข้อมูลด้วย
 * ใช้ในคอมโพเนนต์ฝั่งเบราว์เซอร์ไม่ได้ — bundler จะลาก node:fs ตามไปแล้ว build ล้ม
 * ตรงนี้เป็นค่าคงที่ล้วน จึงนำเข้าได้ทั้งสองฝั่ง
 */

/** ชื่อหมวดไฟล์ ใช้คำเดียวกับระบบเดิมเพื่อให้คนอ่านคุ้นตา */
export const FILE_LABELS: Record<string, string> = {
  ARRIVAL_NOTICE: 'Arrival Notice',
  BL: 'Bill of Lading',
  INVOICE_DO: 'DO Invoice',
  INVOICE_GOODS: 'OG Invoice & Packing list',
  SURRENDER: 'Surrender BL',
  FINAL_INVOICE: 'FN Invoice & Packing list',
  FINAL_INVOICE_PDF: 'FN Invoice (ฉบับ PDF สำหรับรวมชุด)',
  DRAFT_ENTRY: 'Draft ใบขน',
  CUSTOMS_ENTRY_DOC: 'ใบขนสินค้า',
  EOFFICE: 'ชุดตรวจปล่อย (E-Office)',
  EOFFICE_REQUEST: 'คำร้อง E-Office',
  EOFFICE_MERGED: 'ชุด E-Office รวม',
  EOFFICE_SIGNED: 'ชุดปล่อย E-Office (เซ็นแล้ว)',
  DO_LETTER: 'จดหมายแลก DO',
  DO_LETTER_UPLOADED: 'จดหมายแลก DO (อัปโหลดเอง)',
  DO_BATCH_MERGED: 'ชุดแลก DO รวมหลายรายการ',
  DO_SLIP: 'Slip โอนเงิน',
  DO_OTHER: 'เอกสารแลก DO อื่น ๆ',
  DO_MERGED: 'ชุดแลก DO รวม',
  OTHER: 'อื่น ๆ',
};

export function fileLabel(category: string) {
  return FILE_LABELS[category] ?? category;
}

/** ลำดับการแสดง เรียงตามขั้นงานจริง ไม่ใช่ตามตัวอักษร */
export const FILE_ORDER = [
  'ARRIVAL_NOTICE', 'BL', 'INVOICE_GOODS', 'FINAL_INVOICE', 'FINAL_INVOICE_PDF', 'INVOICE_DO', 'SURRENDER',
  'DRAFT_ENTRY', 'CUSTOMS_ENTRY_DOC', 'EOFFICE', 'EOFFICE_REQUEST', 'EOFFICE_MERGED', 'EOFFICE_SIGNED',
  'DO_LETTER', 'DO_LETTER_UPLOADED', 'DO_SLIP', 'DO_OTHER', 'DO_MERGED', 'DO_BATCH_MERGED', 'OTHER',
];
