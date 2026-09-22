import { requireUserReady } from '@/lib/auth';
import { Tabs } from '@/components/JobTable';
import { PlanBoard } from '@/components/PlanBoard';
import { listDoPlans } from '@/lib/queries/do-plans';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'open', label: 'ยังทำไม่ครบ' },
  { key: 'done', label: 'ครบแล้ว' },
];

/**
 * MAY — Plan ชุดเดียวกับของ ANN แต่ความคืบหน้านับจากการตั้งเบิก
 *
 * MAY ต้องเบิกเงินให้ครบทั้งชุดก่อนวันไปแลก ใบที่ตกหล่นแปลว่าวันนั้นไปแลกไม่ได้
 * หน้านี้จึงเป็นตัวเช็กก่อนถึงวันนัด ไม่ใช่รายงานย้อนหลัง
 */
export default async function MayPlanPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['MAY']);
  const params = await searchParams;
  const raw = params.tab;
  const tab = TABS.some((t) => t.key === raw) ? String(raw) : 'open';

  const plans = await listDoPlans({ track: 'claim', openOnly: tab === 'open' });

  return (
    <>
      <div className="page-head">
        <h1>Plan แลก DO</h1>
        <p>
          ชุดงานที่ FAH นัดไว้ว่าจะไปแลกวันไหน · กรอกยอดและตั้งเบิกให้ครบทั้งชุดก่อนถึงวันนัด ·
          กดตั้งเบิกที่หน้ายอดชำระแล้วตัวเลขที่นี่จะขยับเอง
        </p>
      </div>
      <Tabs basePath="/may/plan" items={TABS} active={tab} carry={{}} />
      <PlanBoard
        plans={plans}
        track="claim"
        emptyText={tab === 'open' ? 'ไม่มี Plan ที่ยังทำไม่ครบ' : 'ยังไม่มี Plan ที่ทำครบแล้ว'}
      />
    </>
  );
}
