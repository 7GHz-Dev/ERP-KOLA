/**
 * ประกอบไฟล์ FN Invoice — ทางเดียวกันทั้งปุ่ม Preview และปุ่มบันทึก ภาพที่เห็นตอน Preview จึงตรงกับไฟล์ที่บันทึก
 *
 *   1. อ่านไฟล์ใหม่ที่เซิร์ฟเวอร์ แล้วใส่ค่าที่แก้ในตาราง (edit.ts) — โครงไฟล์ ตู้ ลำดับรถ มาจากไฟล์เสมอ
 *   2. เขียนค่าที่แก้กลับลงส่วน invoice ของผู้ขาย (writeCarEdits)
 *   3. JAN TRADING จัดหน้าใหม่ (jan-trading.ts) — Preview ใช้เลขเครื่อง xxxxxxx เพราะยังไม่ออกเลขจริง
 *   4. เขียนตารางสรุป P:AG ให้ worker สร้าง Draft ใบขน (writeSummary)
 */
import { applyEdits, engineDesc } from './edit';
import { enginePrefix, finalEngineText } from './engine-format';
import { finalizeJanTrading } from './jan-trading';
import { parseCargoInvoice, type CargoCar, type CargoInvoice } from './parse';
import { writeCarEdits, writeSummary } from './write';

/** อ่านไฟล์ + ใส่ค่าที่แก้ — original คือรถตามที่อ่านได้ในไฟล์ (ใช้เทียบว่าช่องไหนเปลี่ยน) */
export async function readWithEdits(bytes: Buffer, editsJson: FormDataEntryValue | null) {
  const inv = await parseCargoInvoice(bytes);
  const original = inv.cars;
  let edits: unknown = null;
  if (typeof editsJson === 'string' && editsJson.trim()) {
    try { edits = JSON.parse(editsJson); } catch { throw new Error('ข้อมูลที่แก้ในตารางอ่านไม่ได้ — อ่านไฟล์ใหม่อีกครั้ง'); }
  }
  if (!inv.errors.length) inv.cars = applyEdits(inv.cars, edits);
  return { inv, original };
}

/** BL ที่ใช้: JAN TRADING ใช้ BL ของงานเสมอ · รูปแบบอื่นใช้ของใบ ใบว่างจึงใช้ของงาน */
export function invoiceBl(inv: CargoInvoice, jobBl: string | null | undefined) {
  const job = (jobBl ?? '').replace(/\s/g, '').toUpperCase();
  return inv.pattern === 'JAN TRADING' ? job || inv.blNo : inv.blNo || job;
}

/**
 * ไฟล์ FN Invoice — engineNumbers = เลข 7 หลักของรถแต่ละคัน (null = Preview ยังไม่ออกเลข)
 * inv.cars ถูกปรับเลขเครื่องเต็มเมื่อมีเลขจริง (ตารางสรุปต้องมีเลขเต็ม worker จะได้ไม่สุ่มซ้ำ)
 */
export async function buildFinalInvoice(
  bytes: Buffer, inv: CargoInvoice, original: CargoCar[],
  opts: { tariffs: string[]; engineNumbers: string[] | null },
): Promise<Buffer> {
  let source = await writeCarEdits(bytes, original, inv.cars);
  if (inv.pattern === 'JAN TRADING') {
    const nums = opts.engineNumbers;
    const texts = inv.cars.map((c, i) => finalEngineText(c, nums?.[i] ?? ''));
    if (nums) {
      inv.cars = inv.cars.map((c, i) => {
        const engine = `${enginePrefix(c.engine)}-${nums[i]}`;
        return { ...c, engine, desc2: engineDesc(engine, c.fuel, c.cc, c.year) };
      });
    }
    source = await finalizeJanTrading(source, {
      blNo: inv.blNo, engines: texts,
      total: inv.cars.reduce((s, c) => s + (c.price ?? 0), 0),
      weight: inv.cars.reduce((s, c) => s + (c.weight ?? 0), 0),
    });
  }
  return writeSummary(source, inv, opts.tariffs);
}
