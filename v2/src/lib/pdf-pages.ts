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

/**
 * ตรวจลำดับหน้าใหม่ของชุดที่รวมแล้ว — ต้องมีครบทุกหน้า หน้าละครั้งพอดี
 *
 * การเรียงหน้าใช้ keepPages ตัวเดียวกับการตัดหน้า ซึ่งยอมให้ทิ้งหรือซ้ำหน้าได้
 * ตรงนี้กันไว้ เพราะชุดแลก DO ที่หายไปหนึ่งหน้า (เช่นสลิป) ดูด้วยตาแทบไม่ออก
 * จนไปถึงสายเรือแล้วถูกตีกลับ
 *
 * คืนลำดับที่ใช้ได้ (เลขหน้าเริ่มจาก 0) หรือโยนข้อความที่บอกได้ว่าผิดตรงไหน
 */
export function checkPageOrder(order: unknown, total: number): number[] {
  if (!Array.isArray(order) || order.length !== total) {
    throw new Error(`ลำดับหน้าต้องมีครบ ${total} หน้า`);
  }
  const seen = new Set<number>();
  for (const page of order) {
    if (!Number.isInteger(page) || page < 0 || page >= total) {
      throw new Error(`ไม่มีหน้าลำดับที่ ${String(page)} ในไฟล์นี้`);
    }
    if (seen.has(page)) throw new Error(`หน้า ${page + 1} ซ้ำกัน`);
    seen.add(page);
  }
  if (order.every((page, i) => page === i)) throw new Error('ลำดับหน้าเหมือนเดิม ไม่ต้องบันทึก');
  return order as number[];
}
