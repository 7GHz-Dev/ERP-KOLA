import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { IntakeForm } from '@/components/IntakeForm';
import { createJobFromIntake, intakeDefaults } from '@/lib/actions/intake';
import { intakeOptions, settingValue } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

export default async function IntakePage({
  params,
}: { params: Promise<{ source: string }> }) {
  await requireUser(['PAINT']);
  const { source } = await params;
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
        <p>อัปโหลด PDF → ระบบอ่านข้อมูลและเติมฟอร์ม → ตรวจสอบ → บันทึก</p>
      </div>

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
    </>
  );
}
