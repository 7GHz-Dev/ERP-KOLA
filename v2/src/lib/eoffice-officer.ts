/**
 * ค่าในคำร้องขอนำของเข้าเขตปลอดอากร (ปะหน้า E-Office) ที่คำนวณจากข้อมูลที่กรอก
 * ใช้ร่วมกันทั้งตัววาด PDF หน้า A4 และตอนบันทึกคำร้อง — ไฟล์นี้ไม่แตะฐานข้อมูล
 *
 *   เรียน คุณ<ชื่อ>                       มุมซ้ายใต้ตาราง
 *   (<คำนำหน้า><ชื่อ> <นามสกุล>)           ในช่องบันทึกการอนุญาตของพนักงานศุลกากร (ซ้ายล่าง)
 *   <ตำแหน่ง>                             บรรทัดถัดไป
 *   <ฝศ>,<สบศ>                            ใต้ช่องเจ้าหน้าที่ มุมขวา — ฝ่ายที่ส่ง E ตามท่าเรือของงาน
 */

export const OFFICER_PREFIXES = ['นาย', 'นาง', 'นางสาว'] as const;
export const DEFAULT_OFFICER_PREFIX = 'นาย';
export const DEFAULT_OFFICER_POSITION = 'นักวิชาการศุลกากรชำนาญการ';
export const DEFAULT_CURRENCY = 'JPY';

/** "เรียน คุณ" + ชื่อ — ชื่อติดกับคำว่า คุณ แบบในแบบฟอร์มจริง (เรียน คุณฐานวีร์) */
export function routeLine(routeTo: string, firstName: string | null | undefined) {
  const name = (firstName ?? '').trim();
  if (!name) return routeTo;
  return /คุณ$/.test(routeTo.trim()) ? `${routeTo.trim()}${name}` : `${routeTo} ${name}`.trim();
}

/** (นายฐานวีร์ จิโรชอภิวรรธน์) — ไม่มีชื่อ = ว่าง (ช่องเจ้าหน้าที่ไม่ขึ้นวงเล็บเปล่า) */
export function officerLine(prefix: string | null | undefined, firstName: string | null | undefined, surname: string | null | undefined) {
  const first = (firstName ?? '').trim();
  if (!first) return '';
  const full = [first, (surname ?? '').trim()].filter(Boolean).join(' ');
  return `(${(prefix ?? '').trim()}${full})`;
}

/**
 * ตัวเลขมีจุลภาคคั่นหลักพัน: 5311490 → 5,311,490 · 13360.5 → 13,360.5
 * พิมพ์มามีจุลภาคแล้วก็ได้ผลเดิม · ไม่ใช่ตัวเลข (เช่นเว้นว่าง หรือเขียนเป็นคำ) คืนตามที่พิมพ์
 */
export function formatAmount(raw: string | number | null | undefined) {
  const text = String(raw ?? '').trim();
  const plain = text.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return text;
  const [int, frac] = plain.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/**
 * ฝ่ายที่ส่ง E ตามท่าเรือ (ตารางของด่าน) — ฝศ,สบศ เช่น A0 = ฝศ 3 สบศ 1 → "3,1"
 * จับจากรหัสท่าก่อน (Master Data › Terminal ช่องรหัส) แล้วค่อยจากชื่อท่า (A0, C1C2, D1D2 …)
 * DG (2826) เป็นฝ่ายทั่วไป ไม่มีเลขฝ่าย → ว่าง · เชียงแสน → "เชียงแสน"
 */
const SECTIONS: Array<{ section: string; codes: string[]; names: string[] }> = [
  { section: '1,2', codes: ['2816', '2839'], names: ['KERRY', 'KERRY2', 'KERRYTRANSIT', 'KERRYFREEZONE'] },
  { section: '3,1', codes: ['2835', '2822', '2821', '2829', '2818', '2811'], names: ['A0', 'A1', 'A2', 'A3', 'A5', 'B1'] },
  { section: '1,1', codes: ['2812', '2813', '2814', '2815', '2820'], names: ['B2', 'B3', 'B4', 'B5', 'C3'] },
  { section: '2,1', codes: ['2838', '2836', '2840'], names: ['C0', 'C1C2', 'D1', 'D1D2', 'D1D2D3'] },
  { section: 'เชียงแสน', codes: [], names: ['เชียงแสน'] },
];

export function sectionForTerminal(terminal: { code?: string | null; name?: string | null } | null | undefined) {
  if (!terminal) return '';
  const code = (terminal.code ?? '').trim();
  const byCode = SECTIONS.find((s) => s.codes.includes(code));
  if (byCode) return byCode.section;
  // ชื่อท่าเขียนได้หลายแบบ (KERRY 2, ท่า C1C2) — ตัดช่องว่างแล้วเทียบตรงตัวหรือขึ้นต้นด้วยรหัสท่า
  const keys = [code, terminal.name ?? ''].map((s) => s.replace(/\s+/g, '').toUpperCase()).filter(Boolean);
  const byName = SECTIONS.find((s) => s.names.some((n) => keys.includes(n.toUpperCase())));
  return byName?.section ?? '';
}
