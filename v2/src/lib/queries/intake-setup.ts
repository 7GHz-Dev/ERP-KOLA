import { intakeDefaults } from '@/lib/actions/intake';
import { activeParseTemplates } from '@/lib/parse-template-store';
import { intakeOptions } from '@/lib/queries/master';

/**
 * ข้อมูลตั้งต้นของฟอร์มรับงาน (ตัวเลือก Master Data · ค่าตั้งต้น · แบบร่างพื้นที่อ่าน PDF)
 * ใช้ร่วมกันระหว่างหน้า Arrival notice upload กับหน้า Waiting list — ฟอร์มเดียวกัน ค่าตั้งต้นต้องตรงกัน
 */
export async function intakeSetup() {
  const [options, ids, templates] = await Promise.all([
    intakeOptions(),
    intakeDefaults(),
    activeParseTemplates(),
  ]);
  // DEM / DET ตั้งต้นเป็น N/A (ว่าง) — FAH กรอกจาก Invoice DO ที่หน้า Upload Invoice of D/O ก่อนส่ง Partner
  const demDays = '';
  const detDays = '';
  const pick = (list: { code: string | null; name: string }[], code: string) =>
    list.find((o) => o.code?.toUpperCase() === code)?.name ?? list[0]?.name ?? '';
  const defaults = {
    consigneeId: ids.consigneeId,
    notifyId: ids.notifyId,
    portId: ids.portId,
    jobTypeId: ids.jobTypeId,
    demDays,
    detDays,
    containerType: pick(options.containerTypes, '40'),
    packageType: pick(options.packageTypes, 'UNIT'),
  };
  return { options, ids, defaults, templates };
}

