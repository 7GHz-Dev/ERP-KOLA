import { requireUserReady } from '@/lib/auth';
import { addedRules } from '@/lib/cargo-invoice/tariff';
import { CargoInvoiceTool } from '@/components/CargoInvoiceTool';

export const dynamic = 'force-dynamic';

/**
 * Create Cargo Invoice (PAINT) — แทนการผูกสูตร VLOOKUP และชีต datatariff ใน Excel
 *
 * 1 อัปโหลด Invoice Excel ของผู้ขาย  2 ระบบจัดเรียงและตรวจให้  3 ดึงพิกัด (เพิ่มรถรุ่นใหม่ได้)
 * 4 บันทึกเป็น Final Invoice ของงาน — worker สร้าง Draft ใบขนอ่านต่อได้ทันที
 */
export default async function CargoInvoicePage() {
  await requireUserReady(['PAINT']);
  const added = await addedRules();
  return (
    <>
      <div className="page-head">
        <h1>Create Cargo Invoice</h1>
        <p>อัปโหลด Invoice Excel → ระบบจัดเรียงรถตามตู้และตรวจยอดให้ → ดึงพิกัดศุลกากร (รถรุ่นใหม่เพิ่มพิกัดได้) → บันทึกเป็น Final Invoice</p>
      </div>
      <CargoInvoiceTool added={added.sort((a, b) => `${a.brand}${a.model}`.localeCompare(`${b.brand}${b.model}`))} />
    </>
  );
}
