/**
 * แยกยอดเงิน วันที่ เลขที่รายการ และธนาคาร จากข้อความที่ OCR อ่านได้
 *
 * ยกมาจาก ERP-SHIPME ซึ่งใช้กับสลิปธนาคารไทยจริงมาแล้ว
 * เอาเฉพาะส่วนที่แยกข้อความ ไม่เอาส่วนที่ผูกกับระบบนั้น
 *
 * สลิปแต่ละธนาคารวางข้อความคนละแบบ จึงกวาดหาทุกตัวเลขที่หน้าตาเหมือนยอดเงิน
 * แล้วคืนมาทั้งชุด ให้คนเลือกเองว่าตัวไหนคือยอดจริง ดีกว่าเดาผิดแล้วเงียบ
 */

const BANKS: [RegExp, string][] = [
  [/กสิกร|kasikorn|kbank|k\s*plus/i, 'กสิกรไทย (KBank)'],
  [/ไทยพาณิชย์|siam\s*commercial|scb/i, 'ไทยพาณิชย์ (SCB)'],
  [/กรุงเทพ|bangkok\s*bank|bualuang|bbl/i, 'กรุงเทพ (BBL)'],
  [/กรุงไทย|krungthai|ktb/i, 'กรุงไทย (KTB)'],
  [/กรุงศรี|krungsri|ayudhya|kma/i, 'กรุงศรีอยุธยา (Krungsri)'],
  [/ทหารไทยธนชาต|ttb|tmbthanachart|thanachart|ธนชาต/i, 'ทีทีบี (ttb)'],
  [/ออมสิน|gsb|mymo/i, 'ออมสิน (GSB)'],
  [/พร้อมเพย์|promptpay/i, 'พร้อมเพย์ (PromptPay)']
];

function parseAmounts(text: unknown) {
  const source = String(text || '');
  const values: number[] = [];
  const push = (raw: string) => {
    const value = Number(raw.replace(/,/g, ''));
    if (value > 0 && value < 100000000 && !values.includes(value)) values.push(value);
  };
  // มีคอมมาคั่นหลักพัน หรือมีทศนิยม 2 ตำแหน่ง — รูปแบบปกติของยอดเงินในสลิป
  for (const m of source.matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/g)) push(m[1]);
  // จำนวนเต็มที่มีหน่วยเงินกำกับ เช่น "จำนวน 500 บาท" (บางธนาคารตัด .00 ทิ้ง)
  for (const m of source.matchAll(/(\d{1,8})\s*(?:บาท|บ\.|THB|Baht)/gi)) push(m[1]);
  return values.slice(0, 40);
}

// สลิปไทยเขียนเดือนได้ทั้งชื่อเต็ม ตัวย่อมีจุด และภาษาอังกฤษ
const MONTHS: Record<string, number> = {};
[
  ['มกราคม', 'ม.ค.', 'january', 'jan'],
  ['กุมภาพันธ์', 'ก.พ.', 'february', 'feb'],
  ['มีนาคม', 'มี.ค.', 'march', 'mar'],
  ['เมษายน', 'เม.ย.', 'april', 'apr'],
  ['พฤษภาคม', 'พ.ค.', 'may'],
  ['มิถุนายน', 'มิ.ย.', 'june', 'jun'],
  ['กรกฎาคม', 'ก.ค.', 'july', 'jul'],
  ['สิงหาคม', 'ส.ค.', 'august', 'aug'],
  ['กันยายน', 'ก.ย.', 'september', 'sept', 'sep'],
  ['ตุลาคม', 'ต.ค.', 'october', 'oct'],
  ['พฤศจิกายน', 'พ.ย.', 'november', 'nov'],
  ['ธันวาคม', 'ธ.ค.', 'december', 'dec']
].forEach((names, index) => names.forEach((name) => { MONTHS[name.toLowerCase()] = index + 1; }));

const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)                    // ชื่อยาวก่อน กัน "พ.ค." ไปชนกลางคำอื่น
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/**
 * ปีในสลิปมีทั้ง พ.ศ. และ ค.ศ. และมีทั้ง 4 หลักกับ 2 หลัก
 * 2 หลักเดาไม่ได้ตรง ๆ ("69" เป็นได้ทั้ง พ.ศ.2569 = ค.ศ.2026 และ ค.ศ.2069)
 * จึงลองทั้งสองแบบแล้วเลือกอันที่ตกอยู่ในช่วงเวลาที่เป็นไปได้จริง
 */
function normalizeYear(raw: string): number | null {
  const now = new Date().getFullYear();
  const inRange = (year: number) => year >= now - 5 && year <= now + 1;

  if (raw.length === 4) {
    const year = Number(raw);
    const gregorian = year > 2400 ? year - 543 : year;    // 2569 = พ.ศ.
    return gregorian > 1900 ? gregorian : null;
  }
  const yy = Number(raw);
  const buddhist = 2500 + yy - 543;                       // "69" → พ.ศ.2569 → 2026
  const gregorian = 2000 + yy;                            // "26" → 2026
  if (inRange(buddhist)) return buddhist;                 // สลิปไทยใช้ พ.ศ. เป็นหลัก
  if (inRange(gregorian)) return gregorian;
  return null;
}

function parseDates(text: unknown) {
  const source = String(text || '');
  const out: string[] = [];
  const push = (year: number | null, month: number, day: number) => {
    if (!year || !(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return;
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!out.includes(value)) out.push(value);
  };

  // 27/08/2569 • 27-08-2569 • 27.08.2569 (รับปี 2 หลักด้วย)
  // ต้องลอง \d{4} ก่อน \d{2} เสมอ ไม่งั้น regex จับ "2569" ได้แค่ "25" แล้วปีเพี้ยนไปทั้งใบ
  for (const m of source.matchAll(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})/g)) {
    push(normalizeYear(m[3]), Number(m[2]), Number(m[1]));
  }
  // 2026-08-27 (ISO)
  for (const m of source.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    push(normalizeYear(m[1]), Number(m[2]), Number(m[3]));
  }
  // 27 ส.ค. 2569 • 27 สิงหาคม 69 • 27 Aug 2026
  const named = new RegExp(`(\\d{1,2})\\s*(${MONTH_PATTERN})\\s*(\\d{4}|\\d{2})`, 'gi');
  for (const m of source.matchAll(named)) {
    push(normalizeYear(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  }
  return out;
}

export function parseText(text: unknown) {
  const source = String(text || '');
  const amounts = parseAmounts(source);
  const dates = parseDates(source);
  // ป้ายกำกับเลขที่รายการต่างกันไปตามธนาคาร และมักมีจุด/ทวิภาคคั่นก่อนตัวเลข
  const txnMatch = new RegExp(
    '(?:' + [
      'เลขที่รายการ', 'เลขรายการ', 'หมายเลขรายการ', 'เลขที่ธุรกรรม',
      'รหัสอ้างอิง', 'เลขที่อ้างอิง', 'เลขอ้างอิง', 'หมายเลขอ้างอิง',
      'transaction\\s*(?:id|no)?', 'reference\\s*(?:no|number)?', 'ref\\s*(?:no)?'
    ].join('|') + ')' +
    '\\s*[:#.\\-]*\\s*([A-Z0-9][A-Z0-9-]{5,59})',
    'i'
  ).exec(source);
  const bank = BANKS.find(([pattern]) => pattern.test(source))?.[1] || '';
  return { amounts, dates, amount: amounts[0] || 0, date: dates[0] || '', txn: txnMatch?.[1] || '', bank };
}
