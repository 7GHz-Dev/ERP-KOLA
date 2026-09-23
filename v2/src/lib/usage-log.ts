/**
 * ชื่อ action ใน activity_log ที่หน้า Monitor ใช้ — นิยามที่เดียว
 *
 * ฝั่งที่บันทึกกับฝั่งที่อ่านต้องใช้ค่าเดียวกันเป๊ะ ถ้าพิมพ์ต่างกันแม้แต่ตัวเดียว
 * หน้าจอจะขึ้นยอด 0 บาทตลอดโดยไม่มี error ให้เห็น ซึ่งดูเหมือนยังไม่มีใครใช้ AI เลย
 *
 * ไม่ประกาศไว้ในไฟล์ route เพราะ Next.js ไม่ยอมให้ export ค่าอื่น
 * นอกจาก handler กับ config ที่มันรู้จัก
 */

/** เรียก AI อ่าน AN/BL หนึ่งครั้ง — detail เก็บ { baht, ms, ok } */
export const AI_READ_ACTION = 'AI_READ_DOC';

/** webhook ของ LINE เห็น source ใหม่ — detail เก็บ { type, id } */
export const LINE_SOURCE_ACTION = 'LINE_WEBHOOK_SOURCE';
