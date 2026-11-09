import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { Tabs } from '@/components/JobTable';
import { formatDateTime } from '@/lib/format';
import { chargeCounts, listCharges } from '@/lib/sale/charge-store';
import { CHARGE_STATUS, type ChargeStatus } from '@/lib/sale/charges';
import { isMissingTable } from '@/lib/sale/price-store';
import { baht } from '@/lib/sale/pricing';

export const dynamic = 'force-dynamic';

const TABS: Array<{ key: string; label: string; statuses: ChargeStatus[] | null }> = [
  { key: 'todo', label: 'ต้องเจรจา', statuses: ['NEW', 'RETURNED'] },
  { key: 'doing', label: 'กำลังเจรจา', statuses: ['NEGOTIATING'] },
  { key: 'review', label: 'รอ Supervisor ตรวจ', statuses: ['SUBMITTED'] },
  { key: 'done', label: 'อนุมัติแล้ว', statuses: ['APPROVED'] },
  { key: 'all', label: 'ทั้งหมด', statuses: null },
];
const TONE: Record<string, string> = { NEW: 'pending', NEGOTIATING: 'neutral', SUBMITTED: 'pending', APPROVED: 'approved', RETURNED: 'rejected' };

/**
 * ค่าใช้จ่ายพิเศษจาก SHIPME — ชุดที่แผนกบัญชี SHIPME ส่งมา (รายการ + รูปแนบ)
 * Sale เจรจา บันทึกยอดที่ตกลงพร้อมหลักฐาน → SALE SUPERVISOR ตรวจ · ทุกขั้นบันทึกไว้ตั้งแต่ต้น
 */
export default async function SaleChargesPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUserReady(['SALE', 'SALE_SUPERVISOR']);
  const params = await searchParams;
  const want = typeof params.tab === 'string' ? params.tab : '';
  // Supervisor เปิดมาเจอรายการที่รอตัวเองตรวจก่อน
  const tab = TABS.find((t) => t.key === want) ?? TABS.find((t) => t.key === (user.role === 'SALE_SUPERVISOR' ? 'review' : 'todo'))!;

  let rows: Awaited<ReturnType<typeof listCharges>>;
  let counts: Record<string, number>;
  try {
    [rows, counts] = await Promise.all([listCharges(tab.statuses), chargeCounts()]);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    return (
      <>
        <div className="page-head"><h1>ค่าใช้จ่ายพิเศษ SHIPME</h1></div>
        <p className="notice">ยังไม่ได้สร้างตารางของงาน Sale — ผู้ดูแลระบบต้องรัน <code>npm run migrate:sale</code> ก่อน</p>
      </>
    );
  }
  const countOf = (t: (typeof TABS)[number]) => (t.statuses ? t.statuses.reduce((s, st) => s + (counts[st] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0));

  return (
    <>
      <div className="page-head">
        <h1>ค่าใช้จ่ายพิเศษ SHIPME</h1>
        <p>รายการที่ ERP SHIPME ส่งมาเมื่อแผนกบัญชีจัดชุดใบแจ้งหนี้ของ BL · เจรจา → บันทึกยอดที่ตกลง + แนบหลักฐาน → ส่งให้ Supervisor ตรวจ</p>
      </div>
      <Tabs basePath="/sale/charges" items={TABS.map((t) => ({ key: t.key, label: t.label, count: countOf(t) || undefined }))} active={tab.key} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-no">No.</th><th>รับเมื่อ</th><th>BL</th><th>งาน</th><th>ชุดใบแจ้งหนี้ (SHIPME)</th>
              <th className="num">รายการ</th><th className="num">ยอดที่ขอ</th><th className="num">ยอดที่ตกลง</th><th>สถานะ</th><th>Sale</th><th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty" colSpan={11}>ไม่มีรายการ</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.id}>
                <td className="col-no">{i + 1}</td>
                <td>{formatDateTime(r.receivedAt)}</td>
                <td><b>{r.blNo}</b></td>
                <td>{r.jobId ? <Link className="cell-link" href={`/job/${r.jobId}`}>{r.jobNo}</Link> : <span className="badge pending">ยังไม่พบงาน</span>}</td>
                <td>{r.invoiceNo ?? r.batchId}</td>
                <td className="num">{r.items}{r.files ? ` · 📎${r.files}` : ''}</td>
                <td className="num">{baht(r.requestedTotal)} <small className="muted">{r.currency}</small></td>
                <td className="num">{r.agreedTotal === null ? '-' : baht(r.agreedTotal)}</td>
                <td><span className={`badge ${TONE[r.status] ?? 'neutral'}`}>{CHARGE_STATUS[r.status as ChargeStatus] ?? r.status}</span></td>
                <td>{r.saleName ?? '-'}</td>
                <td className="col-actions"><Link className="button tiny primary" href={`/sale/charges/${r.id}`}>เปิด</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
