import { parsePortOfLoading } from '@/lib/port-of-loading';

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
  /** เมืองต้นทาง — อ่านจากช่อง Port of Loading ของเอกสาร */
  portOfLoading: string;
  /** ชื่อผู้ส่งออกที่อ่านได้ ใช้ไปจับกับรายชื่อใน Master Data ต่อ */
  shipperName: string;
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
/** เศษคำที่ติดมาจากข้อความข้างหน้า ไม่ใช่ส่วนหนึ่งของชื่อเรือ */
const NAME_NOISE = /^(?:.*(?:@|\.COM|:)\s*)?(?:ATTN|PIC|TO|FM|EMAIL|TEL)?\s*/;

/** คำที่เป็นท่าเรือหรือประเภทงาน ไม่ใช่ชื่อเรือ — เจอทั้งคำแปลว่าจับผิดช่อง */
const NOT_A_VESSEL = /^(?:CY|CFS|FCL|LCL|HAKATA CY|LAEM CHABANG|BANGKOK)$/;

function plausibleName(value: string | undefined): string {
  let s = clean(value);
  // ตัดเศษที่ติดมาจากที่อยู่หรืออีเมลข้างหน้า เช่น "...@GMAIL.COM HAKATA" หรือ "ATTN:PIC HAKATA"
  s = clean(s.replace(NAME_NOISE, ''));
  /*
   * ตัดท้ายที่เป็นป้ายของช่องถัดไป ไม่ใช่ส่วนหนึ่งของชื่อเรือ
   *
   * Maersk วางตัวอักษรห่างกันจน pdf.js อ่านได้เป็น "V OYAGE NO" ไม่ใช่ "VOYAGE NO"
   * จึงต้องเทียบแบบยอมให้มีช่องว่างแทรกระหว่างตัวอักษรได้
   */
  s = clean(s.replace(/\s+V\s*O\s*Y\s*A\s*G\s*E\b.*$/, ''));
  s = clean(s.replace(/\s+E\s*T\s*A\b.*$/, ''));
  // เลขเที่ยวเรือที่ติดมาท้ายชื่อ เช่น "MARTIN SCHULTE V.628S"
  s = clean(s.replace(/\s+V\.?\s*[0-9]{2,5}[A-Z]?\b.*$/, ''));
  // ท้ายชื่อมักมี "V" หรือ "V." ที่เป็นตัวย่อของ Voyage ไม่ใช่ส่วนของชื่อเรือ
  s = clean(s.replace(/\s+V\.?$/, ''));
  if (s.length < 3 || s.length > 40) return '';
  if (LABEL_WORDS.test(s)) return '';
  if (NOT_A_VESSEL.test(s)) return '';
  if (!/[A-Z]{3}/.test(s)) return '';
  return s;
}

function plausibleVoyage(value: string | undefined): string {
  const s = clean(value).replace(/\s+/g, '');
  // เลขเที่ยวเรือมักเป็นตัวเลขผสมตัวอักษรสั้น ๆ เช่น 023S, 214W, 02633W
  // บางสายใส่ขาไปขากลับคั่นด้วยขีด เช่น 0849-071N ของ EVERGREEN
  if (!/^[0-9]{1,4}[A-Z]?$|^[A-Z]?[0-9]{2,5}[A-Z]$|^[0-9]{3,4}-[0-9]{3}[A-Z]$/.test(s)) return '';
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

  // เดือนนำหน้าแบบ "AUG 01 2026"
  const mdy = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})\b/);
  if (mdy) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const idx = months.indexOf(mdy[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${mdy[3]}-${String(idx + 1).padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
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


/**
 * คำที่โผล่ถัดจากเลขตู้แต่ไม่ใช่เลขซีล — ส่วนใหญ่เป็นหัวตารางที่ pdf.js ต่อมาติดกัน
 * เดิมจับ "GROSS" มาเป็นเลขซีลเพราะอยู่ถัดจากป้าย SEAL NO. พอดี
 */
const NOT_A_SEAL = new RegExp(
  '^(GROSS|WEIGHT|SEAL|SIZE|TYPE|HEIGHT|TARE|PKGS|VALUE|CONTAINER|CNTR|MARKS?|NO|FCL|LCL'
  + '|DRY|HQ|REEFER|UNITS?|KGS?|CBM|TOTAL|MEASUREMENT|DESCRIPTION|PIECE|COUNT|RAIL|BOND)$',
);

/**
 * เลขซีลดูสมเหตุสมผลไหม
 *
 * เลขซีลจริงมีทั้งตัวอักษรและตัวเลขปนกัน เช่น ML-JP0354196, OOLLBA6612, JPF106401
 * ตัวอักษรล้วนคือหัวตาราง ส่วนตัวเลขล้วนมักเป็นน้ำหนักหรือจำนวน จึงตัดทิ้งทั้งคู่
 */
function plausibleSeal(value: string): boolean {
  const v = value.trim();
  if (v.length < 5 || v.length > 20) return false;
  if (NOT_A_SEAL.test(v)) return false;
  if (!/[A-Z]/.test(v) || !/[0-9]/.test(v)) return false;
  // เลขตู้เองก็เข้าเงื่อนไขข้างบน แต่ไม่ใช่เลขซีล
  if (/^[A-Z]{4}[0-9]{7}$/.test(v)) return false;
  // รหัสขนาดตู้ที่มักวางไว้ถัดจากเลขตู้ เช่น 40SD96, 20GP, 40HQ, 45HC
  if (/^(20|40|45)[A-Z]{2}[0-9]{0,2}$/.test(v)) return false;
  return true;
}

/**
 * จับเลขซีลให้ตรงกับตู้ของมัน
 *
 * ฟอร์มจับคู่ซีลกับตู้ด้วยลำดับในรายการ ถ้าคืนมาไม่ครบหรือสลับลำดับ
 * ซีลจะไปโผล่ผิดตู้ ซึ่งแย่กว่าปล่อยว่าง จึงคืนเป็นช่องว่างตรงตำแหน่งที่หาไม่เจอ
 *
 * เอกสารส่วนใหญ่วางเลขซีลไว้ถัดจากเลขตู้ทันที (CAAU9972316 ML-JP0354196)
 * บางใบมีป้าย SEAL NO. คั่นก่อน (CONTAINER NO.TRHU4037136 SEAL NO.JPF106401)
 * รองรับทั้งสองแบบโดยอ่านจากข้อความที่อยู่หลังเลขตู้นั้น ๆ
 */
function sealsFor(upper: string, containers: string[]): string[] {
  return containers.map((container) => {
    const at = upper.indexOf(container);
    if (at < 0) return '';
    // ดูเฉพาะช่วงสั้น ๆ หลังเลขตู้ ไกลกว่านี้เป็นข้อมูลของตู้ถัดไปแล้ว
    const after = upper.slice(at + container.length, at + container.length + 60);

    const labelled = after.match(/SEAL\s*(?:NO\.?)?\s*:?\s*([A-Z0-9][A-Z0-9-]{4,19})/);
    if (labelled && plausibleSeal(labelled[1])) return labelled[1];

    // ไล่ดูทีละคำ เพราะบางใบคั่นด้วยรหัสขนาดตู้ก่อนถึงเลขซีล (WHSU6587864 40SD96 WHA3946538)
    for (const token of after.match(/[A-Z0-9][A-Z0-9-]{4,19}/g) ?? []) {
      if (plausibleSeal(token)) return token;
    }

    return '';
  });
}


/**
 * ชื่อผู้ส่งออกจากช่อง Shipper / Exporter
 *
 * ป้ายเขียนได้หลายแบบ — "Shipper:", "Shipper/Exporter (Complete name and address)"
 * ค่าที่ตามมาคือชื่อบริษัทแล้วต่อด้วยที่อยู่ยาว ๆ จึงเอาแค่ท่อนแรกก่อนถึงตัวเลขบ้านเลขที่
 * บางใบ pdf.js แทรกช่องว่างกลางคำ (TMA CO.,L TD.) ยุบช่องว่างซ้ำทิ้งให้ตอนเทียบ
 */
function shipperFrom(upper: string): string {
  const m =
    upper.match(/SHIPPER\s*\/\s*EXPORTER[^)]*\)\s*([A-Z][A-Z0-9 .,'&-]{3,60})/) ??
    upper.match(/\bSHIPPER\b\s*:?\s*([A-Z][A-Z0-9 .,'&-]{3,60})/) ??
    upper.match(/\bEXPORTER\b\s*:?\s*([A-Z][A-Z0-9 .,'&-]{3,60})/);
  if (!m) return '';

  let v = clean(m[1]);
  // ตัดตั้งแต่บ้านเลขที่เป็นต้นไป ที่เหลือเป็นที่อยู่ ไม่ใช่ชื่อบริษัท
  v = v.replace(/\s+\d[\d-]*\s.*$/, '').trim();
  v = v.replace(/[,.\s]+$/, '').trim();
  // ป้ายของช่องอื่นที่ pdf.js ต่อมาติดกัน ไม่ใช่ชื่อผู้ส่งออก
  if (/^(S |'S |LOAD|COUNT|SAID|CTR|PACK)/.test(v)) return '';
  // ใบที่วางเป็นตาราง (ONE) หัวช่องทุกช่องอยู่รวมกัน ค่าจริงอยู่คนละที่
  if (LABEL_WORDS.test(v) || /\b(ESTIMATE|PICKUP|LOCATION|MOVEMENT|POD)\b/.test(v)) return '';
  if (v.length < 4) return '';
  return v;
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

  /*
   * ชื่อเรือกับเที่ยวเรืออยู่ติดกันเสมอ แต่คั่นด้วยอะไรก็ได้แล้วแต่สายเรือ
   *
   * รูปแบบที่เจอจริงในเอกสารที่ใช้อยู่ เรียงจากเฉพาะเจาะจงไปหากว้าง
   *   OOCL      Vessel/Voyage: BRIGHT TSUBAKI 031S
   *   EVERGREEN Loading VSL/VOY : EVER BEING 0849-071N
   *   MAERSK    MAERSK NAMSOS 628S
   * ตัวคั่นเป็น / ก็ได้ เป็นช่องว่างเฉย ๆ ก็ได้ จึงต้องมีหลาย pattern
   */
  const pair =
    upper.match(/VESSEL\s*(?:\/|AND)?\s*VOY(?:AGE)?\.?\s*:?\s*([A-Z][A-Z0-9 .\-]{2,30}?)\s*\/\s*([A-Z0-9-]{2,10})\b/) ??
    // ชื่อเรือแล้วตามด้วยเที่ยวเรือทันที เช่น "BRIGHT TSUBAKI 031S" หรือ "EVER BEING 0849-071N"
    upper.match(/(?:VSL\s*\/?\s*VOY|VESSEL\s*\/?\s*VOYAGE)\s*:?\s*([A-Z][A-Z .\-]{2,28}?)\s+([0-9]{3,5}[A-Z]?(?:-[0-9]{3}[A-Z])?)\b/) ??
    upper.match(/\b([A-Z][A-Z .\-]{3,28}?)\s+V\.?\s*([0-9]{2,5}[A-Z])\b/) ??
    upper.match(/\b([A-Z][A-Z .\-]{3,28}?)\s+([0-9]{3,4}[A-Z])\b/);

  let vessel = plausibleName(pair?.[1]);
  let voyage = plausibleVoyage(pair?.[2]);

  if (!vessel) {
    vessel = plausibleName(upper.match(/VESSEL\s*(?:NAME)?\s*:?\s*([A-Z][A-Z0-9 .\-]{2,30})/)?.[1]);
  }
  if (!voyage) {
    voyage = plausibleVoyage(upper.match(/VOY(?:AGE)?\.?\s*(?:NO\.?)?\s*:?\s*([A-Z0-9]{2,6})\b/)?.[1]);
  }

  /*
   * วันเรือเข้าเขียนกันคนละแบบทุกสายเรือ ต้องรับหลายรูปแบบ
   *   EVERGREEN  ETA THLCH : 2026-07-27
   *   WAN HAI    /ETA: 01/08/2026
   *   WAN HAI    Est. Arrival Date: AUG 01 2026
   *   OOCL       ETA AT POD: Laem Chabang ON: Wednesday, 17 Jun, 2026
   * ยอมให้มีคำคั่นระหว่างป้ายกับวันที่ได้ เพราะหลายใบแทรกชื่อท่าไว้ตรงกลาง
   */
  const etaRaw =
    // ปีนำหน้าแบบ ISO ต้องจับก่อน ไม่งั้น pattern วันนำหน้าจะไปคว้าครึ่งหลังมา
    upper.match(/\bETA\b[^0-9]{0,24}([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1] ??
    upper.match(/\bETA\b[^0-9]{0,24}([0-9]{1,2}[-/. ][A-Z0-9]{2,9}[-/. ][0-9]{2,4})/)?.[1] ??
    // OOCL แทรกชื่อวันไว้ก่อนวันที่ เช่น "ON: WEDNESDAY, 17 JUN, 2026"
    upper.match(/\bETA\b[^0-9]{0,60}?([0-9]{1,2}\s+[A-Z]{3,9},?\s+[0-9]{4})/)?.[1] ??
    upper.match(/(?:ESTIMATED\s*(?:TIME\s*OF\s*)?ARRIVAL|EST\.?\s*ARRIVAL\s*DATE|ARRIVAL\s*DATE)\s*:?\s*([0-9]{1,2}[-/. ][A-Z0-9]{2,9}[-/. ][0-9]{2,4})/)?.[1] ??
    // "AUG 01 2026" เดือนนำหน้า
    upper.match(/(?:EST\.?\s*ARRIVAL\s*DATE|ARRIVAL\s*DATE)\s*:?\s*([A-Z]{3,9}\s+[0-9]{1,2}\s+[0-9]{4})/)?.[1] ??
    '';

  /*
   * น้ำหนักรวมของทั้งงาน ไม่ใช่ของคันแรก
   *
   * ใบที่มีหลายคันจะไล่น้ำหนักรายคันก่อน แล้วค่อยสรุปรวมท้ายตาราง
   * ถ้าหยิบตัวแรกที่เจอจะได้น้ำหนักรถคันเดียว (1,690 แทนที่จะเป็น 16,350)
   * จึงมองหาบรรทัดสรุปก่อน ไม่มีค่อยถอยไปใช้ค่าที่มากที่สุดที่มีหน่วยกำกับ
   */
  const weightOf = (v: string | undefined) => {
    const n = Number(clean(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) && n >= 100 ? n : 0;
  };

  const totalWeight = weightOf(
    upper.match(/TOTAL[^0-9]{0,40}([\d,]+\.?\d*)\s*(?:KGS?|KGM)\b/)?.[1]
    ?? upper.match(/(?:GROSS\s*WEIGHT|G\.?W\.?)\s*:?\s*([\d,]+\.?\d*)\s*(?:KGS?|KGM)\b/)?.[1],
  );

  // ไม่มีบรรทัดสรุป ใช้ค่าที่มากที่สุด ซึ่งมักเป็นน้ำหนักรวมของตู้
  const allWeights = [...upper.matchAll(/([\d,]+\.?\d*)\s*(?:KGS?|KGM)\b/g)]
    .map((m) => weightOf(m[1]))
    .filter(Boolean);

  const weightValue = totalWeight || Math.max(0, ...allWeights);
  const grossWeight = weightValue ? String(weightValue) : '';

  const unitsRaw = upper.match(/\b(\d{1,4})\s*(?:UNITS?|PACKAGES?|PKGS?|CTNS?)\b/)?.[1] ?? '';
  const unitAmount = Number(unitsRaw) > 0 ? unitsRaw : '';

  const seals = sealsFor(upper, containers);

  return {
    carrier, blNo, blType, vessel, voyage,
    portOfLoading: parsePortOfLoading(text),
    shipperName: shipperFrom(upper),
    eta: toIsoDate(etaRaw),
    grossWeight, unitAmount,
    containers, seals,
  };
}

/** ดึงข้อความทุกหน้าออกจาก PDF ด้วย pdf.js */
/**
 * เตรียม pdfjs ให้พร้อมใช้ในเบราว์เซอร์
 *
 * แยกออกมาเพราะทั้งตัวอ่านข้อความและตัวแสดงตัวอย่างหน้าต้องตั้ง worker เหมือนกัน
 * โหลดแบบ dynamic เพื่อไม่ให้ pdfjs ติดไปกับก้อน JavaScript ก้อนแรกของหน้า
 */
export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();
  return pdfjs;
}

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}
