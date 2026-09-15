import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { IntakeForm } from '@/components/IntakeForm';
import { IntakeBatch } from '@/components/IntakeBatch';
import { Tabs } from '@/components/JobTable';
import { createJobFromIntake, intakeDefaults } from '@/lib/actions/intake';
import { intakeOptions, settingValue } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'one', label: 'ทีละใบ' },
  { key: 'batch', label: 'หลายใบพร้อมกัน' },
];

export default async function IntakePage({
  params, searchParams,
}: {
  params: Promise<{ source: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['PAINT']);
  const { source } = await params;
  const tabParam = (await searchParams).tab;
  const tab = tabParam === 'batch' ? 'batch' : 'one';
  if (source !== 'an' && source !== 'bl') notFound();
  const sourceType = source === 'an' ? 'AN' : 'BL';

  const [options, ids, demDays, detDays] = await Promise.all([
    intakeOptions(),
    intakeDefaults(),
    settingValue('DEM_FREE_DAYS', '5'),
    settingValue('DET_FREE_DAYS', '3'),
  ]);

  const pick = (list: { code: string | null; name: string }[], code: string) =>
    list.find((o) => o.code?.toUpperCase() === code)?.name ?? list[0]?.name ?? '';

  return (
    <>
      <div className="page-head">
        <h1>{sourceType === 'AN' ? 'Arrival Notice BL' : 'BL Waiting Confirm'}</h1>
        <p>
          {tab === 'batch'
            ? 'เลือก PDF หลายไฟล์ → ระบบอ่านให้ทุกใบ → ตรวจในตาราง → บันทึกทีเดียว'
            : 'อัปโหลด PDF → ระบบอ่านข้อมูลและเติมฟอร์ม → ตรวจสอบ → บันทึก'}
        </p>
      </div>

      <Tabs basePath={`/intake/${source}`} items={TABS} active={tab} />

      {tab === 'batch' ? (
        <IntakeBatch
          sourceType={sourceType}
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
