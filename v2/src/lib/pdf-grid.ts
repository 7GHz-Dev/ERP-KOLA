/**
 * เส้นตารางพิกัดทับบนหน้า PDF — ใช้ตอนตั้งตำแหน่งค่าบนแบบฟอร์ม
 *
 * หน้าตั้งค่ามีแต่ช่องกรอกตัวเลข ถ้าไม่มีเส้นให้เทียบก็ต้องเดาว่าจะไปอยู่ตรงไหน
 * เส้นนี้อ่านเลขจากขอบบนและขอบซ้ายได้เลย แล้วเอาไปกรอกในตารางพิกัดได้ตรง ๆ
 *
 * เส้นทุก 20 พอยต์ · เส้นเข้มพร้อมตัวเลขทุก 100 พอยต์
 * นับจากมุมบนซ้าย เหมือนที่ตารางพิกัดใช้ (ต่างจาก pdf-lib ที่นับจากล่าง)
 */
export function drawCoordinateGrid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any, font: any, pageW: number, pageH: number, rgb: (r: number, g: number, b: number) => any,
) {
  const faint = rgb(0.62, 0.78, 0.9);
  const strong = rgb(0.15, 0.45, 0.72);

  for (let x = 0; x <= pageW; x += 20) {
    const major = x % 100 === 0;
    page.drawLine({
      start: { x, y: 0 }, end: { x, y: pageH },
      thickness: major ? 0.5 : 0.25, color: major ? strong : faint, opacity: major ? 0.55 : 0.3,
    });
    if (major && x > 0) {
      page.drawText(String(x), { x: x + 2, y: pageH - 10, size: 7, font, color: strong });
    }
  }
  for (let y = 0; y <= pageH; y += 20) {
    const major = y % 100 === 0;
    page.drawLine({
      start: { x: 0, y: pageH - y }, end: { x: pageW, y: pageH - y },
      thickness: major ? 0.5 : 0.25, color: major ? strong : faint, opacity: major ? 0.55 : 0.3,
    });
    if (major && y > 0) {
      page.drawText(String(y), { x: 2, y: pageH - y + 2, size: 7, font, color: strong });
    }
  }
}
