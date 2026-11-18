/**
 * CSV สำหรับ Draft ใบขน (NETBAY) จาก Final Invoice — ให้ดู/ดาวน์โหลดได้ตั้งแต่หน้า Create Cargo Invoice
 *
 * ใช้ตัวอ่านและตัวสร้าง CSV ตัวเดียวกับ worker สร้าง Draft ใบขน (lib/draft) ไฟล์จึงตรงกับที่ worker นำเข้า NETBAY ทุกช่อง
 * ต่างจาก worker แค่ไม่ออกเลขเครื่อง — ใช้เลขที่อยู่ในไฟล์ (บันทึกแล้วเป็นเลขจริง · ก่อนบันทึกเป็น 0000000)
 * ไฟล์ที่ดาวน์โหลดเข้ารหัส TIS-620 แบบที่ NETBAY รับ
 */
import { buildRows, csvText, EncodingError, encodeTis620, loadDraftData, lookupTariff, mapCar, totals, type Totals } from '@/lib/draft/csv';
import { readInvoice } from '@/lib/draft/invoice';
import { safeName } from '@/lib/draft/analyze';

export type DraftCsv = {
  fileName: string;
  columns: string[];
  rows: string[][];
  totals: Totals | null;
  /** ไฟล์ CSV เข้ารหัส TIS-620 (base64) — null เมื่อมีตัวอักษรที่ TIS-620 เข้ารหัสไม่ได้ */
  base64: string | null;
  warnings: string[];
};

export async function draftCsv(finalInvoice: Buffer | Uint8Array): Promise<DraftCsv> {
  const inv = await readInvoice(finalInvoice);
  if (inv.errors.length) throw new Error(`อ่าน Final Invoice ไม่ได้: ${inv.errors[0]}`);
  const data = await loadDraftData();
  const warnings = [...inv.warnings];
  const mapped = inv.cars.map((car) => {
    const [code, note] = lookupTariff(inv.tariff_rows ?? data.tariff, car);
    if (note) warnings.push(`คันที่ ${car.car_no}: ${note}`);
    return mapCar(car, inv, code, car.desc2, data.brandCountry);
  });
  const rows = buildRows(data.csv, mapped);
  const text = csvText(data.csv, rows);
  let base64: string | null = null;
  try {
    base64 = encodeTis620(text).toString('base64');
  } catch (e) {
    if (!(e instanceof EncodingError)) throw e;
    warnings.push(`ดาวน์โหลดไม่ได้: ${e.message}`);
  }
  let sums: Totals | null = null;
  try { sums = totals(data.csv, rows); } catch (e) { warnings.push(e instanceof Error ? e.message : String(e)); }
  if (inv.cars.some((c) => /0000000/.test(c.desc2))) warnings.push('ยังไม่ได้บันทึก — เลขเครื่องในไฟล์นี้เป็น 0000000 (ออกเลขจริงตอนบันทึก Final Invoice)');
  return { fileName: `${safeName(inv.bl_no || inv.invoice_no)}.csv`, columns: data.csv.columns, rows, totals: sums, base64, warnings };
}
