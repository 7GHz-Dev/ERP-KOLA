import { intakeDefaults } from '@/lib/actions/intake';
import { activeParseTemplates } from '@/lib/parse-template-store';
import { intakeOptions, settingValue } from '@/lib/queries/master';

/**
 * ข้อมูลตั้งต้นของฟอร์มรับงาน (ตัวเลือก Master Data · ค่าตั้งต้น · แบบร่างพื้นที่อ่าน PDF)
 * ใช้ร่วมกันระหว่างหน้า Arrival notice upload กับหน้า Waiting list — ฟอร์มเดียวกัน ค่าตั้งต้นต้องตรงกัน
 */
export async function intakeSetup() {
  const [options, ids, demDays, detDays, templates] = await Promise.all([
    intakeOptions(),
    intakeDefaults(),
    settingValue('DEM_FREE_DAYS', '5'),
    settingValue('DET_FREE_DAYS', '3'),
    activeParseTemplates(),
  ]);
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

/** ฟอร์มหลายใบพร้อมกันไม่มีช่องหน่วยสินค้า */
export function batchDefaults({ packageType: _unused, ...rest }: Awaited<ReturnType<typeof intakeSetup>>['defaults']) {
  return rest;
}
