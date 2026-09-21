'use client';

import { useRouter } from 'next/navigation';

/**
 * เลือกเรือ/เที่ยวจากรายการที่ยังมีงานค้าง แทนการพิมพ์เอง
 *
 * ชื่อเรือสะกดยาวและมีเที่ยวต่อท้าย พิมพ์ผิดตัวเดียวก็ได้ตารางว่าง
 * โดยไม่รู้ว่าพิมพ์ผิดหรือไม่มีงานจริง ๆ เลือกจากรายการจึงไม่มีทางพิมพ์ผิด
 * และเห็นตั้งแต่ยังไม่เลือกว่าเหลือเที่ยวไหนให้ทำบ้าง กี่ใบ
 *
 * ส่งค่าเข้าช่องค้นหาเดิม (?vessel=) ไม่ได้เปลี่ยนวิธีกรองที่ฝั่ง SQL
 * ลิงก์ที่แชร์กันไว้ก่อนหน้าจึงยังเปิดได้ และคนที่พิมพ์ค่าเองบน URL ก็ยังใช้ได้
 *
 * เปลี่ยนแล้วไปทันที ไม่มีปุ่มยืนยัน เพราะเป็นการกรองที่ย้อนกลับได้ด้วยการเลือกใหม่
 */
export function VesselFilter({
  options, value, basePath, carry,
}: {
  /** เรือ/เที่ยวที่ยังมีงานค้าง พร้อมจำนวนใบ */
  options: Array<{ value: string; label: string; count: number }>;
  /** ค่าที่เลือกอยู่ — มาจาก ?vessel= บน URL */
  value: string;
  basePath: string;
  /** ค่าที่ต้องติดไปด้วย เช่นแท็บและการเรียงลำดับ */
  carry: Record<string, string>;
}) {
  const router = useRouter();

  /*
   * ค่าที่เลือกอยู่อาจไม่ตรงกับตัวเลือกไหนเป๊ะ ๆ
   *
   * เกิดได้สองทาง — พิมพ์มาเองบน URL หรือเลือกเที่ยวไว้แล้วงานเที่ยวนั้นถูกส่ง
   * Partner ครบจนหลุดจากรายการ ถ้าไม่ใส่กลับเข้าไป <select> จะเด้งไปค่าแรกเอง
   * แล้วตารางที่เห็นกับช่องที่เลือกจะไม่ตรงกัน
   */
  const known = options.some((o) => o.value === value);
  const total = options.reduce((sum, o) => sum + o.count, 0);

  const go = (next: string) => {
    const params = new URLSearchParams(carry);
    if (next) params.set('vessel', next);
    else params.delete('vessel');
    const q = params.toString();
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
  };

  return (
    <div className="filter-bar">
      <span className="filter-label">เรือ / เที่ยว</span>
      <select
        className="vessel-filter"
        value={value}
        aria-label="กรองตามเรือและเที่ยวเรือ"
        onChange={(e) => go(e.target.value)}
      >
        <option value="">
          ทั้งหมด{options.length ? ` (${total} ใบ · ${options.length} เที่ยว)` : ''}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label} ({o.count})</option>
        ))}
        {/* ค่าที่ไม่อยู่ในรายการแล้ว ยังต้องแสดงให้เห็นว่ากำลังกรองด้วยอะไรอยู่ */}
        {value && !known ? <option value={value}>{value} (ไม่มีงานค้าง)</option> : null}
      </select>
      {value ? (
        <button type="button" className="button tiny" onClick={() => go('')}>
          ล้างตัวกรอง
        </button>
      ) : null}
      {options.length ? null : (
        <span className="filter-note">ไม่มีงานค้างรอส่ง Partner</span>
      )}
    </div>
  );
}
