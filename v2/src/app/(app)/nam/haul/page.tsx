import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { Tabs } from '@/components/JobTable';
import { BulkBar } from '@/components/BulkBar';
import { HaulSearch, HaulTable } from '@/components/HaulTable';
import { sendHaulPlan } from '@/lib/actions/haul-plan';
import { listHaulRows, sentJobsWithoutContainers } from '@/lib/queries/haul';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'รอวางแพลน' },
  { key: 'sent', label: 'ส่งแพลนแล้ว' },
];

/**
 * NAMKANG — จัดการลากตู้สินค้า
 *
 * รายการมาจากงานที่ PAINT กดส่ง Partner แล้วเท่านั้น (Upload ชุดปล่อย E-Office)
 * เลือกตู้ ตั้งวันลาก แล้วส่งแพลนให้ MAY จัดการแพลนฝั่ง Partner (เชื่อม ERP SHIPME ต่อไป)
 * แท็บส่งแพลนแล้วเลือกตู้แล้วตั้งวันใหม่ได้ = ส่งแพลนใหม่ MAY ต้องกดรับอีกครั้ง
 */
export default async function NamHaulPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['NAMKANG']);
  const params = await searchParams;
  const tab = params.tab === 'sent' ? 'sent' : 'wait';
  const q = typeof params.q === 'string' ? params.q : '';

  const [rows, noContainers] = await Promise.all([
    listHaulRows(tab, q),
    tab === 'wait' ? sentJobsWithoutContainers() : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>จัดการลากตู้สินค้า</h1>
        <p>งานที่ส่ง Partner แล้ว · เลือกตู้ → ตั้งวันลากตู้ → ส่งแพลนให้ MAY</p>
      </div>
      <Tabs basePath="/nam/haul" items={TABS} active={tab} />
      <HaulSearch basePath="/nam/haul" tab={tab} q={q} />

      {noContainers.length ? (
        <div className="notice">
          งานที่ส่ง Partner แล้วแต่ยังไม่มีรายการตู้ — เพิ่มตู้ในข้อมูลงานก่อนจึงวางแพลนได้:{' '}
          {noContainers.map((j, i) => (
            <span key={j.id}>{i ? ' · ' : ''}<Link href={`/job/${j.id}`}>{j.blNo || j.jobNo}</Link></span>
          ))}
        </div>
      ) : null}

      <BulkBar
        action={sendHaulPlan}
        idName="containerIds"
        dateField={{ name: 'haulDate', label: 'วันลากตู้' }}
        label={tab === 'wait' ? 'ส่งแพลนให้ MAY {n} ตู้' : 'เปลี่ยนวันลาก {n} ตู้'}
        confirmText={tab === 'wait'
          ? 'ส่งแพลนลากตู้ {n} ตู้ วันที่ {date} ให้ MAY ใช่ไหม'
          : 'เปลี่ยนวันลากตู้ {n} ตู้เป็นวันที่ {date} แล้วส่งแพลนใหม่ให้ MAY ใช่ไหม\n\nMAY ต้องกดรับแพลนอีกครั้ง'}
      >
        <HaulTable rows={rows} view={tab} pickable />
      </BulkBar>
    </>
  );
}
