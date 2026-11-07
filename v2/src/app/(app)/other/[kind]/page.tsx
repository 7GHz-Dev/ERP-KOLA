import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { PendingView } from '@/components/PendingView';
import { OTHER_KINDS, type OtherKind } from '@/lib/other-cargo';

export const dynamic = 'force-dynamic';

/**
 * Other job (Head Officer) — Other cargo, import decl. (MSFZ = MO / Transit = TO)
 *
 * Head Officer ทำเองทั้งเส้นในหน้าเดียว: รับ AN หรือ BL → ยืนยัน BL → Final Invoice → Draft + เลขใบขน
 * → เตรียมเอกสารเดิน E → Submit (Signed) E-office ส่ง Partner
 * ไม่ต้องมีใครอนุมัติ และงานกลุ่มนี้ไม่ไปโผล่ในคิวของ Import Officer / Senior Officer
 */
export default async function OtherCargoPage({
  params, searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['NAMKANG']);
  const { kind } = await params;
  if (!(kind in OTHER_KINDS)) notFound();
  const def = OTHER_KINDS[kind as OtherKind];

  return (
    <PendingView
      mode={def.code}
      basePath={`/other/${kind}`}
      title={def.label}
      subtitle={`งาน Job Type ${def.code} — ทำเองทั้งเส้น ไม่ต้องรออนุมัติ · BL → Final Invoice → Draft + เลขใบขน → เตรียมเอกสารเดิน E → Submit (Signed) E-office`}
      searchParams={await searchParams}
      actions={(
        <>
          <Link className="button primary" href={`/intake/an?jobType=${def.code}`}>+ เพิ่ม Job จาก Arrival Notice</Link>
          <Link className="button" href={`/intake/bl?jobType=${def.code}`}>+ จาก BL</Link>
        </>
      )}
    />
  );
}
