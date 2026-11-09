import Link from 'next/link';
import { MONTHS_TH, monthLabel, periodCounts, recentBar, type EtaView, type PeriodCount } from '@/lib/eta-period';

/**
 * แถบ ETA ของ Bookings table — เปิดมาเห็น 12 เดือนล่าสุด แล้วกดทีละเดือนได้โดยไม่ต้องเลือกปีก่อน
 *
 * ปุ่มเดือนไล่จากเดือนนี้ย้อนไป 12 เดือน (ข้ามปีได้ในแถวเดียว) · "ทั้งหมด" ดูทุกงาน
 * งานที่เก่ากว่านั้นกดปุ่มปีก่อนหน้า แล้วเลือกเดือนของปีนั้นได้แบบแถบเดิม
 * หน้าลากตู้ยังใช้ PeriodFilter แบบเดิม (เลือกปี → เดือน)
 */
export function RecentPeriodFilter({
  basePath, carry, view, counts,
}: {
  basePath: string;
  /** ค่าอื่นใน URL ที่ต้องติดไปด้วย — ไม่รวม eta / year / month */
  carry: Record<string, string>;
  view: EtaView;
  counts: PeriodCount[];
}) {
  const bar = recentBar(counts);
  const href = (next: Record<string, string>) => {
    const params = new URLSearchParams(carry);
    for (const k of ['eta', 'year', 'month']) params.delete(k);
    for (const [k, v] of Object.entries(next)) params.set(k, v);
    const q = params.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const selected = view.kind === 'period' ? view.period : null;
  const isMonth = (y: number, m: number) => selected?.year === y && selected.month === m;
  // ปีที่เลือกอยู่นอกช่วง 12 เดือน — แสดงปุ่มเดือนของปีนั้นแถวที่สอง
  const olderYear = selected && bar.olderYears.some((o) => o.year === selected.year) ? selected.year : null;
  const olderMonths = olderYear ? periodCounts(counts, olderYear).months : null;

  return (
    <div className="period-bar recent-bar">
      <span className="filter-label">ETA</span>
      <Link href={href({})} aria-current={view.kind === 'recent' ? 'page' : undefined} className="recent-all">
        12 เดือนล่าสุด <small>{bar.recentTotal}</small>
      </Link>
      {bar.months.map((m) => (m.count || isMonth(m.year, m.month) ? (
        <Link key={`${m.year}-${m.month}`} href={href({ year: String(m.year), month: String(m.month) })}
          aria-current={isMonth(m.year, m.month) ? 'page' : undefined}>
          {monthLabel(m)} <small>{m.count}</small>
        </Link>
      ) : (
        <span key={`${m.year}-${m.month}`} className="period-empty" title="ไม่มีงานในเดือนนี้">{monthLabel(m)}</span>
      )))}
      <Link href={href({ eta: 'all' })} aria-current={view.kind === 'all' ? 'page' : undefined}>
        ทั้งหมด <small>{bar.allTotal}</small>
      </Link>
      {bar.olderYears.length ? (
        <>
          <span className="filter-label period-month-label">ปีก่อนหน้า</span>
          {bar.olderYears.map((o) => (
            <Link key={o.year} href={href({ year: String(o.year) })}
              aria-current={selected?.year === o.year && !selected.month ? 'page' : undefined}
              className={olderYear === o.year ? 'in-year' : undefined}>
              {o.year + 543} <small>{o.count}</small>
            </Link>
          ))}
        </>
      ) : null}
      {olderYear && olderMonths ? (
        <span className="recent-older">
          <span className="filter-label">เดือนของปี {olderYear + 543}</span>
          {MONTHS_TH.map((label, i) => {
            const count = olderMonths.get(i + 1) ?? 0;
            return count || isMonth(olderYear, i + 1) ? (
              <Link key={label} href={href({ year: String(olderYear), month: String(i + 1) })}
                aria-current={isMonth(olderYear, i + 1) ? 'page' : undefined}>
                {label} <small>{count}</small>
              </Link>
            ) : <span key={label} className="period-empty">{label}</span>;
          })}
        </span>
      ) : null}
    </div>
  );
}
