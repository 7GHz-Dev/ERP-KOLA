import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { isMissingTable } from '@/lib/sale/price-store';
import { TotalCostTable } from '@/components/TotalCostTable';
import { listTotalCosts } from '@/lib/total-cost/store';

export const dynamic = 'force-dynamic';

/**
 * Total cost (ACCOUNT) — ค่าใช้จ่ายรวมราย BL ที่ ERP SHIPME ส่งมาตอนแผนกบัญชี SHIPME จัดชุดใบแจ้งหนี้ ADV
 *
 * ข้อมูลมาละเอียดทีละบรรทัด (ใบแจ้งหนี้ ADV + ใบปิดบัญชีชิปปิ้ง) แต่หน้านี้รวมเป็น BL ละแถว
 * หมวดที่มี VAT แยกหัก ณ ที่จ่าย 3% (คิดทีละบรรทัดจากยอดก่อน VAT) · กดเลข BL ดูรายการละเอียด
 * ค่าใช้จ่ายพิเศษ (ยางเกิน / สำแดงเท็จ) ใช้ยอดที่ Sale เจรจา
 */
export default async function TotalCostPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ACCOUNT']);
  const raw = (await searchParams).q;
  const q = typeof raw === 'string' ? raw.trim() : '';

  let rows: Awaited<ReturnType<typeof listTotalCosts>>;
  try {
    rows = await listTotalCosts(q);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    return (
      <>
        <div className="page-head"><h1>Total cost</h1></div>
        <p className="notice">ยังไม่ได้สร้างตารางของ Total cost — ผู้ดูแลระบบต้องรัน <code>npm run migrate:total-cost</code> ก่อน</p>
      </>
    );
  }
  return (
    <>
      <div className="page-head">
        <h1>Total cost</h1>
        <p>
          ค่าใช้จ่ายราย BL จาก ERP SHIPME — ส่งมาเองเมื่อแผนกบัญชี SHIPME จัดชุดใบแจ้งหนี้ ADV ·
          ยอดก่อน VAT · หัก ณ ที่จ่าย 3% คิดทีละรายการเฉพาะยอดที่มี VAT · กดเลข BL ดูรายการละเอียด
        </p>
      </div>

      <div className="toolbar">
        <form method="get" action="/account/total-cost" className="toolbar-search">
          <input name="q" defaultValue={q} placeholder="ค้นหา BL / Job No. / ลูกค้า / ชุดใบแจ้งหนี้ / เลขที่ใบแจ้งหนี้" />
          <button className="button" type="submit">ค้นหา</button>
          {q ? <Link className="button" href="/account/total-cost">ล้าง</Link> : null}
        </form>
      </div>
      <p className="hint">{rows.length} BL{rows.length >= 500 ? ' (แสดง 500 รายการล่าสุด — ใช้คำค้นให้แคบลง)' : ''}</p>

      <TotalCostTable rows={rows} emptyText={q ? 'ไม่พบรายการ' : 'ยังไม่มีข้อมูลจาก ERP SHIPME — จะขึ้นเองเมื่อแผนกบัญชี SHIPME จัดชุดใบแจ้งหนี้ ADV'} />
    </>
  );
}

