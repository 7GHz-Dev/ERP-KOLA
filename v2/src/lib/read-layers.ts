import type { TemplateFieldKey } from '@/lib/parse-template';

/**
 * อ่าน AN/BL แบบหลายชั้น — ชั้นไหนอ่านได้ก็เอาของชั้นนั้น ที่เหลือส่งต่อชั้นถัดไป
 *
 * เหตุผลที่ต้องมีหลายชั้น ไม่ใช่เลือกวิธีเดียว — วัดกับเอกสารจริง 9 ใบแล้วพบว่า
 * ไม่มีวิธีไหนชนะทุกกรณี
 *
 *   กรอบ + regex   ใบ PDF ปกติได้ 16/16 = 100% · ฟรี · เร็ว (ทำงานในเบราว์เซอร์)
 *                  แต่ใบสแกนได้ 0 เพราะไม่มีข้อความให้อ่านเลย
 *   OCR            อ่านใบสแกนได้ แต่คืนมาแค่ข้อความ ไม่มีพิกัด → ใช้กรอบไม่ได้
 *   AI             อ่านได้ทุกแบบและเข้าใจตาราง แต่มีค่าใช้จ่ายต่อใบ
 *
 * เรียงชั้นตาม "ถูกและแม่นที่สุดก่อน" แล้วค่อยไต่ขึ้นไปหาที่แพงกว่า
 * ใบปกติจึงไม่เสียเงินเลย และยังเร็วเท่าเดิม ส่วนใบสแกนที่เคยอ่านไม่ได้เลย
 * ถึงจะเสียเงินบ้างก็ยังดีกว่าให้คนพิมพ์เองทั้งใบ
 *
 * หลักที่ห้ามละเมิด — **เติมค่าผิดแย่กว่าปล่อยว่าง**
 * ชั้นที่มาทีหลังจึงเติมได้เฉพาะ "ช่องที่ยังว่าง" ห้ามทับค่าที่ชั้นก่อนหน้าอ่านได้แล้ว
 * เพราะชั้นก่อนหน้าแม่นกว่าเสมอ (กรอบคือสิ่งที่คนชี้เองว่าอยู่ตรงไหน)
 */

/**
 * ช่องที่ระบบเติมให้ได้
 *
 * แยก containers/seals ออกมาเป็นลิสต์ ส่วนช่องอื่นเป็นข้อความเดี่ยว
 * (TemplateFieldKey รวมสองตัวนี้ไว้ด้วยในฐานะ "ช่องที่ลากกรอบได้" จึงต้องตัดออกก่อน)
 */
export type ScalarField = Exclude<TemplateFieldKey, 'containers' | 'seals'>;

export type ReadValues = Partial<Record<ScalarField, string>> & {
  containers?: string[];
  seals?: string[];
};

/** ชื่อชั้น สำหรับบอกผู้ใช้ว่าค่ามาจากไหน */
export type LayerName = 'template' | 'auto' | 'ocr' | 'ai';

export const LAYER_LABEL: Record<LayerName, string> = {
  template: 'กรอบที่ตั้งไว้',
  auto: 'ตัวอ่านอัตโนมัติ',
  ocr: 'OCR (ไฟล์สแกน)',
  ai: 'AI ช่วยอ่าน',
};

export type LayerResult = {
  layer: LayerName;
  values: ReadValues;
  /** ใช้เวลาไปเท่าไหร่ (ms) — เอาไว้ดูว่าชั้นไหนช้า */
  ms?: number;
  /** ค่าใช้จ่ายโดยประมาณเป็นบาท (เฉพาะชั้นที่มีค่าใช้จ่าย) */
  baht?: number;
  /** อ่านไม่สำเร็จเพราะอะไร — ชั้นที่ล้มไม่ทำให้ทั้งใบพัง */
  error?: string;
};

export type LayeredRead = {
  values: ReadValues;
  /** ช่องไหนมาจากชั้นไหน — เอาไปแสดงให้ผู้ใช้เห็นว่าควรตรวจช่องไหนเป็นพิเศษ */
  source: Partial<Record<keyof ReadValues, LayerName>>;
  layers: LayerResult[];
  baht: number;
};

const LIST_FIELDS = ['containers', 'seals'] as const;

/** ช่องนี้ถือว่า "มีค่าแล้ว" หรือยัง — ค่าว่างหรือลิสต์เปล่าถือว่ายังไม่มี */
function filled(values: ReadValues, key: string): boolean {
  const v = (values as Record<string, unknown>)[key];
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * รวมผลจากชั้นถัดไปเข้ากับของเดิม — เติมเฉพาะช่องที่ยังว่าง
 *
 * เลขตู้กับเลขซีลต้องมาคู่กัน ถ้าชั้นใหม่ให้เลขตู้มาแต่ของเดิมมีซีลอยู่แล้ว
 * ซีลเดิมจะไม่ตรงกับตู้ชุดใหม่ (จับคู่กันด้วยลำดับ) จึงต้องรับมาทั้งคู่หรือไม่รับเลย
 */
export function mergeLayer(
  base: LayeredRead, next: LayerResult,
): LayeredRead {
  const values: ReadValues = { ...base.values };
  const source = { ...base.source };

  for (const [key, value] of Object.entries(next.values)) {
    if (LIST_FIELDS.includes(key as typeof LIST_FIELDS[number])) continue;
    if (filled(values, key)) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    (values as Record<string, unknown>)[key] = value;
    (source as Record<string, LayerName>)[key] = next.layer;
  }

  // เลขตู้ + ซีล รับมาทั้งชุด เฉพาะเมื่อของเดิมยังไม่มีตู้เลย
  if (!filled(values, 'containers') && next.values.containers?.length) {
    values.containers = next.values.containers;
    (source as Record<string, LayerName>).containers = next.layer;
    /*
     * ซีลเรียงคู่กับตู้ตามลำดับ — รับซีลของชั้นเดียวกันเท่านั้น
     * ถ้าชั้นนั้นไม่ได้ให้ซีลมา ปล่อยว่างดีกว่าเอาซีลจากคนละที่มาจับคู่ผิดคัน
     */
    if (next.values.seals?.length) {
      values.seals = next.values.seals;
      (source as Record<string, LayerName>).seals = next.layer;
    }
  }

  return {
    values,
    source,
    layers: [...base.layers, next],
    baht: base.baht + (next.baht ?? 0),
  };
}

/** ช่องที่ยังว่างอยู่ — ใช้ตัดสินใจว่าควรเรียกชั้นถัดไปไหม */
export function missingFields(values: ReadValues, want: readonly string[]): string[] {
  return want.filter((f) => !filled(values, f));
}

/**
 * ช่องที่ "สำคัญพอจะยอมจ่ายเพื่อให้ได้มา"
 *
 * ถ้าช่องพวกนี้ครบแล้ว ไม่ต้องเรียกชั้นที่มีค่าใช้จ่ายต่อ
 * ช่องอื่นที่ยังว่างให้คนกรอกเองเร็วกว่ารอ AI และไม่ต้องเสียเงิน
 */
export const KEY_FIELDS = ['blNo', 'vessel', 'voyage', 'eta', 'grossWeight', 'containers'] as const;

/** ผลเปล่า สำหรับเริ่มไล่ชั้น */
export const emptyRead = (): LayeredRead => ({ values: {}, source: {}, layers: [], baht: 0 });
