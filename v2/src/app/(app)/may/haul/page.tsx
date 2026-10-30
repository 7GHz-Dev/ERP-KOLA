import { requireUserReady } from '@/lib/auth';
import { Tabs } from '@/components/JobTable';
import { BulkBar } from '@/components/BulkBar';
import { HaulSearch, HaulTable } from '@/components/HaulTable';
import { ackHaulPlan } from '@/lib/actions/haul-plan';
import { listHaulRows } from '@/lib/queries/haul';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'new', label: 'แพลนใหม่' },
  { key: 'ack', label: 'รับแพลนแล้ว' },
];

/**
 * MAY — แพลนลากตู้ที่ NAMKANG ส่งมา จัดการแพลนฝั่ง Partner ต่อ (เชื่อม ERP SHIPME ภายหลัง)
 *
 * แพลนใหม่เรียงตามวันลากตู้ วันใกล้สุดอยู่บน · เลือกหลายตู้แล้วกดรับแพลนทีเดียว
 * NAMKANG เปลี่ยนวันหลังรับแล้ว แพลนกลับมาที่แท็บแพลนใหม่พร้อมวันใหม่
 */
export default async function MayHaulPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['MAY']);
  const params = await searchParams;
  const tab = params.tab === 'ack' ? 'ack' : 'new';
  const q = typeof params.q === 'string' ? params.q : '';
  const rows = await listHaulRows(tab, q);

  return (
    <>
      <div className="page-head">
        <h1>แพลนลากตู้</h1>
        <p>แพลนจาก NAMKANG · รับแพลนแล้วจัดการแพลนฝั่ง Partner ต่อ</p>
      </div>
      <Tabs basePath="/may/haul" items={TABS} active={tab} />
      <HaulSearch basePath="/may/haul" tab={tab} q={q} />
      {tab === 'new' ? (
        <BulkBar
          action={ackHaulPlan}
          idName="containerIds"
          label="รับแพลน {n} ตู้"
          confirmText="รับแพลนลากตู้ {n} ตู้ใช่ไหม"
        >
          <HaulTable rows={rows} view="new" pickable />
        </BulkBar>
      ) : (
        <HaulTable rows={rows} view="ack" pickable={false} />
      )}
    </>
  );
}
