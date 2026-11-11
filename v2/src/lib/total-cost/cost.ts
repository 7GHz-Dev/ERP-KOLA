/**
 * Total cost — ค่าใช้จ่ายราย BL จาก ERP SHIPME (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
 *
 * SHIPME ส่งรายการดิบมาตอนแผนกบัญชีจัดชุดใบแจ้งหนี้ ADV (สเปก: docs/SHIPME-COSTS-API.md)
 *   INVOICE    = บรรทัดในใบแจ้งหนี้ ADV (V = ยอดก่อน VAT + VAT ของบรรทัด / NV = ไม่มี VAT)
 *   SETTLEMENT = ช่องในใบปิดบัญชีชิปปิ้ง (ยอดตามที่ชิปปิ้งจ่ายจริง ไม่มี VAT)
 *   TRANSPORT  = ช่องในชีตงานขนส่ง (ใช้เฉพาะ DEM ที่ไม่ได้ขึ้นใบแจ้งหนี้)
 *
 * จัดหมวดที่ฝั่ง KOLA (ไม่ใช่ SHIPME) — แก้กติกาที่นี่แล้วมีผลกับข้อมูลที่รับไว้แล้วทันที
 * ยอดเดียวกันมาได้สองทาง (ใบปิดบัญชี → ใบแจ้งหนี้) จึงนับทางเดียว:
 *   - หมวดที่ใบแจ้งหนี้ ADV มีช่องอยู่แล้ว (DO / LIFT ON / EXTRA MOVEMENT / STORAGE / พรบ.) นับจากใบแจ้งหนี้เท่านั้น
 *     ใบปิดบัญชีบวกค่าบริการ 4% ไว้ และฝ่ายบัญชีอาจตัดออกจากใบเอง — ยอดในใบคือยอดที่เรียกเก็บจริง
 *   - หมวดอื่นนับจากใบปิดบัญชี เว้นแต่ใบแจ้งหนี้มีบรรทัดหมวดนั้น (พิมพ์เพิ่มเอง) → ใช้ใบแจ้งหนี้
 *   - ยางเกิน / สำแดงเท็จ ใช้ยอดจาก Sale (เจรจาแล้ว) ไม่ใช่ยอดที่ SHIPME ขอ
 * หัก ณ ที่จ่าย 3% คิดทีละบรรทัดจากยอดก่อน VAT เฉพาะบรรทัดที่มี VAT ของหมวด DO / EXTRA MOVEMENT / STORAGE / LIFT ON / LIFT OFF
 */

export const WHT_RATE = 0.03;
export const MAX_BLS = 200;
export const MAX_LINES = 300;

export const COST_CATEGORIES = [
  { key: 'DO_VAT', label: 'DO (VAT)', group: 'DO', wht: true },
  { key: 'DO_NOVAT', label: 'DO (No VAT)', group: 'DO', wht: false },
  { key: 'DEM', label: 'DEM', wht: false },
  { key: 'EXTRA_MOVEMENT', label: 'EXTRA MOVEMENT', wht: true },
  { key: 'STORAGE', label: 'STORAGE', wht: true },
  { key: 'LIFT_ON', label: 'LIFT ON', wht: true },
  { key: 'LIFT_OFF', label: 'LIFT OFF', wht: true },
  { key: 'INSPECTOR', label: 'ค่านายตรวจ', wht: false },
  { key: 'OVERTIME', label: 'ค่าล่วงเวลา', wht: false },
  { key: 'SEAL', label: 'ค่าตะกั่ว', wht: false },
  { key: 'INSURANCE', label: 'ค่า พรบ.', wht: false },
  { key: 'ER_B2', label: 'ค่า ER ท่า B2', wht: false },
  { key: 'KNOCK', label: 'ค่าน็อค', wht: false },
  { key: 'SPECIAL', label: 'ค่าใช้จ่ายพิเศษ (Sale)', wht: false },
  { key: 'OTHER', label: 'อื่น ๆ', wht: false },
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number]['key'];
const CATEGORY = Object.fromEntries(COST_CATEGORIES.map((c) => [c.key, c])) as Record<CostCategory, (typeof COST_CATEGORIES)[number]>;
export const categoryLabel = (k: string) => CATEGORY[k as CostCategory]?.label ?? k;

/** หมวดที่ใบแจ้งหนี้ ADV มีช่องในตัว — ไม่ใช้ยอดจากใบปิดบัญชี/ชีตแทน */
const INVOICE_ONLY = new Set<CostCategory>(['DO_VAT', 'DO_NOVAT', 'LIFT_ON', 'EXTRA_MOVEMENT', 'STORAGE', 'INSURANCE']);

export type CostSource = 'INVOICE' | 'SETTLEMENT' | 'TRANSPORT';
export type RawLine = {
  source: CostSource; ref: string | null; kind: string | null; key: string | null;
  label: string; amount: number; vat: number; note: string | null;
};

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** ช่องในใบปิดบัญชี / ชีตงานขนส่ง (คีย์ของ SHIPME) → หมวด */
const KEY_CATEGORY: Record<string, CostCategory> = {
  do_fee: 'DO_NOVAT', do_vat: 'DO_VAT', do_non_vat: 'DO_NOVAT',
  dem: 'DEM',
  lift_on: 'LIFT_ON', lift_off: 'LIFT_OFF', storage: 'STORAGE', extra_movement: 'EXTRA_MOVEMENT',
  // ค่าบริการเพิ่มเติม(ฟรีโซน/ผ่านแดน) ในใบปิดบัญชี = ค่านายตรวจในชีตงานขนส่ง (เงินก้อนเดียวกัน เรียกคนละชื่อ)
  extra_service: 'INSPECTOR', extra_service_transit: 'INSPECTOR', inspector_fee: 'INSPECTOR',
  overtime: 'OVERTIME', seal: 'SEAL', insurance: 'INSURANCE',
};

/** ยางเกิน / สำแดงเท็จ — Sale เจรจายอดนี้กับ SHIPME */
export const SALE_SPECIAL = /ยางเกิน|สำแดงเท็จ/;

/** ชื่อรายการ → หมวด (ใบแจ้งหนี้พิมพ์ชื่อเองได้ จึงดูจากคำในชื่อ) */
export function categoryOfLabel(label: string): CostCategory | 'SALE_SPECIAL' {
  const s = flat(label).toUpperCase();
  if (SALE_SPECIAL.test(s)) return 'SALE_SPECIAL';
  if (/(^|[^A-Z])DO([^A-Z]|$)|แลก\s*ดีโอ/.test(s)) return /NON\s*-?\s*VAT|NO\s*VAT/.test(s) || !/VAT/.test(s) ? 'DO_NOVAT' : 'DO_VAT';
  if (/(^|[^A-Z])DEM([^A-Z]|$)|DEMURRAGE/.test(s)) return 'DEM';
  if (/EXTRA\s*MOVE/.test(s)) return 'EXTRA_MOVEMENT';
  if (/STORAGE/.test(s)) return 'STORAGE';
  if (/LIFT\s*-?\s*ON/.test(s)) return 'LIFT_ON';
  if (/LIFT\s*-?\s*OFF/.test(s)) return 'LIFT_OFF';
  if (/นายตรวจ/.test(s)) return 'INSPECTOR';
  if (/ล่วงเวลา|(^|[^A-Z])OT([^A-Z]|$)|OVERTIME/.test(s)) return 'OVERTIME';
  if (/ตะกั่ว|(^|[^A-Z])SEAL([^A-Z]|$)/.test(s)) return 'SEAL';
  if (/พ\.?\s*ร\.?\s*บ/.test(s)) return 'INSURANCE';
  if (/(^|[^A-Z])E\.?\s*R([^A-Z]|$)/.test(s)) return 'ER_B2';
  if (/น[็๊]?อค/.test(s)) return 'KNOCK';
  return 'OTHER';
}

export function categoryOf(line: Pick<RawLine, 'source' | 'key' | 'label' | 'vat'>): CostCategory | 'SALE_SPECIAL' {
  if (line.source !== 'INVOICE' && line.key && KEY_CATEGORY[line.key]) return KEY_CATEGORY[line.key];
  const cat = categoryOfLabel(line.label);
  // DO ในใบแจ้งหนี้: มี VAT หรือไม่ดูจากบรรทัดจริง (ใบ V มีทั้ง DO (VAT) และ DO (NON VAT) ส่วนใบ NV ไม่มี VAT ทั้งใบ)
  if (line.source === 'INVOICE' && (cat === 'DO_VAT' || cat === 'DO_NOVAT')) return line.vat > 0 ? 'DO_VAT' : 'DO_NOVAT';
  return cat;
}

export type SaleSpecial = { amount: number; approved: boolean; status: string; chargeId: string; items: number };

export type CostLine = RawLine & {
  category: CostCategory | 'SALE_SPECIAL'; wht: number;
  /** ไม่นับในยอดรวม — เหตุผลแสดงในหน้ารายละเอียด */
  skipped: string | null;
};

export type CostSummary = {
  lines: CostLine[];
  /** ยอดก่อน VAT ต่อหมวด */
  amounts: Record<CostCategory, number>;
  whtBy: Record<CostCategory, number>;
  subtotal: number; vat: number; total: number; wht: number; net: number;
  sale: SaleSpecial | null;
};

const zero = () => Object.fromEntries(COST_CATEGORIES.map((c) => [c.key, 0])) as Record<CostCategory, number>;

/** รวมรายการดิบของ BL เดียวเป็นยอดต่อหมวด (+ ค่าใช้จ่ายพิเศษจาก Sale) */
export function summarize(raw: RawLine[], sale: SaleSpecial | null): CostSummary {
  const tagged = raw.map((l) => ({ ...l, category: categoryOf(l) }));
  const invoiced = new Set(tagged.filter((l) => l.source === 'INVOICE').map((l) => l.category));

  const lines: CostLine[] = tagged.map((l) => {
    let skipped: string | null = null;
    if (l.category === 'SALE_SPECIAL') skipped = 'ใช้ยอดที่ Sale เจรจาแทน';
    else if (l.source !== 'INVOICE' && INVOICE_ONLY.has(l.category)) skipped = 'หมวดนี้นับจากใบแจ้งหนี้ ADV';
    else if (l.source !== 'INVOICE' && invoiced.has(l.category)) skipped = 'ใบแจ้งหนี้ ADV มีหมวดนี้แล้ว';
    const cat = CATEGORY[l.category as CostCategory];
    const wht = !skipped && cat?.wht && l.vat > 0 ? round2(l.amount * WHT_RATE) : 0;
    return { ...l, wht, skipped };
  });

  const amounts = zero();
  const whtBy = zero();
  let vat = 0;
  for (const l of lines) {
    if (l.skipped) continue;
    const k = l.category as CostCategory;
    amounts[k] = round2(amounts[k] + l.amount);
    whtBy[k] = round2(whtBy[k] + l.wht);
    vat = round2(vat + l.vat);
  }
  if (sale) amounts.SPECIAL = round2(amounts.SPECIAL + sale.amount);

  const subtotal = round2(Object.values(amounts).reduce((s, n) => s + n, 0));
  const wht = round2(Object.values(whtBy).reduce((s, n) => s + n, 0));
  const total = round2(subtotal + vat);
  return { lines, amounts, whtBy, subtotal, vat, total, wht, net: round2(total - wht), sale };
}

/** ยอดรวมหลาย BL (แถวท้ายตาราง) */
export function sumSummaries(list: CostSummary[]) {
  const amounts = zero();
  const whtBy = zero();
  let subtotal = 0, vat = 0, total = 0, wht = 0, net = 0;
  for (const s of list) {
    for (const c of COST_CATEGORIES) {
      amounts[c.key] = round2(amounts[c.key] + s.amounts[c.key]);
      whtBy[c.key] = round2(whtBy[c.key] + s.whtBy[c.key]);
    }
    subtotal = round2(subtotal + s.subtotal); vat = round2(vat + s.vat); total = round2(total + s.total);
    wht = round2(wht + s.wht); net = round2(net + s.net);
  }
  return { amounts, whtBy, subtotal, vat, total, wht, net };
}

export const blKey = (bl: unknown) => String(bl ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------- ตรวจข้อมูลที่ SHIPME ส่งมา ----------------

export type CostInvoiceRef = { number: string; kind: string; issueDate: string | null; batchName: string | null };
export type CostBl = { blNo: string; customer: string | null; invoices: CostInvoiceRef[]; lines: RawLine[] };
export type CostPayload = { batchName: string | null; bls: CostBl[] };

const str = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s ? s.slice(0, max) : null;
};
const money = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  return Number.isFinite(n) ? round2(n) : NaN;
};
const SOURCES: CostSource[] = ['INVOICE', 'SETTLEMENT', 'TRANSPORT'];

export function parseCostPayload(body: unknown): { ok: true; data: CostPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body ต้องเป็น JSON object' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.bls) || !b.bls.length) return { ok: false, error: 'ต้องมี bls อย่างน้อย 1 รายการ' };
  if (b.bls.length > MAX_BLS) return { ok: false, error: `ส่งได้ครั้งละไม่เกิน ${MAX_BLS} BL` };

  const bls: CostBl[] = [];
  for (const [i, rawBl] of b.bls.entries()) {
    const at = `bls[${i}]`;
    if (!rawBl || typeof rawBl !== 'object') return { ok: false, error: `${at} ไม่ถูกต้อง` };
    const x = rawBl as Record<string, unknown>;
    const blNo = str(x.blNo, 80);
    if (!blNo || !blKey(blNo)) return { ok: false, error: `${at}.blNo ว่าง` };
    const rawLines = Array.isArray(x.lines) ? x.lines : [];
    if (rawLines.length > MAX_LINES) return { ok: false, error: `${at}.lines เกิน ${MAX_LINES} รายการ` };
    const lines: RawLine[] = [];
    for (const [j, rl] of rawLines.entries()) {
      const l = (rl ?? {}) as Record<string, unknown>;
      const where = `${at}.lines[${j}]`;
      const source = String(l.source ?? '').toUpperCase() as CostSource;
      if (!SOURCES.includes(source)) return { ok: false, error: `${where}.source ต้องเป็น ${SOURCES.join(' / ')}` };
      const label = str(l.label, 200);
      if (!label) return { ok: false, error: `${where}.label ว่าง` };
      const amount = money(l.amount);
      const vat = l.vat === undefined || l.vat === null || l.vat === '' ? 0 : money(l.vat);
      if (!Number.isFinite(amount)) return { ok: false, error: `${where}.amount ไม่ใช่ตัวเลข` };
      if (!Number.isFinite(vat) || vat < 0) return { ok: false, error: `${where}.vat ไม่ถูกต้อง` };
      if (amount === 0 && vat === 0) continue;
      lines.push({
        source, label, amount, vat,
        ref: str(l.ref, 120), kind: str(l.kind, 10), key: str(l.key, 60), note: str(l.note, 500),
      });
    }
    const invoices: CostInvoiceRef[] = (Array.isArray(x.invoices) ? x.invoices : []).slice(0, 50).flatMap((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const number = str(o.number, 40);
      return number ? [{ number, kind: str(o.kind, 10) ?? '', issueDate: str(o.issueDate, 10), batchName: str(o.batchName, 80) }] : [];
    });
    bls.push({ blNo, customer: str(x.customer, 200), invoices, lines });
  }
  return { ok: true, data: { batchName: str(b.batchName, 80), bls } };
}
