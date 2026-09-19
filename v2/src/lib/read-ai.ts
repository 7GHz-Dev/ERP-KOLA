import { loadEnv } from '@/lib/env';
import { toIsoDate } from '@/lib/parse-arrival';
import type { ReadValues } from '@/lib/read-layers';

/**
 * ให้ AI อ่าน AN/BL — ชั้นสุดท้ายสำหรับใบที่วิธีอื่นอ่านไม่ได้
 *
 * ใช้เมื่อชั้นก่อนหน้าอ่านไม่ครบเท่านั้น เพราะชั้นนี้มีค่าใช้จ่ายต่อใบ
 * ส่งไฟล์ให้อ่านตรง ๆ ได้ทั้ง PDF ปกติและ PDF สแกน (อ่านจากภาพได้)
 *
 * ความเสี่ยงของชั้นนี้ต่างจากชั้นอื่น — ชั้นอื่นอ่านไม่ออกก็คืนค่าว่าง
 * แต่ AI อาจ "เดา" ค่าที่ดูสมเหตุสมผลแต่ไม่มีในเอกสาร ซึ่งอันตรายกว่ามาก
 * เพราะผู้ใช้กดบันทึกเร็วและมักไม่ทันสังเกต
 *
 * จึงกันสองชั้น
 *   1. สั่งในคำถามให้ตอบค่าว่างเมื่อหาไม่เจอ ห้ามเดา
 *   2. ตรวจรูปแบบของทุกค่าที่ได้มาอีกที ค่าที่ผิดรูปถูกทิ้ง (ดู sanitize ข้างล่าง)
 */

/** รุ่นที่ใช้ — Sonnet คุ้มสุดสำหรับงานอ่านเอกสาร */
const MODEL = 'claude-sonnet-5';

/** ราคาต่อ 1 ล้าน token (ดอลลาร์) — ใช้ประเมินค่าใช้จ่ายคร่าว ๆ */
const PRICE_IN = 3.0;
const PRICE_OUT = 15.0;
const USD_THB = 33;

export function aiConfigured(): boolean {
  loadEnv();
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const PROMPT = [
  'อ่านเอกสารขนส่งทางเรือ (Arrival Notice หรือ Bill of Lading) ใบนี้',
  'ตอบเป็น JSON อย่างเดียว ไม่ต้องอธิบาย ไม่ต้องใส่ ```',
  '',
  '{',
  '  "blNo": "เลข B/L หรือ Waybill number ของใบนี้",',
  '  "vessel": "ชื่อเรือ ไม่ต้องรวมเลขเที่ยวเรือ",',
  '  "voyage": "เลขเที่ยวเรือ",',
  '  "eta": "วันที่เรือถึงท่าปลายทาง รูปแบบ YYYY-MM-DD",',
  '  "portOfLoading": "ท่าเรือต้นทาง (Port of Loading)",',
  '  "grossWeight": "น้ำหนักรวมทั้งใบ ตัวเลขล้วน ไม่มีหน่วย ไม่มีลูกน้ำ",',
  '  "unitAmount": "จำนวนหน่วยรวมทั้งใบ ตัวเลขล้วน",',
  '  "shipperName": "ชื่อบริษัทผู้ส่งออก (Shipper/Exporter)",',
  '  "containers": ["เลขตู้ทุกตู้ในใบนี้"],',
  '  "seals": ["เลขซีล เรียงให้ตรงลำดับกับ containers"]',
  '}',
  '',
  'กฎที่สำคัญที่สุด:',
  '- ช่องไหนหาไม่เจอในเอกสาร ให้ตอบ "" หรือ [] — ห้ามเดา ห้ามคำนวณเอง',
  '- ห้ามเอาค่าจากช่องอื่นมาใส่แทน เช่นเอา Consignee มาใส่ช่อง Shipper',
  '- ค่าผิดสร้างความเสียหายมากกว่าค่าว่าง เพราะคนกดบันทึกโดยไม่ทันตรวจ',
  '- ถ้าเอกสารมีหลาย B/L ให้เอาใบแรกที่เจอ',
  '- น้ำหนักรวม = ยอดรวมทั้งใบ ไม่ใช่น้ำหนักของตู้ใดตู้หนึ่ง และไม่ใช่ค่า TARE',
].join('\n');

/** เลขตู้ตามมาตรฐาน ISO 6346 — 4 ตัวอักษร + 7 ตัวเลข */
const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;

/**
 * ตรวจค่าที่ AI ตอบมาก่อนใช้
 *
 * ไม่เชื่อว่าถูกเสมอ — ค่าที่ผิดรูปแบบชัด ๆ ถูกทิ้งไปเลย ดีกว่าปล่อยให้หลุดไปถึงฟอร์ม
 * ที่เหลือยังต้องให้คนตรวจอยู่ดี ระบบนี้เป็นตัวช่วยกรอก ไม่ใช่ตัวตัดสิน
 *
 * export ไว้ให้ชุดตรวจเรียกได้โดยไม่ต้องมี API key — กติกาการกรองเป็นส่วนที่
 * ต้องมีเทสต์คุมมากที่สุด เพราะเป็นด่านสุดท้ายก่อนค่าจาก AI จะถึงฟอร์ม
 */
export function sanitize(raw: Record<string, unknown>): ReadValues {
  const str = (v: unknown) => String(v ?? '').trim();
  const out: ReadValues = {};

  const blNo = str(raw.blNo).toUpperCase().replace(/\s+/g, '');
  // เลข BL สั้นกว่า 5 ตัวแทบไม่มีจริง — ถ้าได้มาสั้นกว่านั้นแปลว่าอ่านผิดช่อง
  if (blNo.length >= 5 && blNo.length <= 30) out.blNo = blNo;

  const vessel = str(raw.vessel).toUpperCase();
  if (vessel.length >= 3 && vessel.length <= 40) out.vessel = vessel;

  const voyage = str(raw.voyage).toUpperCase().replace(/\s+/g, '');
  if (voyage.length >= 2 && voyage.length <= 15) out.voyage = voyage;

  // แปลงวันที่ด้วยตัวเดียวกับที่ทั้งระบบใช้ ได้รูปแบบเดียวกันเสมอ
  const eta = toIsoDate(str(raw.eta));
  if (eta) out.eta = eta;

  const pol = str(raw.portOfLoading).toUpperCase();
  if (pol.length >= 2 && pol.length <= 60) out.portOfLoading = pol;

  const shipper = str(raw.shipperName).toUpperCase();
  if (shipper.length >= 3 && shipper.length <= 120) out.shipperName = shipper;

  /*
   * ตัวเลขที่ติดหน่วยมาด้วย
   *
   * สั่งไปว่าให้ตอบตัวเลขล้วน แต่เอกสารเขียนติดกันเป็น "26,000.0000KGS"
   * โมเดลจึงคัดลอกมาทั้งก้อนบ่อย ๆ — ดึงเฉพาะตัวเลขตัวแรกออกมาใช้
   * ถ้าไปเชื่อว่าสะอาดแล้วแปลงตรง ๆ จะได้ NaN แล้วทิ้งน้ำหนักที่ถูกต้องไปเปล่า ๆ
   */
  for (const key of ['grossWeight', 'unitAmount'] as const) {
    const text = str(raw[key]).replace(/,/g, '');
    // ค่าติดลบไม่ใช่น้ำหนักหรือจำนวน — ดึงตัวเลขออกมาจะกลายเป็นบวกโดยไม่ตั้งใจ
    const digits = /^\s*-/.test(text) ? null : text.match(/\d+(?:\.\d+)?/);
    const n = digits ? Number(digits[0]) : NaN;
    if (Number.isFinite(n) && n > 0) out[key] = String(n);
  }

  // เลขตู้ต้องเข้ารูป ISO 6346 — ตัวที่ไม่เข้ารูปคือ AI แต่งขึ้นหรืออ่านผิด
  const containers = Array.isArray(raw.containers)
    ? [...new Set(raw.containers.map((c) => str(c).toUpperCase().replace(/[^A-Z0-9]/g, '')))]
      .filter((c) => CONTAINER_RE.test(c))
    : [];
  if (containers.length) out.containers = containers;

  /*
   * เลขซีลจับคู่กับตู้ด้วยลำดับ — ถ้าจำนวนไม่ตรงกันแปลว่าเรียงเพี้ยน
   * ปล่อยซีลว่างทั้งชุดดีกว่าให้ซีลไปโผล่ผิดตู้
   */
  const seals = Array.isArray(raw.seals) ? raw.seals.map((s) => str(s).toUpperCase()) : [];
  if (containers.length && seals.length === containers.length) {
    out.seals = seals;
  }

  return out;
}

export type AiRead = { values: ReadValues; baht: number };

/**
 * ดึง JSON ออกจากคำตอบของโมเดล
 *
 * มีสองจุดที่เคยพลาดมาแล้ว จึงแยกออกมาให้ชุดตรวจจับได้
 *
 * 1. คำตอบมีหลายบล็อก และบล็อกแรกมักเป็น "thinking" (ขั้นตอนคิดของโมเดล)
 *    ซึ่งไม่มีช่อง text — หยิบบล็อกแรกไปตรง ๆ จะได้ค่าว่างแล้วพังทุกใบ
 * 2. บางครั้งใส่รั้ว ```json ครอบมาด้วย แม้จะสั่งไม่ให้ใส่แล้ว
 *    จึงตัดเอาตั้งแต่ { ตัวแรกถึง } ตัวสุดท้าย แทนที่จะเชื่อว่าสะอาด
 */
export function jsonFromReply(content: unknown): Record<string, unknown> {
  const blocks = Array.isArray(content) ? content as Array<Record<string, unknown>> : [];
  const said = String(blocks.find((b) => b?.type === 'text')?.text ?? '').trim();
  if (!said) throw new Error('AI ไม่ได้ตอบข้อความกลับมา');

  const start = said.indexOf('{');
  const end = said.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`AI ตอบกลับมาไม่เป็น JSON: ${said.slice(0, 80)}`);

  try {
    return JSON.parse(said.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error('AI ตอบกลับมาเป็น JSON ที่อ่านไม่ได้');
  }
}

/**
 * ส่งไฟล์ให้ AI อ่าน
 *
 * โยน error เมื่อเรียกไม่สำเร็จ ผู้เรียกจับไว้แล้วข้ามชั้นนี้ไป
 * ชั้นที่ล้มไม่ควรทำให้การอ่านทั้งใบพัง
 */
export async function readWithAi(pdf: Buffer): Promise<AiRead> {
  loadEnv();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(120000),
  });

  const json = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok) {
    throw new Error(`AI อ่านไม่สำเร็จ: ${json?.error?.message || `HTTP ${response.status}`}`);
  }

  const parsed = jsonFromReply(json?.content);

  const usage = json?.usage ?? {};
  const baht = ((Number(usage.input_tokens ?? 0) / 1e6) * PRICE_IN
    + (Number(usage.output_tokens ?? 0) / 1e6) * PRICE_OUT) * USD_THB;

  return { values: sanitize(parsed), baht };
}
