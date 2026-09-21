import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
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

const TAB_KEYS = TABS.map((t) => t.key);

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
  await requireUserReady(['PAINT']);
  const { source } = await params;
  const tabParam = (await searchParams).tab;
  const tab = typeof tabParam === 'string' && TAB_KEYS.includes(tabParam) ? tabParam : 'one';
  if (source !== 'an' && source !== 'bl') notFound();
  const sourceType = source === 'an' ? 'AN' : 'BL';

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

  const pick = (list: { code: string | null; name: string }[], code: string) =>
    list.find((o) => o.code?.toUpperCase() === code)?.name ?? list[0]?.name ?? '';

  return (
    <>
      <div className="page-head">
        <h1>{sourceType === 'AN' ? 'Arrival Notice BL' : 'BL Waiting Confirm'}</h1>
        <p>{HEAD[tab]}</p>
      </div>

      <Tabs basePath={`/intake/${source}`} items={TABS} active={tab} />

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
