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
 * ANN — Plan แลก DO ที่ FAH ส่งมาเป็นชุด
 *
 * หน้า "จัดการแลก DO" เดิมยังเป็นที่ทำงานจริงทั้งหมด หน้านี้ไม่ได้มาแทน
 * แต่ตอบคำถามที่หน้าเดิมตอบไม่ได้ คือ "ชุดของวันนี้ครบหรือยัง"
 * เพราะหน้าเดิมเป็นกองงานเรียงตามเวลาที่เข้ามา ไม่มีขอบของชุดให้เห็น
 */
export default async function AnnPlanPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ANN']);
  const params = await searchParams;
  const raw = params.tab;
  const tab = TABS.some((t) => t.key === raw) ? String(raw) : 'open';

  const plans = await listDoPlans({ track: 'exchange', openOnly: tab === 'open' });

  return (
    <>
      <div className="page-head">
        <h1>Plan แลก DO</h1>
        <p>
          ชุดงานที่ FAH นัดไว้ว่าจะไปแลกวันไหน · ไล่ทำให้ครบทั้งชุด ·
          กด &quot;ส่งแลก DO แล้ว&quot; ที่หน้าจัดการแลก DO แล้วตัวเลขที่นี่จะขยับเอง
        </p>
      </div>
      <Tabs basePath="/do-exchange/plan" items={TABS} active={tab} carry={{}} />
      <PlanBoard
        plans={plans}
        track="exchange"
        emptyText={tab === 'open' ? 'ไม่มี Plan ที่ยังทำไม่ครบ' : 'ยังไม่มี Plan ที่ทำครบแล้ว'}
      />
    </>
  );
}
