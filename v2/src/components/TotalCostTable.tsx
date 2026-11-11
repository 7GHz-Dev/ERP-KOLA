import Link from 'next/link';
import { Fragment } from 'react';
import { formatDateTime } from '@/lib/format';
import { COST_CATEGORIES, sumSummaries, type CostCategory, type CostInvoiceRef, type CostSummary } from '@/lib/total-cost/cost';

export type TotalCostRow = {
  id: string; blNo: string; jobId: string | null; jobNo: string | null; customer: string | null;
  batchName: string | null; invoices: CostInvoiceRef[]; updatedAt: Date; summary: CostSummary;
};
type Sums = Pick<CostSummary, 'amounts' | 'whtBy' | 'subtotal' | 'vat' | 'total' | 'wht' | 'net'>;

const money = (n: number) => (n ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');

// DO รวมเป็นกลุ่มเดียว (VAT / WHT / No VAT) · หมวดที่หัก ณ ที่จ่ายได้มีคอลัมน์ WHT 3% ต่อท้าย
const COLS = COST_CATEGORIES.filter((c) => c.key !== 'DO_VAT' && c.key !== 'DO_NOVAT');

function Cells({ s }: { s: Sums }) {
  const amt = (k: CostCategory) => <td className="num">{money(s.amounts[k])}</td>;
  return (
    <>
      {amt('DO_VAT')}
      <td className="num tc-wht">{money(s.whtBy.DO_VAT)}</td>
      {amt('DO_NOVAT')}
      {COLS.map((c) => (
        <Fragment key={c.key}>
          {amt(c.key)}
          {c.wht ? <td className="num tc-wht">{money(s.whtBy[c.key])}</td> : null}
        </Fragment>
      ))}
      <td className="num tc-sum">{money(s.subtotal)}</td>
      <td className="num tc-sum">{money(s.vat)}</td>
      <td className="num tc-sum">{money(s.total)}</td>
      <td className="num tc-sum tc-wht">{money(s.wht)}</td>
      <td className="num tc-sum"><b>{money(s.net)}</b></td>
    </>
  );
}

/** ตาราง Total cost — BL ละแถว หัวตาราง 2 ชั้น + แถวรวมท้ายตาราง */
export function TotalCostTable({ rows, emptyText }: { rows: TotalCostRow[]; emptyText: string }) {
  const sum = sumSummaries(rows.map((r) => r.summary));
  return (
    <div className="table-wrap">
      <table className="data tc-table">
        <thead>
          <tr>
            <th rowSpan={2} className="col-no">No.</th>
            <th rowSpan={2} className="tc-sticky">BL</th>
            <th rowSpan={2}>งาน</th>
            <th rowSpan={2}>ลูกค้า</th>
            <th rowSpan={2}>ชุด / ใบแจ้งหนี้ ADV</th>
            <th colSpan={3} className="tc-group">DO</th>
            {COLS.map((c) => (
              <th key={c.key} colSpan={c.wht ? 2 : 1} rowSpan={c.wht ? 1 : 2} className={c.wht ? 'tc-group' : 'num'}>{c.label}</th>
            ))}
            <th rowSpan={2} className="num">รวมก่อน VAT</th>
            <th rowSpan={2} className="num">VAT 7%</th>
            <th rowSpan={2} className="num">รวม</th>
            <th rowSpan={2} className="num">หัก ณ ที่จ่าย 3%</th>
            <th rowSpan={2} className="num">ยอดสุทธิ</th>
            <th rowSpan={2}>รับล่าสุด</th>
          </tr>
          <tr>
            <th className="num">VAT</th><th className="num">WHT 3%</th><th className="num">No VAT</th>
            {COLS.filter((c) => c.wht).map((c) => (
              <Fragment key={c.key}><th className="num">ยอด</th><th className="num">WHT 3%</th></Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="empty" colSpan={40}>{emptyText}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id}>
              <td className="col-no">{i + 1}</td>
              <td className="tc-sticky"><Link className="cell-link" href={`/account/total-cost/${r.id}`}><b>{r.blNo}</b></Link></td>
              <td>{r.jobId ? <Link className="cell-link" href={`/job/${r.jobId}`}>{r.jobNo}</Link> : <span className="badge pending">ยังไม่พบงาน</span>}</td>
              <td>{r.customer ?? '-'}</td>
              <td>
                {r.batchName ?? '-'}
                {r.invoices.length ? <div className="muted small">{r.invoices.map((v) => v.number).join(', ')}</div> : null}
              </td>
              <Cells s={r.summary} />
              <td className="muted">
                {formatDateTime(r.updatedAt)}
                {r.summary.sale && !r.summary.sale.approved ? (
                  <div><span className="badge pending" title="ยอดพิเศษยังไม่อนุมัติ ใช้ยอดที่ SHIPME ขอไปก่อน">พิเศษ: {r.summary.sale.status}</span></div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 ? (
          <tfoot>
            <tr>
              <td colSpan={5}><b>รวม {rows.length} BL</b></td>
              <Cells s={sum} />
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
