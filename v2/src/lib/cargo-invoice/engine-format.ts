/**
 * เลขเครื่องในรูปแบบ Final Invoice ที่ระบบออก — ใช้ทั้งฝั่งเซิร์ฟเวอร์ (เขียนไฟล์) และหน้าเว็บ (แสดงตัวอย่าง)
 *
 * ไฟล์ผู้ขายเขียน "LDA-MF6 (HYBRID-GASOLINE/1330 CC)" — รหัสเครื่องอาจมีรหัสย่อยต่อท้ายด้วยขีด
 * Final Invoice ใช้เฉพาะรหัสหน้าขีดแรกเป็นส่วนหน้าของเลขเครื่อง แล้วต่อเลขสุ่ม 7 หลัก
 * วงเล็บเหลือแค่เชื้อเพลิงตามตารางพิกัด (ตัด HYBRID- ออก) กับ CC ที่ไม่มีคำว่า CC
 *
 *   LDA-MF6 (HYBRID-GASOLINE/1330 CC) → LDA-1585235(GASOLINE/1330)
 *   4GR (GASOLINE/2490 CC)            → 4GR-1234567(GASOLINE/2490)
 *
 * ไม่ import อะไรที่ผูกกับเซิร์ฟเวอร์ หน้าเว็บจึงเรียกได้
 */

/** เลขเครื่องที่มีเลข 7 หลักต่อท้ายแล้ว เช่น "LDA-1585235" (อัปโหลดไฟล์ Final Invoice เดิมซ้ำ) */
const FULL = /^(.*\S)-(\d{7})$/;

/** ส่วนหน้าของเลขเครื่อง: "LDA-MF6" → "LDA" · "4GR" → "4GR" · "LDA-1585235" → "LDA" */
export function enginePrefix(engine: string): string {
  const head = engine.replace(/\s+/g, '').split('(')[0];
  const full = FULL.exec(head);
  return (full ? full[1] : head).split('-')[0];
}

/** เลข 7 หลักที่มีอยู่แล้วในช่องเลขเครื่อง — null = ยังไม่มี ต้องออกเลขใหม่ */
export function existingEngineNumber(engine: string): string | null {
  return FULL.exec(engine.replace(/\s+/g, '').split('(')[0])?.[2] ?? null;
}

/** ข้อความเต็มที่เขียนลงช่อง ENGINE NO. — number ว่างได้เพื่อแสดงตัวอย่าง (xxxxxxx) */
export function finalEngineText(car: { engine: string; fuel: string; cc: number | null }, number = '') {
  const tail = car.fuel ? `(${car.fuel}/${car.cc ?? ''})` : '';
  return `${enginePrefix(car.engine)}-${number || 'xxxxxxx'}${tail}`;
}
