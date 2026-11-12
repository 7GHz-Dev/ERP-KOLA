import { allRules, checkRules } from '@/lib/cargo-invoice/tariff';
import { ENGINE_FILTERS, searchEngineNumbers } from '@/lib/engine-numbers';
import { cargoReader, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';

/**
 * ข้อมูลอ้างอิงของ Create Cargo Invoice ให้ PAINT ตรวจซ้ำ / ผิด
 *   ?kind=tariff  ตาราง datatariff ทั้งชุด (ตารางหลัก + เพิ่มเอง) พร้อมผลตรวจกฎซ้ำ / ขัดกัน — กรองที่หน้าเว็บ
 *   ?kind=engine  เลขเครื่องที่ระบบออกแล้ว กรองรายคอลัมน์ที่เซิร์ฟเวอร์ (ตารางใหญ่) ?issues=1 เฉพาะแถวที่มีปัญหา
 */
export async function GET(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const q = new URL(request.url).searchParams;
  if (q.get('kind') === 'tariff') {
    const rules = checkRules(await allRules());
    return json({ rules });
  }
  if (q.get('kind') === 'engine') {
    const filter = Object.fromEntries(ENGINE_FILTERS.map((k) => [k, (q.get(k) ?? '').slice(0, 60)]));
    return json(await searchEngineNumbers(filter, q.get('issues') === '1'));
  }
  return json({ error: 'kind ต้องเป็น tariff หรือ engine' }, 400);
}
