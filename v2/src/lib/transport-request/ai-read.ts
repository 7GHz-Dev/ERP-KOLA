import { aiConfigured, jsonFromReply, MODEL, PRICE_IN, PRICE_OUT, USD_THB } from '@/lib/read-ai';
import { loadEnv } from '@/lib/env';
import { sanitizeAiRows, type TrRow } from './parse';

/**
 * ให้ AI อ่านรูปตาราง Transport Request (ภาพหน้าจอจากชีตของลูกค้า) — รุ่นและราคาเดียวกับ read-ai.ts
 *
 * AI อ่านตัวอักษรพลาดได้ จึงกันสามชั้น
 *   1. สั่งให้ตอบช่องว่างเมื่ออ่านไม่ออก ห้ามเดา
 *   2. sanitizeAiRows ทิ้งแถวไม่มี BL · ตัวเลข/วันที่ผิดรูปเป็นค่าว่าง
 *   3. ตอนแสดงตัวอย่าง แถวที่จับคู่งาน KOLA ได้ใช้ BL/ตู้จาก KOLA และเตือนค่าที่ไม่ตรง (mergeWithJob)
 */
export { aiConfigured };

const PROMPT = [
  'รูปนี้คือตาราง Transport Request (ภาพหน้าจอจาก Google Sheet) อ่านทุกแถวของตาราง',
  'ตอบเป็น JSON อย่างเดียว ไม่ต้องอธิบาย ไม่ต้องใส่ ```',
  '',
  '{ "rows": [ {',
  '  "eta": "ค่าในคอลัมน์ ETA ตามที่เห็น เช่น 25/11/2026",',
  '  "kind": "ค่าในคอลัมน์ ประเภท",',
  '  "transport": "ค่าในคอลัมน์ TRANSPORT ตามที่เห็น เช่น 27/11/2026",',
  '  "shipper": "ค่าในคอลัมน์ SHIPPER",',
  '  "con": "ค่าในคอลัมน์ CON (จำนวนตู้) ตัวเลขล้วน",',
  '  "bl": "ค่าในคอลัมน์ BILL OF LADING ทั้งช่อง รวมส่วนในวงเล็บ",',
  '  "containers": ["เลขตู้ทุกตัวในคอลัมน์ CONTAINER NO. ของแถวนั้น (ช่องเดียวอาจมีหลายตู้คั่นด้วย ,)"],',
  '  "shipline": "ค่าในคอลัมน์ SHIPLINE",',
  '  "vessel": "ค่าในคอลัมน์ VESSEL",',
  '  "port": "ค่าในคอลัมน์ PORT"',
  '} ] }',
  '',
  'กฎที่สำคัญที่สุด:',
  '- อ่านทีละตัวอักษรตามที่เห็นจริง ห้ามเดา ห้ามแก้ให้ดูถูกต้อง ช่องไหนอ่านไม่ออกหรือไม่มีคอลัมน์นั้นให้ตอบ ""',
  '- เรียงแถวตามลำดับในรูป ข้ามแถวหัวตารางและแถวว่าง',
  '- เลข BL และเลขตู้เป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่กับตัวเลข ระวัง O กับ 0 และ I กับ 1',
].join('\n');

export type ImageRead = { rows: TrRow[]; baht: number };

export async function readTransportImage(image: Buffer, mediaType: string): Promise<ImageRead> {
  loadEnv();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await response.json().catch(() => null) as Record<string, any> | null;
  if (!response.ok) throw new Error(`AI อ่านไม่สำเร็จ: ${json?.error?.message || `HTTP ${response.status}`}`);
  const parsed = jsonFromReply(json?.content);
  const usage = json?.usage ?? {};
  const baht = ((Number(usage.input_tokens ?? 0) / 1e6) * PRICE_IN + (Number(usage.output_tokens ?? 0) / 1e6) * PRICE_OUT) * USD_THB;
  return { rows: sanitizeAiRows(parsed.rows), baht };
}
