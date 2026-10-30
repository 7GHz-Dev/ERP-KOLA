import Link from 'next/link';
import { MONTHS_TH, periodCounts, type Period, type PeriodCount } from '@/lib/eta-period';

/**
 * ปุ่มเลือกแสดงตามปี / เดือนของ ETA — ลิงก์ล้วน ไม่ต้องมี JavaScript
 *
 * กดปีแล้วปุ่มเดือนของปีนั้นจึงโผล่ (มีตัวเลขบอกว่าเดือนไหนมีกี่งาน เดือนที่ไม่มีงานกดไม่ได้)
 * ค่าที่ติดอยู่กับหน้า (แท็บ · คำค้น · การเรียง) ถูกส่งต่อไปทุกลิงก์ เปลี่ยนปีแล้วไม่หลุดแท็บ
 */
export function PeriodFilter({
  basePath, carry, period, counts,
}: {
  basePath: string;
  /** ค่าอื่นใน URL ที่ต้องติดไปด้วย — ไม่รวม year / month */
  carry: Record<string, string>;
  period: Period;
  counts: PeriodCount[];
}) {
  const { years, months } = periodCounts(counts, period.year);
  const href = (year: number | null, month: number | null) => {
    const params = new URLSearchParams(carry);
    params.delete('year');
    params.delete('month');
    if (year) params.set('year', String(year));
    if (year && month) params.set('month', String(month));
    const q = params.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const yearTotal = years.reduce((sum, y) => sum + y.count, 0);

  return (
    <div className="period-bar">
      <span className="filter-label">ETA ปี</span>
      <Link href={href(null, null)} aria-current={period.year ? undefined : 'page'}>ทั้งหมด</Link>
      {years.map((y) => (
        <Link key={y.year} href={href(y.year, null)}
          aria-current={period.year === y.year && !period.month ? 'page' : undefined}
          className={period.year === y.year ? 'in-year' : undefined}>
          {y.year} <small>{y.count}</small>
        </Link>
      ))}
      {period.year && !years.some((y) => y.year === period.year) ? (
        <Link href={href(period.year, null)} aria-current="page">{period.year} <small>0</small></Link>
      ) : null}
      {period.year ? (
        <>
          <span className="filter-label period-month-label">เดือน</span>
          {MONTHS_TH.map((label, i) => {
            const m = i + 1;
            const count = months.get(m) ?? 0;
            return count || period.month === m ? (
              <Link key={m} href={href(period.year, m)} aria-current={period.month === m ? 'page' : undefined}>
                {label} <small>{count}</small>
              </Link>
            ) : (
              <span key={m} className="period-empty" title="ไม่มีงานในเดือนนี้">{label}</span>
            );
          })}
        </>
      ) : (
        <small className="period-hint">{yearTotal ? 'กดปีเพื่อเลือกเดือน' : 'ยังไม่มีงานที่ใส่ ETA'}</small>
      )}
    </div>
  );
}
