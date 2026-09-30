/**
 * จับ Slip ค่าแลก D/O เข้ากับงาน จากเลข BL ที่พิมพ์ไว้ในช่องบันทึกช่วยจำ
 *
 * MAY โอนเงินจากแอปธนาคารบนมือถือแล้วพิมพ์เลข BL ไว้ในช่องบันทึกช่วยจำ (Memo)
 * สลิปที่ได้จึงมีเลขที่บอกได้ว่าเป็นของงานไหน อ่านเลขนั้นด้วย OCR แล้วจับคู่ให้เอง
 *
 * จับคู่แบบ "หาเลข BL ที่มีอยู่แล้วในข้อความ" ไม่ใช่ "ตัดเลขออกมาแล้วเชื่อ"
 * เพราะ OCR มักใส่ช่องว่างหรือขีดกลางเลข และสลิปแต่ละธนาคารวางป้ายกับค่าคนละแบบ
 * บางธนาคารอยู่บรรทัดเดียวกัน บางธนาคารขึ้นบรรทัดใหม่
 *
 * ดูในช่องบันทึกช่วยจำก่อน เจอแล้วใช้เลย ไม่เจอค่อยกวาดทั้งใบ
 * ตอนกวาดทั้งใบรับเฉพาะเลข BL ที่ตรงเต็มตัว เพราะสลิปมีเลขบัญชีกับเลขอ้างอิงปนอยู่มาก
 *
 * เลือกให้เฉพาะตอนมั่นใจเหมือน matchBl() — จับไม่ได้ให้คนเลือกเอง ไม่เดา
 */

import { blKey } from './shipment-import';
import { keysOf } from './match-bl';

/** งานที่รับ Slip ได้ — สิ่งที่หน้าจอต้องใช้แสดงและให้เลือกเอง */
export type SlipChoice = {
  jobId: string;
  jobNo: string;
  blNo: string;
  consigneeName: string | null;
  /** มี Slip แนบอยู่แล้ว — แนบใหม่จะแทนที่ของเดิม */
  hasSlip: boolean;
};

export type SlipMatch = {
  /** ข้อความในช่องบันทึกช่วยจำที่อ่านได้ ใช้แสดงให้คนเทียบ */
  memo: string;
  jobIds: string[];
  /** จับได้จากช่องบันทึกช่วยจำ หรือจากการกวาดทั้งใบ */
  from: 'memo' | 'text' | null;
};

/*
 * ป้ายของช่องบันทึกช่วยจำตามแอปธนาคารที่เจอ
 * "บันทึกช่วยจำ" (K PLUS, SCB, Krungthai) · "Memo" / "Note" (แอปภาษาอังกฤษ) · "หมายเหตุ"
 */
const MEMO_LABEL = /(บันทึกช่วยจำ|บันทึก|หมายเหตุ|memo|note|remark)\s*[:：\-]?\s*/i;

/** ข้อความในช่องบันทึกช่วยจำ — ส่วนที่ต่อจากป้ายบนบรรทัดเดียวกัน กับอีกบรรทัดถัดไป */
export function extractMemo(text: string): string {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const at = lines.findIndex((line) => MEMO_LABEL.test(line));
  if (at < 0) return '';
  const rest = lines[at].replace(MEMO_LABEL, '').trim();
  /*
   * ค่าอยู่บรรทัดถัดไปก็มี (OCR อ่านคอลัมน์ซ้ายขวาเป็นคนละบรรทัด)
   * เอาบรรทัดถัดไปมาด้วยเสมอ เพราะเลข BL ยาวบางทีถูกตัดขึ้นบรรทัดใหม่ครึ่งหนึ่ง
   */
  return [rest, lines[at + 1] ?? ''].filter(Boolean).join(' ').slice(0, 200);
}

/*
 * ตัวที่ OCR สับสนบ่อยระหว่างตัวอักษรกับตัวเลข — แปลงให้เป็นแบบเดียวกันทั้งสองฝั่งก่อนเทียบ
 * ใช้ตอนเทียบกับเลขที่มีอยู่ในระบบเท่านั้น จึงไม่ทำให้ได้เลขแปลกใหม่ออกมา
 */
const loose = (value: string) => blKey(value).replace(/O/g, '0').replace(/[IL]/g, '1');

/** เลข BL ที่สั้นกว่านี้มีโอกาสไปตรงกับตัวเลขอื่นในสลิปโดยบังเอิญ */
const MIN_KEY = 8;

function find(segment: string, choices: SlipChoice[], allowPartial: boolean): string[] {
  const hay = loose(segment);
  if (!hay) return [];
  const index = choices.flatMap((choice) => keysOf(choice.blNo)
    .map(({ key }) => ({ key: loose(key), jobId: choice.jobId }))
    .filter(({ key }) => key.length >= MIN_KEY));

  // เลข BL เต็มตัวอยู่ในข้อความ — สลิปใบเดียวจ่ายหลาย BL ได้ จึงเก็บทุกใบที่เจอ
  const whole = [...new Set(index.filter(({ key }) => hay.includes(key)).map((e) => e.jobId))];
  if (whole.length || !allowPartial) return whole;

  /*
   * พิมพ์เลขไม่ครบ เช่นตัดรหัสสายเรือข้างหน้าทิ้ง (YOK2600762 แทน CULVYOK2600762)
   * รับเฉพาะเมื่อชี้ไปงานเดียว ถ้าตรงหลายงานถือว่าไม่ชัด ให้คนเลือกเอง
   */
  const out: string[] = [];
  for (const token of segment.toUpperCase().match(/[A-Z0-9][A-Z0-9 -]{6,}[A-Z0-9]/g) ?? []) {
    const part = loose(token);
    if (part.length < MIN_KEY) continue;
    const hits = [...new Set(index.filter(({ key }) => key.includes(part)).map((e) => e.jobId))];
    if (hits.length === 1 && !out.includes(hits[0])) out.push(hits[0]);
  }
  return out;
}

export function matchSlip(text: string, choices: SlipChoice[]): SlipMatch {
  const memo = extractMemo(text);
  const fromMemo = memo ? find(memo, choices, true) : [];
  if (fromMemo.length) return { memo, jobIds: fromMemo, from: 'memo' };

  const fromText = find(text, choices, false);
  if (fromText.length) return { memo, jobIds: fromText, from: 'text' };
  return { memo, jobIds: [], from: null };
}
