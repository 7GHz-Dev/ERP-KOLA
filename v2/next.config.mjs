/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // ไม่เปิด typedRoutes เพราะหน้าตารางประกอบ URL query แบบ dynamic (ค้นหา/เรียงลำดับ)
  // ซึ่งตรวจตอน compile ไม่ได้อยู่แล้ว เปิดไว้มีแต่ต้อง cast ทิ้งความปลอดภัยไปเปล่า ๆ

  /*
   * ฟอนต์ถูกอ่านตอนรันด้วย readFile ไม่ได้ import เข้ามา
   * ตัวเก็บไฟล์ของ Next จึงมองไม่เห็นและไม่ขนตามขึ้นเซิร์ฟเวอร์
   * ผลคือขึ้นโฮสต์แล้วออกคำร้องกับแปลง Final Invoice ไม่ได้ ทั้งที่บนเครื่องตัวเองใช้ได้
   */
  outputFileTracingIncludes: {
    '/**': ['./assets/fonts/**'],
  },
};
