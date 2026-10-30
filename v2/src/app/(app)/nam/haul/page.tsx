import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { readParams } from '@/lib/columns';
import { JobTable, Tabs } from '@/components/JobTable';
import { BulkBar } from '@/components/BulkBar';
import { haulColumns } from '@/components/HaulTable';
import { sendHaulPlan } from '@/lib/actions/haul-plan';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { haulSummaries, sentJobsWithoutContainers } from '@/lib/queries/haul';
import { sheetRowClass } from '@/lib/register-sheet';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'รอวางแพลน' },
  { key: 'sent', label: 'ส่งแพลนแล้ว' },
];
const SEARCH_KEYS = [
  'person', 'jobType', 'shipper', 'blNo', 'container', 'vessel', 'refNo', 'entryNo', 'consignee', 'notify',
];

/**
 * NAMKANG — จัดการลากตู้สินค้า
 *
 * หน้าตาแบบทะเบียนงาน (แถวละงาน คอลัมน์ตามตารางเดิม) นำหน้าด้วยวันลากตู้และสถานะแพลน
 * รายการมาจากงานที่ PAINT กดส่ง Partner แล้วเท่านั้น (Upload ชุดปล่อย E-Office) · งาน MUO ไม่เข้า (Partner ลากเอง)
 * เลือกงาน ตั้งวันลาก แล้วส่งแพลนให้ MAY (แพลนลงทุกตู้ของงาน) — เชื่อม ERP SHIPME ต่อไป
 * แท็บส่งแพลนแล้วเลือกงานแล้วตั้งวันใหม่ได้ = ส่งแพลนใหม่ MAY ต้องกดรับอีกครั้ง
 */
export default async function NamHaulPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['NAMKANG']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = one('tab') === 'sent' ? 'sent' : 'wait';
  // ค้างนานสุด (ETA เก่าสุด) อยู่บน เหมือนลำดับที่ต้องลากออกก่อน
  const sort = sortBy ?? 'eta';
  const dir = sortBy ? sortDir : 'asc';

  const [{ rows, total }, noContainers] = await Promise.all([
    listJobs({ where: QUEUE.haul(tab), search, sortBy: sort, sortDir: dir }),
    tab === 'wait' ? sentJobsWithoutContainers() : Promise.resolve([]),
  ]);
  const summaries = await haulSummaries(rows.map((r) => r.id));

  return (
    <>
      <div className="page-head">
        <h1>จัดการลากตู้สินค้า</h1>
        <p>งานที่ส่ง Partner แล้ว · เลือกงาน → ตั้งวันลากตู้ → ส่งแพลนให้ MAY (ลงทุกตู้ของงาน) · งาน MUO Partner ลากเอง ไม่อยู่ในหน้านี้</p>
      </div>
      <Tabs basePath="/nam/haul" items={TABS} active={tab} carry={carry} />

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
        idName="jobIds"
        dateField={{ name: 'haulDate', label: 'วันลากตู้' }}
        label={tab === 'wait' ? 'ส่งแพลนให้ MAY {n} งาน' : 'เปลี่ยนวันลาก {n} งาน'}
        confirmText={tab === 'wait'
          ? 'ส่งแพลนลากตู้ {n} งาน (ทุกตู้ของงาน) วันที่ {date} ให้ MAY ใช่ไหม'
          : 'เปลี่ยนวันลากตู้ {n} งานเป็นวันที่ {date} แล้วส่งแพลนใหม่ให้ MAY ใช่ไหม\n\nMAY ต้องกดรับแพลนอีกครั้ง'}
      >
        <JobTable
          basePath="/nam/haul"
          columns={haulColumns(tab, summaries, true)}
          rows={rows}
          total={total}
          carry={{ ...carry, tab }}
          sortBy={sort}
          sortDir={dir}
          empty={tab === 'wait' ? 'ไม่มีงานรอวางแพลน' : 'ยังไม่ได้ส่งแพลน'}
          hint="ติ๊กหลายงานแล้วตั้งวันลากตู้ที่แถบด้านล่าง"
          rowClass={sheetRowClass}
        />
      </BulkBar>
    </>
  );
}
