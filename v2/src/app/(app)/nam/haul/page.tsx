import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { readParams } from '@/lib/columns';
import { JobTable, Tabs } from '@/components/JobTable';
import { BulkBar } from '@/components/BulkBar';
import { haulColumns } from '@/components/HaulTable';
import { resendTtn, sendHaulPlan } from '@/lib/actions/haul-plan';
import { haulRiskOf } from '@/lib/haul-risk';
import { ttnConfigured } from '@/lib/ttn';
import { etaInPeriod, etaPeriodCounts, listJobs, QUEUE } from '@/lib/queries/jobs';
import { haulSummaries, sentJobsWithoutContainers } from '@/lib/queries/haul';
import { sheetRowClass } from '@/lib/register-sheet';
import { PeriodFilter } from '@/components/PeriodFilter';
import { periodParams, readPeriod } from '@/lib/eta-period';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'รอสั่งลาก' },
  { key: 'sent', label: 'สั่งลากแล้ว' },
];
const SEARCH_KEYS = [
  'person', 'jobType', 'shipper', 'blNo', 'container', 'vessel', 'voyage', 'refNo', 'entryNo', 'consignee', 'notify',
];

/**
 * NAMKANG — จัดการลากตู้สินค้า
 *
 * หน้าตาแบบทะเบียนงาน (แถวละงาน คอลัมน์ตามตารางเดิม) นำหน้าด้วยวันลากตู้และสถานะแพลน
 * รายการมาจากงานที่ PAINT กดส่ง Partner แล้วเท่านั้น (Upload ชุดปล่อย E-Office) · งาน MUO ไม่เข้า (Partner ลากเอง)
 * เลือกงาน ตั้งวันลาก แล้วกด "สั่งลาก" = ส่งแพลนให้ MAY + ส่งเข้า ERP TTN ให้ทีมจัดรถ (แพลนลงทุกตู้ของงาน)
 * แท็บสั่งลากแล้วเลือกงานแล้วตั้งวันใหม่ได้ = ส่งใหม่ทั้ง MAY (ต้องกดรับอีกครั้ง) และ TTN
 *
 * ข้อมูลประกอบที่ทีมลากตู้ใช้ตัดสินใจอยู่หน้าตาราง (Shipper · ตู้ · BL · สายเรือ · D/O · ท่า · ETA · DEM · DET)
 * แถบท่าเรือด้านบนบอกจำนวนตู้/BL ต่อท่าในแท็บนี้ — ดูว่าท่าไหนตู้เยอะ วางรถต่อท่า
 * เลือกวันลากแล้วแถบด้านล่างเตือนทันที: ลากวันศุกร์ · DET สั้น · คืนตู้ตรงวันหยุด · เกิน DEM · ยังไม่ได้ D/O
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

  const period = readPeriod(one('year'), one('month'));
  const baseCarry = { ...carry };
  Object.assign(carry, periodParams(period));

  const [{ rows, total }, noContainers, periods] = await Promise.all([
    listJobs({ where: () => [...QUEUE.haul(tab)(), etaInPeriod(period)], search, sortBy: sort, sortDir: dir }),
    tab === 'wait' ? sentJobsWithoutContainers() : Promise.resolve([]),
    etaPeriodCounts(QUEUE.haul(tab)),
  ]);
  const summaries = await haulSummaries(rows.map((r) => r.id));
  const risks = Object.fromEntries(rows.map((r) => [r.id, haulRiskOf(r)]));

  // ตู้ต่อท่าในแท็บนี้
  const byTerminal = new Map<string, { jobs: number; boxes: number }>();
  for (const r of rows) {
    const k = r.terminalName || 'ไม่ระบุท่า';
    const e = byTerminal.get(k) ?? { jobs: 0, boxes: 0 };
    e.jobs += 1; e.boxes += Number(r.containerCount) || 0;
    byTerminal.set(k, e);
  }
  const ttnFailed = tab === 'sent' ? [...summaries.values()].filter((s) => s.ttnError).length : 0;

  return (
    <>
      <div className="page-head">
        <h1>Transport Request</h1>
        <p>งานที่ส่ง Partner แล้ว · ติ๊กงาน → เลือกวันลาก → <b>สั่งลาก</b> (ส่งแพลนให้ MAY + เข้า ERP TTN ให้ทีมจัดรถ ทุกตู้ของงาน) · งาน MUO Partner ลากเอง ไม่อยู่ในหน้านี้</p>
      </div>
      {!ttnConfigured() ? (
        <div className="notice">ยังไม่ได้ตั้งค่าการเชื่อม ERP TTN — สั่งลากได้ (MAY ได้รับแพลน) แต่ข้อมูลยังไม่เข้า TTN</div>
      ) : null}
      {ttnFailed ? (
        <div className="notice">ส่งเข้า ERP TTN ไม่สำเร็จ {ttnFailed} งาน (ป้ายแดง &quot;TTN ส่งไม่สำเร็จ&quot;) — ติ๊กงานแล้วกด &quot;ส่ง TTN อีกครั้ง&quot;</div>
      ) : null}
      <Tabs basePath="/nam/haul" items={TABS} active={tab} carry={carry} />
      <PeriodFilter basePath="/nam/haul" carry={{ ...baseCarry, tab }} period={period} counts={periods} />

      {byTerminal.size ? (
        <div className="haul-terminals" aria-label="ตู้ต่อท่าเรือ">
          {[...byTerminal.entries()].sort((a, b) => b[1].boxes - a[1].boxes).map(([name, e]) => (
            <span key={name} className="haul-terminal"><b>{name}</b> {e.boxes} ตู้ · {e.jobs} BL</span>
          ))}
        </div>
      ) : null}
      <p className="haul-legend">
        D/O: <span className="badge rejected">ยังไม่แลก</span> <span className="badge pending">ส่งแลกแล้ว · รอ D/O</span> <span className="badge approved">ได้ D/O แล้ว</span>
        {' '}· DET <span className="badge rejected">≤ 3 วัน</span> = รีบคืนตู้ เลี่ยงลากวันศุกร์ · ETA &quot;ประมาณ&quot; = ระบบกรมยังไม่ยืนยัน เรืออาจเลื่อน
      </p>

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
        dateRisks={risks}
        label={tab === 'wait' ? '🚛 สั่งลาก {n} งาน' : 'เปลี่ยนวันลาก {n} งาน'}
        confirmText={tab === 'wait'
          ? 'สั่งลากตู้ {n} งาน (ทุกตู้ของงาน) วันที่ {date}\nส่งแพลนให้ MAY และส่งเข้า ERP TTN ใช่ไหม'
          : 'เปลี่ยนวันลากตู้ {n} งานเป็นวันที่ {date} แล้วส่งใหม่ให้ MAY และ ERP TTN ใช่ไหม\n\nMAY ต้องกดรับแพลนอีกครั้ง · ตู้ที่ TTN รับไปแล้วไม่เปลี่ยนวัน'}
        extra={tab === 'sent' ? {
          action: resendTtn,
          label: 'ส่ง TTN อีกครั้ง {n} งาน',
          confirmText: 'ส่งตู้ของ {n} งานเข้า ERP TTN อีกครั้ง (วันลากเดิม · อัปเดตข้อมูลประกอบ) ใช่ไหม',
        } : undefined}
      >
        <JobTable
          basePath="/nam/haul"
          columns={haulColumns(tab, summaries, true)}
          rows={rows}
          total={total}
          carry={{ ...carry, tab }}
          sortBy={sort}
          sortDir={dir}
          empty={tab === 'wait' ? 'ไม่มีงานรอสั่งลาก' : 'ยังไม่ได้สั่งลาก'}
          hint="ติ๊กหลายงานแล้วเลือกวันลากที่แถบด้านล่าง — แถบจะเตือนถ้าวันนั้นเสี่ยง (ศุกร์ · DET สั้น · เกิน DEM · ยังไม่ได้ D/O)"
          rowClass={sheetRowClass}
          tableClassName="sheet-table"
        />
      </BulkBar>
    </>
  );
}
