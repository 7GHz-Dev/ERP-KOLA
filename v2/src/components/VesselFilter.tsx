'use client';

import { useRouter } from 'next/navigation';

/**
 * ช่องกรองคิวงานแบบเลือกจากรายการที่ยังมีงานค้างจริง แทนการพิมพ์เอง
 *
 * ใช้กับเรือ/เที่ยวที่หน้า Upload InvDO และวันที่ส่งรายการมาที่หน้าของ ANN กับ MAY
 * ทั้งสองอย่างพิมพ์เองแล้วพลาดง่ายพอกัน — ชื่อเรือสะกดยาวมีเที่ยวต่อท้าย
 * ส่วนวันที่ต้องพิมพ์ให้ตรงรูปแบบ พิมพ์ผิดก็ได้ตารางว่างโดยไม่รู้ว่าพิมพ์ผิด
 * หรือไม่มีงานจริง ๆ เลือกจากรายการจึงไม่มีทางพิมพ์ผิด
 * และเห็นตั้งแต่ยังไม่เลือกว่าเหลืออะไรให้ทำบ้าง กี่ใบ
 *
 * ส่งค่าเข้าช่องค้นหาเดิมบน URL ไม่ได้เปลี่ยนวิธีกรองที่ฝั่ง SQL
 * ลิงก์ที่แชร์กันไว้ก่อนหน้าจึงยังเปิดได้ และคนที่พิมพ์ค่าเองบน URL ก็ยังใช้ได้
 *
 * เปลี่ยนแล้วไปทันที ไม่มีปุ่มยืนยัน เพราะเป็นการกรองที่ย้อนกลับได้ด้วยการเลือกใหม่
 */
export function QueueFilter({
  options, value, basePath, carry, paramKey, label, unitLabel, groupLabel, emptyNote,
}: {
  /** ตัวเลือกที่ยังมีงานค้าง พร้อมจำนวนใบ */
  options: Array<{ value: string; label: string; count: number }>;
  /** ค่าที่เลือกอยู่ — มาจาก query string บน URL */
  value: string;
  basePath: string;
  /** ค่าที่ต้องติดไปด้วย เช่นแท็บและการเรียงลำดับ */
  carry: Record<string, string>;
  /** ชื่อ query string ที่ใช้กรอง เช่น vessel หรือ arrivedOn */
  paramKey: string;
  /** ป้ายหน้าช่องเลือก */
  label: string;
  /** หน่วยของสิ่งที่นับ เช่น "ใบ" */
  unitLabel: string;
  /** หน่วยของกลุ่ม เช่น "เที่ยว" หรือ "วัน" */
  groupLabel: string;
  /** ข้อความตอนไม่มีงานค้างเลย */
  emptyNote: string;
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
    if (next) params.set(paramKey, next);
    else params.delete(paramKey);
    const q = params.toString();
    router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
  };

  return (
    <div className="filter-bar">
      <span className="filter-label">{label}</span>
      <select
        className="vessel-filter"
        value={value}
        aria-label={`กรองตาม${label}`}
        onChange={(e) => go(e.target.value)}
      >
        <option value="">
          ทั้งหมด{options.length
            ? ` (${total} ${unitLabel} · ${options.length} ${groupLabel})`
            : ''}
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
      {options.length ? null : <span className="filter-note">{emptyNote}</span>}
    </div>
  );
}

/**
 * ตัวกรองเรือ/เที่ยวของหน้า Upload InvDO — ค่าคงเดิมทุกอย่าง
 *
 * เหลือไว้เป็นชื่อเดิมเพราะหน้าที่ใช้อยู่เรียกด้วยชื่อนี้ และอ่านที่หน้าเรียกแล้ว
 * รู้ทันทีว่ากรองด้วยอะไร โดยไม่ต้องไล่ดูว่าส่ง paramKey อะไรเข้าไป
 */
export function VesselFilter(props: {
  options: Array<{ value: string; label: string; count: number }>;
  value: string;
  basePath: string;
  carry: Record<string, string>;
}) {
  return (
    <QueueFilter
      {...props}
      paramKey="vessel"
      label="เรือ / เที่ยว"
      unitLabel="ใบ"
      groupLabel="เที่ยว"
      emptyNote="ไม่มีงานค้างรอส่ง Partner"
    />
  );
}
