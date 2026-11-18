import { loadEnv } from '@/lib/env';
import { jsonFromReply } from '@/lib/read-ai';
import { normalizeFuel } from './edit';

/**
 * ให้ AI อ่าน Cargo Invoice ของผู้ขายรายอื่น (NORMAL) ที่เป็น PDF / รูป / Excel ที่ระบบไม่รู้จักรูปแบบ
 * แล้วเติมฟอร์ม NORMAL ให้ก่อน — คนยังต้องตรวจทุกช่องก่อนบันทึก
 *
 * กันค่าเดาแบบเดียวกับ read-ai.ts (อ่าน AN/BL):
 *   1. สั่งให้ตอบค่าว่างเมื่อหาไม่เจอ ห้ามเดา
 *   2. ตรวจรูปแบบทุกค่า (sanitizeInvoice) — ค่าที่ผิดรูปทิ้งไป ดีกว่าหลุดไปถึงใบขน
 */
const MODEL = 'claude-sonnet-5';
const PRICE_IN = 3.0;
const PRICE_OUT = 15.0;
const USD_THB = 33;

const PROMPT = [
  'อ่าน Commercial / Cargo Invoice ของรถยนต์ใช้แล้ว (used cars) ใบนี้',
  'ตอบเป็น JSON อย่างเดียว ไม่ต้องอธิบาย ไม่ต้องใส่ ```',
  '',
  '{',
  '  "supplier": "ชื่อบริษัทผู้ขาย/ผู้ส่งออก (Seller / Shipper / Exporter) ที่ออก invoice",',
  '  "invoiceNo": "เลขที่ invoice",',
  '  "invoiceDate": "วันที่ invoice รูปแบบ YYYY-MM-DD",',
  '  "currency": "สกุลเงิน 3 ตัวอักษร เช่น USD JPY",',
  '  "blNo": "เลข B/L ถ้ามี",',
  '  "cars": [',
  '    {',
  '      "brand": "ยี่ห้อ เช่น TOYOTA", "model": "รุ่น เช่น PRIUS", "chassis": "เลขตัวถัง/Chassis/VIN/Frame no.",',
  '      "engine": "เลขเครื่อง หรือรุ่นเครื่อง ตามที่เขียน", "year": "ปีผลิต 4 หลัก", "cc": "ความจุเครื่อง ตัวเลขล้วน",',
  '      "fuel": "GASOLINE / DIESEL / HYBRID / ELECTRIC", "weight": "น้ำหนัก กก. ตัวเลขล้วน",',
  '      "amount": "ราคาของคันนี้ ตัวเลขล้วน", "container": "เลขตู้ของคันนี้ถ้าระบุ"',
  '    }',
  '  ]',
  '}',
  '',
  'กฎที่สำคัญที่สุด:',
  '- หนึ่งคัน = หนึ่งรายการใน cars เรียงตามลำดับในเอกสาร ห้ามรวมหรือตัดคัน',
  '- ช่องไหนหาไม่เจอในเอกสาร ให้ตอบ "" — ห้ามเดา ห้ามคำนวณเอง',
  '- ตัวเลขไม่มีลูกน้ำ ไม่มีหน่วย',
  '- ค่าผิดสร้างความเสียหายมากกว่าค่าว่าง เพราะใช้ยื่นใบขนสินค้า',
].join('\n');

export type AiCar = {
  brand: string; model: string; chassis: string; engine: string; fuel: string; container: string;
  year: number | null; cc: number | null; weight: number | null; price: number | null;
};
export type AiInvoice = {
  supplier: string; invoiceNo: string; invoiceDate: string; currency: string; blNo: string; cars: AiCar[];
};

const str = (v: unknown) => String(v ?? '').trim();
const up = (v: unknown, max: number) => {
  const s = str(v).toUpperCase().replace(/\s+/g, ' ');
  return s.length <= max ? s : '';
};
const num = (v: unknown, min: number, max: number) => {
  const text = str(v).replace(/,/g, '');
  if (/^\s*-/.test(text)) return null;
  const m = text.match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** ตรวจค่าที่ AI ตอบก่อนใช้ — export ไว้ให้ชุดตรวจเรียกได้โดยไม่ต้องมี API key */
export function sanitizeInvoice(raw: Record<string, unknown>): AiInvoice {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(raw.invoiceDate));
  const currency = str(raw.currency).toUpperCase();
  const cars = (Array.isArray(raw.cars) ? raw.cars : []).slice(0, 200).map((c): AiCar => {
    const r = (c ?? {}) as Record<string, unknown>;
    const year = num(r.year, 1950, new Date().getFullYear() + 1);
    const box = str(r.container).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fuel = up(r.fuel, 20);
    return {
      brand: up(r.brand, 40), model: up(r.model, 60),
      chassis: up(r.chassis, 30).replace(/\s/g, ''), engine: up(r.engine, 40).replace(/\s/g, ''),
      fuel: fuel ? normalizeFuel(fuel) : '',
      year: year ? Math.round(year) : null, cc: num(r.cc, 50, 20000),
      weight: num(r.weight, 100, 60000), price: num(r.amount, 0.01, 1e9),
      container: /^[A-Z]{4}\d{7}$/.test(box) ? box : '',
    };
  }).filter((c) => c.brand || c.model || c.chassis);
  return {
    supplier: up(raw.supplier, 120),
    invoiceNo: up(raw.invoiceNo, 60).replace(/\s/g, ''),
    invoiceDate: date ? `${date[3]}/${date[2]}/${date[1]}` : '',
    currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
    blNo: up(raw.blNo, 30).replace(/\s/g, ''),
    cars,
  };
}

export function aiReady() {
  loadEnv();
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** ส่งไฟล์ให้ AI อ่าน — pdf หรือรูป (png/jpg/webp/gif) · โยน error เมื่ออ่านไม่สำเร็จ */
export async function readInvoiceWithAi(bytes: Buffer, kind: 'pdf' | keyof typeof IMAGE_TYPES): Promise<{ invoice: AiInvoice; baht: number }> {
  loadEnv();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const source = kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[kind], data: bytes.toString('base64') } };
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: [source, { type: 'text', text: PROMPT }] }],
    }),
    signal: AbortSignal.timeout(110_000),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok) throw new Error(`AI อ่านไม่สำเร็จ: ${body?.error?.message || `HTTP ${response.status}`}`);
  const invoice = sanitizeInvoice(jsonFromReply(body?.content));
  const usage = body?.usage ?? {};
  const baht = ((Number(usage.input_tokens ?? 0) / 1e6) * PRICE_IN + (Number(usage.output_tokens ?? 0) / 1e6) * PRICE_OUT) * USD_THB;
  return { invoice, baht: Math.round(baht * 100) / 100 };
}
