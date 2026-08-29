/**
 * ตัดหน้าที่ไม่ต้องการออกจากไฟล์ PDF
 *
 * แยกออกมาจากหน้าจอเพราะเป็นตรรกะล้วน ๆ ทดสอบกับไฟล์จริงได้โดยไม่ต้องเปิดเบราว์เซอร์
 * ใช้ได้ทั้งฝั่งเบราว์เซอร์ (ตอนผู้ใช้ตัดหน้าก่อนบันทึกงาน) และฝั่งเซิร์ฟเวอร์
 */

/**
 * สร้างไฟล์ใหม่ที่มีเฉพาะหน้าที่เลือกไว้ เรียงตามลำดับที่ส่งเข้ามา
 * เลขหน้าเริ่มจาก 0 เหมือนที่ pdf-lib ใช้
 */
export async function keepPages(
  source: Uint8Array | ArrayBuffer,
  keep: number[],
): Promise<Uint8Array> {
  if (!keep.length) throw new Error('ต้องเหลืออย่างน้อย 1 หน้า');

  const { PDFDocument } = await import('@cantoo/pdf-lib');
  // ไฟล์สายเรือบางใบล็อกไว้โดยที่รหัสผ่านผู้อ่านเป็นค่าว่าง ต้องถอดจริง ไม่ใช่ข้าม
  // ถ้าใช้ ignoreEncryption จะเปิดได้แต่เนื้อในหายหมดกลายเป็นหน้าขาว
  const doc = await PDFDocument.load(source, { password: '' });

  const total = doc.getPageCount();
  const bad = keep.find((i) => !Number.isInteger(i) || i < 0 || i >= total);
  if (bad !== undefined) throw new Error(`ไฟล์นี้มี ${total} หน้า ไม่มีหน้าลำดับที่ ${bad}`);

  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, keep);
  pages.forEach((page) => out.addPage(page));
  return out.save();
}
