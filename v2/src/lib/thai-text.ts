/**
 * วาดข้อความไทยให้สระบนและวรรณยุกต์ซ้อนถูกที่
 *
 * ปัญหา: สระบน/ล่างและวรรณยุกต์ของไทยมี xAdvance = 0 คือไม่กินที่แนวนอน
 * ต้องซ้อนทับพยัญชนะตัวก่อนหน้า แต่ drawText ของ pdf-lib วางเป็นตัวแยก
 * คำอย่าง "เรื่อง" จึงออกมาเป็น "เรื่ อง" และ "ชื่อเรือ" เป็น "ชื่ อเรือ"
 *
 * วิธีแก้: ให้ fontkit จัดวางก่อน แล้วรวมตัวที่ไม่กินที่เข้ากับตัวก่อนหน้าเป็นก้อนเดียว
 * จากนั้นวาดทีละก้อนแล้วเลื่อน x ตามระยะจริงที่ fontkit คำนวณให้
 */

export type Cluster = { text: string; advance: number };

/** แยกข้อความเป็นก้อนที่วาดได้ทีละก้อน พร้อมระยะที่ต้องเลื่อนหลังวาด */
export function clustersOf(rawFont: any, text: string, size: number): Cluster[] {
  const run = rawFont.layout(text);
  const upem = rawFont.unitsPerEm;
  const out: Cluster[] = [];
  run.glyphs.forEach((glyph: any, i: number) => {
    const advance = (run.positions[i].xAdvance / upem) * size;
    const chars = String.fromCodePoint(...(glyph.codePoints ?? []));
    // ไม่กินที่ = ต้องซ้อนบนตัวก่อนหน้า จึงรวมเป็นก้อนเดียวกัน
    if (advance === 0 && out.length) out[out.length - 1].text += chars;
    else out.push({ text: chars, advance });
  });
  return out;
}
