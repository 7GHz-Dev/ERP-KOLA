import { notFound } from 'next/navigation';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { isOtherCargo } from '@/lib/other-cargo';
import Link from 'next/link';
import { IntakeForm } from '@/components/IntakeForm';
import { IntakeBatch } from '@/components/IntakeBatch';
import { ShipmentImport } from '@/components/ShipmentImport';
import { AttachArrival } from '@/components/AttachArrival';
import { Tabs } from '@/components/JobTable';
import { createJobFromIntake, intakeDefaults } from '@/lib/actions/intake';
import { importShipmentCsv, previewShipmentCsv } from '@/lib/actions/shipment-import';
import { attachArrivalFile, attachableBls } from '@/lib/actions/attach-arrival';
import { intakeOptions, settingValue } from '@/lib/queries/master';
import { activeParseTemplates } from '@/lib/parse-template-store';

export const dynamic = 'force-dynamic';

/*
 * สี่ทางเข้าของการรับงาน เรียงตามลำดับที่คนใช้จริง
 *
 * สองแท็บแรกรับงานจากไฟล์ AN/BL โดยตรง — ไฟล์มาก่อน งานตามมา
 * สองแท็บหลังเป็นทางเลือกสำหรับงานที่คีย์ไว้ในตาราง Excel แล้ว — ข้อมูลมาก่อน ไฟล์ตามมาทีหลัง
 * แยกเป็นสองขั้นเพราะไฟล์ PDF ของงานเก่ามักหาไม่ครบในคราวเดียว
 */
const TABS = [
  { key: 'one', label: 'ทีละใบ' },
  { key: 'batch', label: 'หลายใบพร้อมกัน' },
  { key: 'import', label: 'นำเข้า Shipment Detail' },
  { key: 'attach', label: 'แนบไฟล์ AN/BL เข้างาน' },
];

const HEAD: Record<string, string> = {
  one: 'อัปโหลด PDF → ระบบอ่านข้อมูลและเติมฟอร์ม → ตรวจสอบ → บันทึก',
  batch: 'เลือก PDF หลายไฟล์ → ระบบอ่านให้ทุกใบ → ตรวจในตาราง → บันทึกทีเดียว',
  import: 'เลือกไฟล์ตารางงาน (Excel หรือ .csv) → ระบบตรวจทั้งแผ่นให้ดูก่อน → ยืนยันนำเข้าทีเดียว',
  attach: 'เลือก PDF หลายไฟล์ → ระบบจับคู่กับ BL ที่มีในระบบให้เอง → ตรวจ → แนบทีเดียว',
};

export default async function IntakePage({
  params, searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { source } = await params;
  if (source !== 'an' && source !== 'bl') notFound();
  const sourceType = source === 'an' ? 'AN' : 'BL';
  /*
   * Arrival notice upload เป็นงานของ Import Officer (PAINT)
   * BL Waiting Confirm เปิดให้ Senior / Head Officer ด้วย — เพิ่มงานจากปุ่มในหน้า Waiting list
   * สองคนนี้ใช้ได้แค่รับทีละใบ/หลายใบ ส่วนนำเข้าไฟล์ตารางกับแนบ AN เข้างานยังเป็นงานของ PAINT
   */
  const query = await searchParams;
  /*
   * ?jobType=MO|TO — เปิดจากหน้า Other job ของ Head Officer: ตั้ง Job Type ให้ตั้งแต่ต้น
   * Head Officer รับ AN ได้เฉพาะทางนี้ (งาน Other cargo) ฝั่งเซิร์ฟเวอร์ตรวจซ้ำตอนบันทึก
   */
  const otherType = typeof query.jobType === 'string' && isOtherCargo(query.jobType) ? query.jobType.toUpperCase() : '';
  const user = await requireUserReady(
    sourceType === 'BL' ? ['PAINT', 'FAH', 'NAMKANG'] : otherType ? ['PAINT', 'NAMKANG'] : ['PAINT'],
  );
  const isPaint = roleAllows(user.role, ['PAINT']);
  const tabs = isPaint ? TABS : TABS.filter((t) => t.key === 'one' || t.key === 'batch');
  const tabParam = query.tab;
  const tab = typeof tabParam === 'string' && tabs.some((t) => t.key === tabParam) ? tabParam : 'one';

  /*
   * แบบร่างพื้นที่อ่านค่าที่ผู้ดูแลตั้งไว้ที่ /master/parse-template
   * ส่งลงไปให้ฝั่งเบราว์เซอร์ เพราะการอ่าน PDF ทั้งหมดทำในเบราว์เซอร์
   * ไฟล์จึงยังไม่ถูกส่งขึ้นเซิร์ฟเวอร์จนกว่าผู้ใช้จะกดบันทึก เหมือนเดิม
   */
  const [options, ids, demDays, detDays, templates] = await Promise.all([
    intakeOptions(),
    intakeDefaults(),
    settingValue('DEM_FREE_DAYS', '5'),
    settingValue('DET_FREE_DAYS', '3'),
    activeParseTemplates(),
  ]);

  /*
   * รายการ BL ดึงเฉพาะตอนเปิดแท็บแนบไฟล์
   * เป็น query ที่ไล่ทุก BL ของทุกงานที่ยังไม่เข้ากรุ ซึ่งไม่ควรวิ่งตอนเปิดแท็บอื่น
   */
  const blChoices = tab === 'attach' ? await attachableBls() : [];

  // เปิดจากหน้า Other job → Job Type ตั้งต้นเป็น MO / TO แทน MU
  if (otherType) ids.jobTypeId = options.jobTypes.find((t) => t.code?.toUpperCase() === otherType)?.id ?? ids.jobTypeId;
  const backTo = otherType
    ? { href: `/other/${otherType === 'MO' ? 'msfz' : 'transit'}`, label: '← กลับไป Other cargo' }
    : sourceType === 'BL' ? { href: '/waiting-list', label: '← กลับไป Waiting list' } : null;

  const pick = (list: { code: string | null; name: string }[], code: string) =>
    list.find((o) => o.code?.toUpperCase() === code)?.name ?? list[0]?.name ?? '';

  return (
    <>
      <div className="page-head">
        <h1>{sourceType === 'AN' ? 'Arrival notice upload' : 'BL Waiting Confirm'}</h1>
        <p>
          {HEAD[tab]}
          {backTo ? <> · <Link href={backTo.href}>{backTo.label}</Link></> : null}
        </p>
      </div>

      <Tabs basePath={`/intake/${source}`} items={tabs} active={tab} carry={otherType ? { jobType: otherType } : undefined} />

      {tab === 'attach' ? (
        <AttachArrival
          sourceType={sourceType}
          choices={blChoices}
          templates={templates}
          action={attachArrivalFile}
        />
      ) : tab === 'import' ? (
        <ShipmentImport preview={previewShipmentCsv} confirm={importShipmentCsv} />
      ) : tab === 'batch' ? (
        <IntakeBatch
          sourceType={sourceType}
          templates={templates}
          options={{ shippers: options.shippers }}
          defaults={{
            consigneeId: ids.consigneeId,
            notifyId: ids.notifyId,
            portId: ids.portId,
            jobTypeId: ids.jobTypeId,
            demDays,
            detDays,
            containerType: pick(options.containerTypes, '40'),
          }}
          action={createJobFromIntake}
        />
      ) : (
        <IntakeForm
          sourceType={sourceType}
          templates={templates}
          options={options}
          defaults={{
            consigneeId: ids.consigneeId,
            notifyId: ids.notifyId,
            portId: ids.portId,
            jobTypeId: ids.jobTypeId,
            demDays,
            detDays,
            containerType: pick(options.containerTypes, '40'),
            packageType: pick(options.packageTypes, 'UNIT'),
          }}
          action={createJobFromIntake}
        />
      )}
    </>
  );
}
