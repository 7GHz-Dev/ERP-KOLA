/**
 * อ่านข้อมูลจาก Arrival Notice / BL ที่เป็น PDF
 *
 * ตรรกะจับสายเรือและรูปแบบเลข BL ยกมาจากระบบเดิม (AppScripts.html)
 * ทำงานฝั่งเบราว์เซอร์ทั้งหมด ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์จนกว่าผู้ใช้จะกดบันทึก
 *
 * อ่านได้เท่าไหร่ก็เติมให้เท่านั้น ที่เหลือผู้ใช้แก้เองได้ — ไม่เดาแล้วเขียนทับของที่กรอกไว้แล้ว
 */

export type ParsedArrival = {
  carrier: string;
  blNo: string;
  blType: string;
  vessel: string;
  voyage: string;
  eta: string;
  grossWeight: string;
  unitAmount: string;
  containers: string[];
  seals: string[];
};

const CARRIERS: Array<[RegExp, string]> = [
  [/MAERSK|\bMAEU\b/, 'MAERSK'],
  [/EVERGREEN|\bEGLV/, 'EVERGREEN'],
  [/JINJIANG|JJSHIPPING|\bJJ[A-Z]{4}/, 'JINJIANG'],
  [/NAMSUNG|NSSL/, 'NAMSUNG'],
  [/CMA\s*CGM|\bCNC\b/, 'CNC'],
  [/\bOOCL\b|\bOOLU/, 'OOCL'],
  [/OCEAN NETWORK EXPRESS|ONE-?LINE|\bONEY/, 'ONE'],
  [/WAN\s*HAI|\bWHSU/, 'WANHAI'],
  [/EMIRATES SHIPPING|\bESL\b|\bEMIVA/, 'ESL'],
];

/** รูปแบบเลข BL ของแต่ละสายเรือ เรียงตามความเฉพาะเจาะจง */
const BL_PATTERNS: Record<string, RegExp[]> = {
  MAERSK: [/\b(MAEU\s?\d{9})\b/, /B\/?L\s*(?:NO\.?)?\s*:?\s*(\d{9,10})\b/, /\b(\d{9})\b/],
  OOCL: [/\b(OOLU\d{7,})\b/],
  ONE: [/\b(ONEY[A-Z0-9]{8,})\b/],
  EVERGREEN: [/\b(EGLV\d{9,})\b/],
  WANHAI: [/B\/L\s*No\.?:?\s*([A-Z0-9]{8,})/i, /\b(WHSU[A-Z0-9]{6,})\b/],
  JINJIANG: [/\b(JJ[A-Z0-9]{6,})\b/],
  NAMSUNG: [/\b(NSSL[A-Z0-9]{6,})\b/],
  CNC: [/\b(CNC[A-Z0-9]{6,})\b/],
  ESL: [/\b(EMIVA[A-Z0-9]{6,})\b/],
};

const clean = (v: string | undefined | null) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** คำที่เป็นหัวข้อในเอกสาร ไม่ใช่ค่าจริง — ถ้าเจอแปลว่าจับผิดช่อง */
const LABEL_WORDS = /\b(VESSEL|VOYAGE|BILL|LADING|PLEASE|NOTIFY|DATE|PORT|TERMINAL|ARRIVAL|NOTICE|CONSIGNEE|SHIPPER|CARRIER|NUMBER|CONTAINER|DESCRIPTION|WEIGHT|TOTAL)\b/;

function first(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return clean(m[1]).replace(/\s+/g, '');
  }
  return '';
}

/**
 * ยอมรับค่าเฉพาะเมื่อดูน่าเชื่อถือจริง
 * เติมค่าผิดอันตรายกว่าเว้นว่าง เพราะผู้ใช้อาจกดบันทึกโดยไม่ทันสังเกต
 */
function plausibleName(value: string | undefined): string {
  const s = clean(value);
  if (s.length < 3 || s.length > 40) return '';
  if (LABEL_WORDS.test(s)) return '';
  if (!/[A-Z]{3}/.test(s)) return '';
  return s;
}

function plausibleVoyage(value: string | undefined): string {
  const s = clean(value).replace(/\s+/g, '');
  // เลขเที่ยวเรือมักเป็นตัวเลขผสมตัวอักษรสั้น ๆ เช่น 023S, 214W, 02633W
  if (!/^[0-9]{1,4}[A-Z]?$|^[A-Z]?[0-9]{2,5}[A-Z]$/.test(s)) return '';
  return s;
}

function toIsoDate(raw: string): string {
  const s = clean(raw);
  if (!s) return '';

  const dmy = s.match(/\b(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})\b/);
  if (dmy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const idx = months.indexOf(dmy[2].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
      return `${year}-${String(idx + 1).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
  }

  const numeric = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (numeric && Number(numeric[2]) <= 12) {
    // เอกสารเดินเรือใช้ dd/mm/yyyy เป็นหลัก
    return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  }

  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

export function parseArrivalText(raw: string): ParsedArrival {
  const text = raw.replace(/\r/g, '');
  const upper = text.toUpperCase();

  const carrier = CARRIERS.find(([re]) => re.test(upper))?.[1] ?? '';

  // หาเลขตู้ก่อน เพราะรูปแบบ 4 ตัวอักษร + 7 ตัวเลข ชนกับ pattern สำรองของเลข BL
  const containers = [...new Set(upper.match(/\b[A-Z]{4}\d{7}\b/g) ?? [])];
  const isContainer = (v: string) => containers.includes(v.replace(/\s+/g, ''));

  const blFromCarrier = first(upper, BL_PATTERNS[carrier] ?? []);
  const blNo =
    (blFromCarrier && !isContainer(blFromCarrier) ? blFromCarrier : '') ||
    [first(upper, [/B\/?L\s*(?:NO\.?|NUMBER)?\s*:?\s*([A-Z]{4}[A-Z0-9]{7,})/, /\b([A-Z]{4}\d{8,})\b/])]
      .filter((v) => v && !isContainer(v))[0] || '';

  const blType =
    /SEA\s*WAY\s*BILL|SEAWAYBILL|WAY\s*BILL/.test(upper) ? 'SWB'
    : /NON-?NEGOTIABLE/.test(upper) ? 'SWB'
    : /NEGOTIABLE/.test(upper) ? 'OBL'
    : '';

  // ชื่อเรือ/เที่ยว มักอยู่ติดกันคั่นด้วย / หรือช่องว่าง แต่รูปแบบต่างกันมากในแต่ละสายเรือ
  const pair =
    upper.match(/VESSEL\s*(?:\/|AND)?\s*VOY(?:AGE)?\.?\s*:?\s*([A-Z][A-Z0-9 .\-]{2,30}?)\s*\/\s*([A-Z0-9]{2,6})\b/) ??
    upper.match(/\b([A-Z][A-Z .\-]{3,28}?)\s+V\.?\s*([0-9]{2,5}[A-Z])\b/);

  let vessel = plausibleName(pair?.[1]);
  let voyage = plausibleVoyage(pair?.[2]);

  if (!vessel) {
    vessel = plausibleName(upper.match(/VESSEL\s*(?:NAME)?\s*:?\s*([A-Z][A-Z0-9 .\-]{2,30})/)?.[1]);
  }
  if (!voyage) {
    voyage = plausibleVoyage(upper.match(/VOY(?:AGE)?\.?\s*(?:NO\.?)?\s*:?\s*([A-Z0-9]{2,6})\b/)?.[1]);
  }

  const etaRaw =
    upper.match(/\bETA\b[^A-Z0-9]{0,20}([0-9]{1,2}[-/. ][A-Z0-9]{2,9}[-/. ][0-9]{2,4})/)?.[1] ??
    upper.match(/(?:ESTIMATED\s*(?:TIME\s*OF\s*)?ARRIVAL|ARRIVAL\s*DATE)\s*:?\s*([0-9]{1,2}[-/. ][A-Z0-9]{2,9}[-/. ][0-9]{2,4})/)?.[1] ??
    '';

  // น้ำหนักต้องมีหน่วยกำกับและมากพอที่จะเป็นน้ำหนักตู้จริง กันไปหยิบเลขอื่นมา
  const weightRaw = upper.match(/([\d,]+\.?\d*)\s*(?:KGS?|KGM)\b/)?.[1] ?? '';
  const weightValue = Number(clean(weightRaw).replace(/,/g, ''));
  const grossWeight = Number.isFinite(weightValue) && weightValue >= 100 ? String(weightValue) : '';

  const unitsRaw = upper.match(/\b(\d{1,4})\s*(?:UNITS?|PACKAGES?|PKGS?|CTNS?)\b/)?.[1] ?? '';
  const unitAmount = Number(unitsRaw) > 0 ? unitsRaw : '';

  const seals = (upper.match(/SEAL\s*(?:NO\.?)?\s*:?\s*([A-Z0-9]{5,})/g) ?? [])
    .map((s) => clean(s.replace(/SEAL\s*(?:NO\.?)?\s*:?\s*/i, '')));

  return {
    carrier, blNo, blType, vessel, voyage,
    eta: toIsoDate(etaRaw),
    grossWeight, unitAmount,
    containers, seals: [...new Set(seals)],
  };
}

/** ดึงข้อความทุกหน้าออกจาก PDF ด้วย pdf.js */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}
