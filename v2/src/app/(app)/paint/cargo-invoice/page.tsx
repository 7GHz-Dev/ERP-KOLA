import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
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
  // Shipper พร้อมที่อยู่ — ฟอร์ม NORMAL ใช้เลือก Shipper และพิมพ์ที่อยู่บนหัว Final Invoice
  const shippers = await db.select({ id: masterRecords.id, code: masterRecords.code, name: masterRecords.name, address: masterRecords.address })
    .from(masterRecords).where(and(eq(masterRecords.type, 'shippers'), eq(masterRecords.isActive, true))).orderBy(asc(masterRecords.name));
  return (
    <>
      <div className="page-head">
        <h1>Create Cargo Invoice</h1>
        <p>JAN TRADING · AICHI: อัปโหลด Invoice Excel → ระบบจัดเรียงรถตามตู้และตรวจยอดให้ → ดึงพิกัดศุลกากร (รถรุ่นใหม่เพิ่มพิกัดได้) → บันทึกเป็น Final Invoice · ผู้ขายรายอื่น (NORMAL): อัปโหลด Excel / PDF / รูป แล้วคีย์ข้างไฟล์ · Preview FN Invoice และ CSV Draft ใบขนได้ก่อนบันทึก · ด้านล่างมีตาราง Datatariff และเลขเครื่องที่ระบบออกไว้ตรวจซ้ำ</p>
      </div>
      <CargoInvoiceTool shippers={shippers} />
    </>
  );
}
