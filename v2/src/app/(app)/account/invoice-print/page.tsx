import { requireUserReady } from '@/lib/auth';
import { InvoicePrintPicker } from '@/components/InvoicePrintPicker';
import { listInvoiceDoJobs } from '@/lib/queries/invoice-print';

export const dynamic = 'force-dynamic';

/**
 * ฝ่ายบัญชี — เลือกเลข BL หลายใบแล้วดึง Invoice DO มาพิมพ์รวมกัน
 *
 * ไม่ใช่คิวงาน จึงไม่กรองตามขั้นตอน แต่ค้นจากไฟล์ที่มีอยู่ทั้งหมด
 * เพราะบัญชีต้องพิมพ์ย้อนหลังได้ทุกช่วง รวมถึงงานที่เดินจบไปแล้ว
 */
export default async function AccountInvoicePrintPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ACCOUNT']);
  const q = (await searchParams).q;
  const search = typeof q === 'string' ? q : '';
  const rows = await listInvoiceDoJobs(search);

  return (
    <>
      <div className="page-head">
        <h1>พิมพ์ Invoice DO</h1>
        <p>ติ๊กเลือกเลข BL ที่ต้องการ · กดเปิดรวมเป็นไฟล์เดียว แล้วสั่งพิมพ์รอบเดียวจบ</p>
      </div>

      <form method="get" action="/account/invoice-print" className="search-form">
        <input
          name="q"
          defaultValue={search}
          placeholder="ค้นหาเลข BL · Job No. · Consignee"
          aria-label="ค้นหา"
        />
        <button className="button tiny" type="submit">ค้นหา</button>
        {search ? <a className="button tiny" href="/account/invoice-print">ล้างคำค้น</a> : null}
      </form>

      <p className="hint">
        แสดง {rows.length} รายการล่าสุดที่มีไฟล์ Invoice DO
        {rows.length >= 300 ? ' (จำกัด 300 รายการ กรุณาใช้คำค้นให้แคบลง)' : ''}
      </p>

      <InvoicePrintPicker
        rows={rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt as unknown as string }))}
      />
    </>
  );
}
