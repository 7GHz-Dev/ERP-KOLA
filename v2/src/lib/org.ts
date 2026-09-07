/**
 * โครงบุคลากร — บริษัท แผนก ตำแหน่ง และสิทธิ์ที่คู่กัน
 *
 * แยก "ใครอยู่ตรงไหนในองค์กร" ออกจาก "ทำอะไรในระบบได้บ้าง"
 * เพราะโครงองค์กรเปลี่ยนบ่อยกว่าสิทธิ์ ย้ายแผนกหรือเลื่อนตำแหน่งจึงไม่ควร
 * ทำให้สิทธิ์เปลี่ยนตามไปเงียบ ๆ หน้าเพิ่มผู้ใช้เสนอ role ที่คู่กันเป็นค่าตั้งต้น
 * แล้วให้ผู้ดูแลยืนยันอีกทีเสมอ
 */

export const COMPANIES = [
  { key: 'KOLA', label: 'KOLA SHIPPING CO.,LTD.', kind: 'บริษัท' },
  { key: 'SHIPME', label: 'SHIPME LOGISTICS CO.,LTD.', kind: 'Partner' },
] as const;

export type CompanyKey = (typeof COMPANIES)[number]['key'];

export const POSITIONS = ['Manager', 'Employee'] as const;
export type Position = (typeof POSITIONS)[number];

/**
 * แผนก และสิทธิ์ที่ใช้ได้ในแผนกนั้น
 *
 * roles คือ role ที่เลือกได้เมื่ออยู่แผนกนี้ ตัวแรกเป็นค่าตั้งต้น
 * แผนกขาเข้ามีสามฝ่ายทำงานร่วมกัน จึงมี EMPLOYEE ที่ยืนแทนได้ทั้งสามฝ่ายอยู่ด้วย
 */
export const DEPARTMENTS = [
  {
    key: 'IMPORT',
    label: 'ขาเข้า',
    company: 'KOLA' as CompanyKey,
    roles: ['EMPLOYEE', 'NAMKANG', 'FAH', 'PAINT'],
  },
  {
    key: 'CARRIER_COORD',
    label: 'ประสานงานสายเรือ',
    company: 'SHIPME' as CompanyKey,
    roles: ['ANN'],
  },
  {
    key: 'SYSTEM',
    label: 'ผู้ดูแลระบบ',
    company: 'KOLA' as CompanyKey,
    roles: ['ADMIN'],
  },
] as const;

export type DepartmentKey = (typeof DEPARTMENTS)[number]['key'];

/** คำอธิบายสั้น ๆ ว่าแต่ละ role ทำอะไรได้ ใช้บนหน้าเพิ่มผู้ใช้ */
export const ROLE_INFO: Record<string, { label: string; detail: string }> = {
  ADMIN: {
    label: 'ผู้ดูแลระบบ',
    detail: 'ใช้ได้ทุกเมนู รวมถึง Master Data และการเพิ่มผู้ใช้',
  },
  EMPLOYEE: {
    label: 'พนักงานขาเข้า (ทุกฝ่าย)',
    detail: 'ใช้เมนูของ PAINT, FAH และ NAMKANG ได้ทั้งหมด แต่เข้า Master Data ไม่ได้',
  },
  PAINT: {
    label: 'PAINT',
    detail: 'รับ Arrival Notice / BL, งานคงค้าง, ชุดปล่อย E-Office และคิว Automation',
  },
  FAH: {
    label: 'FAH',
    detail: 'Invoice DO / ETA Official / Terminal, อนุมัติ Final Invoice และทำใบขน',
  },
  NAMKANG: {
    label: 'NAMKANG',
    detail: 'อนุมัติข้อมูล BL, ติดตาม Invoice สินค้า & Surrender และปล่อยสินค้า',
  },
  ANN: {
    label: 'ANN',
    detail: 'จัดการแลก DO — ออกจดหมาย, อัปโหลด Slip และรวมชุดเอกสาร',
  },
};

/** รายชื่อ role ทั้งหมดที่ตั้งให้ผู้ใช้ได้ */
export const ASSIGNABLE_ROLES = Object.keys(ROLE_INFO);

export const companyLabel = (key: string | null) =>
  COMPANIES.find((c) => c.key === key)?.label ?? key ?? '-';

export const departmentLabel = (key: string | null) =>
  DEPARTMENTS.find((d) => d.key === key)?.label ?? key ?? '-';

/** role ที่เลือกได้ในแผนกหนึ่ง — ไม่รู้จักแผนกก็ให้เลือกได้ทุก role */
export function rolesForDepartment(department: string | null): string[] {
  const found = DEPARTMENTS.find((d) => d.key === department);
  return found ? [...found.roles] : ASSIGNABLE_ROLES;
}
