import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { COST_CATEGORIES, categoryLabel } from '@/lib/total-cost/cost';
import { getTotalCost } from '@/lib/total-cost/store';

export const dynamic = 'force-dynamic';

const money = (n: number) => (n ? n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');
const SOURCE: Record<string, string> = { INVOICE: 'ใบแจ้งหนี้ ADV', SETTLEMENT: 'ใบปิดบัญชีชิปปิ้ง', TRANSPORT: 'ชีตงานขนส่ง' };

/** Total cost ของ BL เดียว — สรุปต่อหมวด + รายการละเอียดทุกบรรทัดที่ SHIPME ส่งมา (รวมบรรทัดที่ไม่นับพร้อมเหตุผล) */
export default async function TotalCostDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['ACCOUNT']);
  const { id } = await params;
  const data = await getTotalCost(id);
  if (!data) notFound();
  const s = data.summary;
  const used = COST_CATEGORIES.filter((c) => s.amounts[c.key] || s.whtBy[c.key]);

  return (
    <>
      <div className="page-head">
        <p><Link href="/account/total-cost">← Total cost</Link></p>
        <h1>Total cost · {data.blNo}</h1>
        <p>
          {data.jobId ? <>งาน <Link className="cell-link" href={`/job/${data.jobId}`}>{data.jobNo}</Link> · </> : <><span className="badge pending">ยังไม่พบงานใน ERP KOLA</span> · </>}
          {data.customer ? `${data.customer} · ` : ''}
          {data.batchName ? `${data.batchName} · ` : ''}
          รับล่าสุด {formatDateTime(data.updatedAt)}
        </p>
        {data.invoices.length ? (
          <p className="muted">ใบแจ้งหนี้ ADV: {data.invoices.map((v) => `${v.number}${v.issueDate ? ` (${formatDate(v.issueDate)})` : ''}`).join(' · ')}</p>
        ) : null}
      </div>

      <div className="tc-cards">
        <div className="tc-card"><span>รวมก่อน VAT</span><b>{money(s.subtotal)}</b></div>
        <div className="tc-card"><span>VAT 7%</span><b>{money(s.vat)}</b></div>
        <div className="tc-card"><span>รวม</span><b>{money(s.total)}</b></div>
        <div className="tc-card"><span>หัก ณ ที่จ่าย 3%</span><b>{money(s.wht)}</b></div>
        <div className="tc-card main"><span>ยอดสุทธิ</span><b>{money(s.net)}</b></div>
      </div>

      <h2 className="tc-h2">สรุปต่อหมวด</h2>
      <div className="table-wrap">
        <table className="data tc-table" style={{ minWidth: 0 }}>
          <thead><tr><th>หมวด</th><th className="num">ยอด (ก่อน VAT)</th><th className="num">หัก ณ ที่จ่าย 3%</th></tr></thead>
          <tbody>
            {used.length === 0 ? <tr><td className="empty" colSpan={3}>ไม่มียอด</td></tr> : used.map((c) => (
              <tr key={c.key}>
                <td style={{ textAlign: 'left', color: 'inherit' }}>{c.label}</td>
                <td className="num">{money(s.amounts[c.key])}</td>
                <td className="num">{c.wht ? money(s.whtBy[c.key]) : <span className="muted">ไม่หัก</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.sale ? (
        <p className="hint">
          ค่าใช้จ่ายพิเศษ (ยางเกิน / สำแดงเท็จ) {money(s.sale.amount)} บาท จาก Sale ({s.sale.items} รายการ) ·{' '}
          <span className={`badge ${s.sale.approved ? 'approved' : 'pending'}`}>{s.sale.status}</span>
          {s.sale.approved ? ' ใช้ยอดที่ตกลง' : ' ยังไม่อนุมัติ — ใช้ยอดที่ SHIPME ขอไปก่อน'}
        </p>
      ) : null}

      <h2 className="tc-h2">รายการละเอียดจาก ERP SHIPME</h2>
      <div className="table-wrap">
        <table className="data tc-table">
          <thead>
            <tr>
              <th className="col-no">No.</th><th>ที่มา</th><th>อ้างอิง</th><th>รายการ</th><th>หมวด</th>
              <th className="num">ยอดก่อน VAT</th><th className="num">VAT</th><th className="num">WHT 3%</th><th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.length === 0 ? <tr><td className="empty" colSpan={9}>ไม่มีรายการ</td></tr> : s.lines.map((l, i) => (
              <tr key={i} className={l.skipped ? 'tc-skipped' : undefined}>
                <td className="col-no">{i + 1}</td>
                <td>{SOURCE[l.source] ?? l.source}</td>
                <td>{[l.ref, l.kind].filter(Boolean).join(' · ') || '-'}</td>
                <td>{l.label}</td>
                <td>{l.category === 'SALE_SPECIAL' ? 'ค่าใช้จ่ายพิเศษ' : categoryLabel(l.category)}</td>
                <td className="num">{money(l.amount)}</td>
                <td className="num">{money(l.vat)}</td>
                <td className="num">{money(l.wht)}</td>
                <td className="tc-note">{l.skipped ? <span className="badge neutral">ไม่นับ: {l.skipped}</span> : null} {l.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
