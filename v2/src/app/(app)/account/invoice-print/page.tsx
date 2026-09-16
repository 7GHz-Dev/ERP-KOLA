import { requireUserReady } from '@/lib/auth';
import { InvoicePrintPicker } from '@/components/InvoicePrintPicker';
import { listInvoiceDoJobs, parseBlTerms } from '@/lib/queries/invoice-print';

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
  const terms = parseBlTerms(search);

  /*
   * เลขที่วางมาแล้วหาไม่เจอ — บอกให้รู้ว่าใบไหนตกหล่น
   * ถ้าไม่บอก บัญชีจะพิมพ์ไปโดยไม่รู้ว่าขาดใบ แล้วไปรู้ตอนตรวจกับต้นทางทีหลัง
   */
  const missing = terms.length > 1
    ? terms.filter((t) => !rows.some((r) =>
        (r.blNo ?? '').toUpperCase().includes(t.toUpperCase())))
    : [];

  return (
    <>
      <div className="page-head">
        <h1>พิมพ์ Invoice DO</h1>
        <p>ติ๊กเลือกเลข BL ที่ต้องการ · กดเปิดรวมเป็นไฟล์เดียว แล้วสั่งพิมพ์รอบเดียวจบ</p>
      </div>

      {/*
        ช่องค้นเป็นกล่องหลายบรรทัด เพราะบัญชีคัดเลข BL มาวางทีเดียวเป็นสิบใบ
        วางแล้วกดค้นหาได้เลย บรรทัดว่างและเลขซ้ำระบบตัดให้เอง
      */}
      <form method="get" action="/account/invoice-print" className="bl-search">
        <label className="mini">
          <span>เลข BL (วางได้หลายบรรทัด · เลขซ้ำระบบตัดให้)</span>
          <textarea
            name="q"
            rows={4}
            defaultValue={search}
            placeholder={'วางเลข BL ทีละบรรทัด เช่น\nONEYTYOGG3756600\nKG1222026-68581(ONEYTYOGG8879300)\n011GX05220'}
          />
        </label>
        <div className="bl-search-actions">
          <button className="button primary" type="submit">ค้นหา</button>
          {search ? <a className="button" href="/account/invoice-print">ล้างคำค้น</a> : null}
        </div>
      </form>

      {missing.length ? (
        <p className="drawer-note warn">
          หาไม่เจอ {missing.length} เลข: {missing.join(' · ')}
        </p>
      ) : null}

      <p className="hint">
        {terms.length > 1
          ? `ค้นจาก ${terms.length} เลข · เจอ ${rows.length} รายการ`
          : `แสดง ${rows.length} รายการล่าสุดที่มีไฟล์ Invoice DO`}
        {rows.length >= 300 ? ' (จำกัด 300 รายการ กรุณาใช้คำค้นให้แคบลง)' : ''}
      </p>

      <InvoicePrintPicker
        rows={rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt as unknown as string }))}
      />
    </>
  );
}
