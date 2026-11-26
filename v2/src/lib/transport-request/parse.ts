/**
 * Transport Request + ใบขน / E-Office → ERP SHIPME (เมนูชั่วคราวของ MAY) — ฟังก์ชันล้วน ใช้ได้ทั้งเบราว์เซอร์และเซิร์ฟเวอร์
 * สเปก: docs/superpowers/specs/2026-11-26-transport-request-to-shipme-design.md (root ของ repo)
 *
 * วันที่ของงานใน SHIPME = คอลัมน์ TRANSPORT (วันลากตู้) — ETA ใช้แสดงและเทียบกับงาน KOLA เท่านั้น
 * แถวที่จับคู่งาน KOLA ได้ใช้ BL / เลขตู้จาก KOLA เพราะ AI อ่านรูปพลาดตัวอักษรได้ ค่าที่อ่านไม่ตรงขึ้นเป็นคำเตือน
 */

export type TrRow = {
  line: number; eta: string; kind: string; transportDate: string; customer: string;
  quantity: number; bl: string; containers: string[];
  /** SHIPLINE — ช่อง VESSEL ของตารางขนส่ง SHIPME */
  vessel: string;
  /** ชื่อเรือจริง (VESSEL ใน Transport Request) */
  vesselName: string;
  port: string;
};
export type JobLite = {
  id: string; jobNo: string; blNo: string; containers: string[]; shipline: string; vessel: string;
  eta: string | null; doExchangedAt: string | null;
};
export type TrPreviewRow = TrRow & {
  jobId: string | null; jobNo: string | null; doExchanged: boolean | null; warnings: string[]; error: string;
};
export type DocGuess = { kind: 'DECL' | 'EOFFICE' | null; declarationNo: string; blHint: string; by: 'filename' | 'text' | '' };

const str = (v: unknown, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** ตัวใหญ่ เหลือแค่ A-Z0-9 — ใช้จับคู่ BL / เลขตู้ / เลขใบขน */
export const keyOf = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** BL ที่ควรลองจับคู่ — `KG1042026-74915(AMP0574862)` ลองทั้งค่าเต็ม · ส่วนนอกวงเล็บ · ส่วนในวงเล็บ */
export function blCandidates(bl: string): string[] {
  const out = [keyOf(bl)];
  const m = /^(.*?)\((.*?)\)\s*$/.exec(String(bl ?? ''));
  if (m) out.push(keyOf(m[1]), keyOf(m[2]));
  return [...new Set(out.filter(Boolean))];
}

/** d/m/yyyy (พ.ศ. ก็ได้) · d/m/yy · yyyy-mm-dd → yyyy-mm-dd ค.ศ. · วันที่ไม่มีจริง = '' */
export function toIsoDate(v: string): string {
  const s = String(v ?? '').trim();
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return '';
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
}

const splitContainers = (v: unknown, minLength = 4) => [...new Set(
  (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;/]+/)).map(keyOf).filter((x) => x.length >= minLength),
)];
const intOf = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// หัวตาราง Transport Request — ลำดับในรายการสำคัญ: SHIPLINE ก่อน VESSEL · CON ต้องตรงทั้งคำ (ไม่ใช่ CONTAINER)
const HEADERS: [keyof Omit<TrRow, 'line'> | 'bl', RegExp][] = [
  ['transportDate', /^TRANSPORT/i],
  ['eta', /^ETA/i],
  ['kind', /^(ประเภท|TYPE)/i],
  ['customer', /SHIPPER|ชิปเปอร์/i],
  ['quantity', /^(CON|CONT|QTY)\.?$|จำนวนตู้/i],
  ['bl', /BILL\s*OF\s*LADING|^B\s*\/?\s*L$|เลข\s*BL/i],
  ['containers', /CONTAINER/i],
  ['vessel', /SHIP\s*LINE|สายเรือ/i],
  ['vesselName', /^VESSEL/i],
  ['port', /^PORT|^ท่า/i],
];

/** ข้อความที่ Copy จาก Google Sheet / Excel (คั่นด้วยแท็บ) — หาคอลัมน์จากแถวหัวตาราง ไม่สนลำดับ */
export function parsePastedSheet(text: string): TrRow[] {
  const table = String(text ?? '').replace(/\r/g, '').split('\n')
    .map((l) => l.split('\t').map((c) => c.replace(/^"|"$/g, '').trim()))
    .filter((cells) => cells.some(Boolean));
  const headIdx = table.findIndex((cells) => cells.some((c) => /BILL\s*OF\s*LADING|^B\s*\/?\s*L$/i.test(c)));
  if (headIdx < 0) return [];
  const map = new Map<string, number>();
  table[headIdx].forEach((cell, i) => {
    const hit = HEADERS.find(([k, re]) => !map.has(k) && re.test(cell.replace(/\s+/g, ' ')));
    if (hit) map.set(hit[0], i);
  });
  const out: TrRow[] = [];
  for (const cells of table.slice(headIdx + 1)) {
    const get = (k: string) => (map.has(k) ? cells[map.get(k)!] ?? '' : '');
    if (!get('bl') && !get('containers')) continue;
    out.push({
      line: out.length + 1, eta: toIsoDate(get('eta')), kind: str(get('kind'), 40), transportDate: toIsoDate(get('transportDate')),
      customer: str(get('customer')), quantity: intOf(get('quantity')), bl: str(get('bl'), 120),
      containers: splitContainers(get('containers')), vessel: str(get('vessel'), 80), vesselName: str(get('vesselName'), 120),
      port: str(get('port'), 60),
    });
  }
  return out;
}

/**
 * ผลที่ AI อ่านจากรูป — ไว้ใจไม่ได้ทั้งรูปแบบและค่า
 * แถวไม่มี BL ทิ้ง · ตัวเลขผิดรูปเป็น 0 · เลขตู้ผิดรูปเก็บไว้ (mergeWithJob เตือนเมื่อไม่ตรงกับ KOLA)
 */
export function sanitizeAiRows(raw: unknown): TrRow[] {
  if (!Array.isArray(raw)) return [];
  const out: TrRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const bl = str(r.bl, 120);
    if (!bl) continue;
    out.push({
      line: out.length + 1, eta: toIsoDate(str(r.eta, 20)), kind: str(r.kind, 40), transportDate: toIsoDate(str(r.transport, 20)),
      customer: str(r.shipper), quantity: intOf(r.con), bl, containers: splitContainers(r.containers, 1),
      vessel: str(r.shipline, 80), vesselName: str(r.vessel, 120), port: str(r.port, 60),
    });
  }
  return out;
}

/** งาน KOLA ของ BL นี้จาก Map(key → งาน) — ลองตาม blCandidates */
export function findJob(bl: string, jobs: Map<string, JobLite>): JobLite | null {
  for (const k of blCandidates(bl)) {
    const job = jobs.get(k);
    if (job) return job;
  }
  return null;
}

/** รวมแถวที่อ่านได้กับงาน KOLA — งานที่จับได้เป็นหลักของ BL / เลขตู้ · ทุกความต่างขึ้นเป็นคำเตือน */
export function mergeWithJob(row: TrRow, job: JobLite | null): TrPreviewRow {
  const warnings: string[] = [];
  let { bl, containers } = row;
  if (!job) warnings.push('ไม่พบใน KOLA');
  else {
    bl = job.blNo || bl;
    if (job.containers.length) {
      const known = new Set(job.containers.map(keyOf));
      const odd = row.containers.filter((c) => !known.has(keyOf(c)));
      if (odd.length) warnings.push(`เลขตู้ในรูปไม่ตรง KOLA: ${odd.join(', ')}`);
      containers = job.containers.map(keyOf);
    }
    const jobEta = job.eta ? job.eta.slice(0, 10) : '';
    if (row.eta && jobEta && row.eta !== jobEta) warnings.push(`ETA ในรูป ${row.eta} ไม่ตรง KOLA ${jobEta}`);
  }
  if (row.quantity > 0 && containers.length && row.quantity !== containers.length) {
    warnings.push(`CON ${row.quantity} แต่มีเลขตู้ ${containers.length} ตู้`);
  }
  const error = !bl ? 'ไม่มีเลข BL' : !row.transportDate ? 'ไม่มีวันที่ TRANSPORT' : '';
  return {
    ...row, bl, containers, jobId: job?.id ?? null, jobNo: job?.jobNo ?? null,
    doExchanged: job ? Boolean(job.doExchangedAt) : null, warnings, error,
  };
}

/** คำตอบของ GET /api/shipme/doc-status — คีย์ตามที่ SHIPME ถามมา */
export function docStatusBody(keys: string[], jobs: Map<string, JobLite>) {
  const items: Record<string, { found: boolean; jobNo?: string; doExchangedAt?: string | null }> = {};
  for (const k of keys) {
    const job = findJob(k, jobs);
    items[k] = job ? { found: true, jobNo: job.jobNo, doExchangedAt: job.doExchangedAt } : { found: false };
  }
  return { ok: true as const, items };
}

const DECL_RE = /A\d{3}-?\d-?\d{4}-?\d{5}/i;

/**
 * แยกประเภทไฟล์ — ชื่อไฟล์ก่อน (เลขใบขน = ใบขน · มี E-<เลข> = E-Office) ไม่ได้ค่อยอ่านข้อความในไฟล์
 * ข้อความ: คำร้องขอนำของ… = E-Office (ไฟล์ E-Office มีหน้าใบขนแนบอยู่ด้วย จึงต้องดูคำร้องก่อน) · มีเลขใบขน = ใบขน
 */
export function classifyDocFile(fileName: string, pdfText = ''): DocGuess {
  const base = String(fileName ?? '').replace(/\.[^.]+$/, '');
  const decl = DECL_RE.exec(base);
  if (decl) return { kind: 'DECL', declarationNo: keyOf(decl[0]), blHint: '', by: 'filename' };
  if (/(^|[^A-Z0-9])E-?\d{5,}/i.test(base)) {
    const blHint = base.replace(/(^|[^A-Z0-9])E-?\d{5,}/gi, ' ').split(/[\s_]+/).map(keyOf)
      .find((t) => t.length >= 6 && /[A-Z]/.test(t) && /\d/.test(t)) ?? '';
    return { kind: 'EOFFICE', declarationNo: '', blHint, by: 'filename' };
  }
  const text = String(pdfText ?? '');
  if (/คำร้องขอนำของ/.test(text)) return { kind: 'EOFFICE', declarationNo: '', blHint: '', by: 'text' };
  const inText = DECL_RE.exec(text);
  if (inText) {
    const bl = /\(\s*([A-Z]{2,}[A-Z0-9-]{6,})\s*\)/.exec(text);
    return { kind: 'DECL', declarationNo: keyOf(inText[0]), blHint: bl ? keyOf(bl[1]) : '', by: 'text' };
  }
  return { kind: null, declarationNo: '', blHint: '', by: '' };
}
