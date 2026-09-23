import { randomBytes } from 'node:crypto';
import { db } from '@/db';
import { activityLog } from '@/db/schema';
import { currentUser, roleAllows } from '@/lib/auth';
import { AI_READ_ACTION } from '@/lib/usage-log';
import { driveOcrConfigured, driveOcrText } from '@/lib/drive-ocr';
import { parseArrivalText } from '@/lib/parse-arrival';
import { aiConfigured, readWithAi } from '@/lib/read-ai';
import {
  KEY_FIELDS, LAYER_LABEL, emptyRead, mergeLayer, missingFields,
  type LayerResult, type LayeredRead, type ReadValues,
} from '@/lib/read-layers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * อ่าน AN/BL ชั้นที่ต้องใช้เซิร์ฟเวอร์ — OCR กับ AI
 *
 * ชั้นกรอบกับตัวอ่านอัตโนมัติทำงานในเบราว์เซอร์อยู่แล้ว (ฟรี เร็ว ไฟล์ไม่ต้องออกจากเครื่อง)
 * เบราว์เซอร์จึงอ่านเองก่อน แล้วค่อยส่งมาที่นี่เฉพาะตอนที่ยังอ่านไม่ครบ
 * พร้อมบอกมาว่าได้ช่องไหนไปแล้วบ้าง จะได้ไม่ต้องทำงานซ้ำและไม่ทับค่าที่แม่นกว่า
 *
 * สองชั้นนี้ต้องอยู่ฝั่งเซิร์ฟเวอร์เพราะใช้กุญแจ (Google OAuth / API key)
 * ซึ่งส่งไปให้เบราว์เซอร์ไม่ได้
 *
 * ไม่บันทึกค่าที่อ่านได้ลงฐาน — เป็นตัวช่วยกรอกให้คนตรวจต่อ เหมือนชั้นอื่น
 * แต่บันทึก "ค่าใช้จ่าย" ของชั้น AI ไว้ เพราะเป็นเงินจริงที่ต้องตามดูได้ว่าเดือนนี้ใช้ไปเท่าไหร่
 */

/** ขนาดไฟล์สูงสุดที่ยอมรับ — กันไฟล์ใหญ่ผิดปกติที่จะทำให้ AI แพงเกินเหตุ */
const MAX_BYTES = 20 * 1024 * 1024;


export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, detail: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  if (!roleAllows(user.role, ['PAINT'])) {
    return Response.json({ ok: false, detail: 'ไม่มีสิทธิ์' }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, detail: 'ไม่ได้แนบไฟล์' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, detail: 'ไฟล์ใหญ่เกิน 20 MB' }, { status: 400 });
  }

  /*
   * ค่าที่เบราว์เซอร์อ่านได้แล้ว — ส่งมาเพื่อไม่ให้ชั้นหลังทับของที่แม่นกว่า
   * ถ้าไม่ส่งมาก็ถือว่ายังไม่ได้อะไรเลย แล้วไล่ทุกชั้นตั้งแต่ต้น
   */
  let already: ReadValues = {};
  try {
    const raw = form?.get('have');
    if (typeof raw === 'string' && raw) already = JSON.parse(raw) as ReadValues;
  } catch { /* ส่งมาไม่ถูกรูปก็ถือว่ายังไม่มีอะไร */ }

  const pdf = Buffer.from(await file.arrayBuffer());

  let result: LayeredRead = {
    ...emptyRead(),
    values: already,
    // ค่าที่มาจากเบราว์เซอร์นับเป็นชั้น "กรอบ" ซึ่งแม่นที่สุด
    source: Object.fromEntries(Object.keys(already).map((k) => [k, 'template' as const])),
  };

  /* ---------------- ชั้น AI ---------------- */

  /*
   * AI มาก่อน OCR — ตรงข้ามกับที่คิดไว้ตอนแรก แต่ผลวัดจริงบอกแบบนั้น
   *
   * วัดกับเอกสารจริง 9 ใบ (45 ช่องที่ตรวจเฉลยแล้ว)
   *   AI     45/45 = 100%  · ~0.83 บาทต่อใบ
   *   OCR    24/45 =  53%  · ฟรี
   *
   * ที่สำคัญกว่าคะแนนคือ **OCR ให้ค่าผิดที่ดูน่าเชื่อ** ซึ่งอันตรายกว่าค่าว่าง
   *   น้ำหนัก 157000 (ที่จริง 22820) · เที่ยวเรือ "6265" (ที่จริง "626S")
   *   ชื่อเรือ "DEPARTURE AND INVOICE ISSUANCE" · เลข BL ที่ Q กลายเป็น 0
   * ค่าพวกนี้ผ่านตาคนที่กดบันทึกเร็วได้สบาย แล้วหลุดไปถึงจดหมายที่ยื่นสายเรือ
   *
   * ค่าใช้จ่ายไม่ใช่ประเด็นเท่าที่กลัวไว้ — ชั้นนี้ถูกเรียกเฉพาะใบที่กรอบอ่านไม่ครบ
   * ซึ่งส่วนใหญ่คือใบสแกน ถ้าเดือนละ 200 ใบก็ราว 165 บาท ถูกกว่าเวลาที่เสียไปกับ
   * การพิมพ์เองทั้งใบ และถูกกว่าความเสียหายจากค่าผิดที่หลุดไปมาก
   */
  if (missingFields(result.values, KEY_FIELDS).length && aiConfigured()) {
    const started = Date.now();
    const layer: LayerResult = { layer: 'ai', values: {} };
    try {
      const ai = await readWithAi(pdf);
      layer.values = ai.values;
      layer.baht = ai.baht;
    } catch (error) {
      layer.error = error instanceof Error ? error.message : 'AI อ่านไม่สำเร็จ';
    }
    layer.ms = Date.now() - started;
    result = mergeLayer(result, layer);

    /*
     * บันทึกค่าใช้จ่ายของชั้น AI — เป็นเงินจริงที่ต้องรวมยอดย้อนหลังได้
     *
     * เดิมคำนวณแล้วโชว์บนหน้าจอครั้งเดียว พอรีเฟรชก็หาย จึงไม่มีทางรู้ว่า
     * เดือนนี้ใช้ไปเท่าไหร่แล้ว นอกจากไปเปิดดูในหน้าเรียกเก็บเงินของ Anthropic
     *
     * เก็บใน activity_log ที่มีอยู่แล้ว ไม่ต้องเพิ่มตารางใหม่
     * บันทึกแม้ตอนอ่านไม่สำเร็จด้วย เพราะเรียกไปแล้วก็เสียเงินแล้ว
     */
    try {
      await db.insert(activityLog).values({
        id: `LOG-${randomBytes(10).toString('hex').toUpperCase()}`,
        userId: user.id,
        action: AI_READ_ACTION,
        entityType: 'AI',
        entityId: null,
        detail: JSON.stringify({
          baht: Number((layer.baht ?? 0).toFixed(4)),
          ms: layer.ms,
          ok: !layer.error,
          error: layer.error ?? null,
        }),
      });
    } catch { /* บันทึกไม่ได้ก็ไม่ควรทำให้การอ่านล้มตาม */ }
  }

  /* ---------------- ชั้น OCR ---------------- */

  /*
   * ตาข่ายรับท้าย — ใช้ตอน AI ใช้ไม่ได้ (ยังไม่ได้ตั้งค่า เครดิตหมด หรือ API ล่ม)
   *
   * ฟรีก็จริง แต่แม่นแค่ครึ่งเดียวและให้ค่าผิดได้ จึงไม่ควรเป็นด่านแรก
   * ยังมีประโยชน์ตรงที่ดีกว่าไม่ได้อะไรเลย และช่องที่มันเติมจะขึ้นเตือนให้ตรวจอยู่แล้ว
   */
  if (missingFields(result.values, KEY_FIELDS).length && driveOcrConfigured()) {
    const started = Date.now();
    const layer: LayerResult = { layer: 'ocr', values: {} };
    try {
      const text = await driveOcrText(`data:application/pdf;base64,${pdf.toString('base64')}`);
      const auto = parseArrivalText(text);
      layer.values = {
        blNo: auto.blNo, vessel: auto.vessel, voyage: auto.voyage, eta: auto.eta,
        portOfLoading: auto.portOfLoading, grossWeight: auto.grossWeight,
        unitAmount: auto.unitAmount, shipperName: auto.shipperName,
        containers: auto.containers, seals: auto.seals,
      };
    } catch (error) {
      layer.error = error instanceof Error ? error.message : 'OCR ไม่สำเร็จ';
    }
    layer.ms = Date.now() - started;
    result = mergeLayer(result, layer);
  }

  return Response.json({
    ok: true,
    values: result.values,
    source: result.source,
    baht: Number(result.baht.toFixed(2)),
    // บอกว่าชั้นไหนทำอะไรไปบ้าง เอาไว้ดูตอนมีปัญหา
    layers: result.layers.map((l) => ({
      layer: l.layer, label: LAYER_LABEL[l.layer], ms: l.ms, error: l.error,
    })),
    missing: missingFields(result.values, KEY_FIELDS),
  });
}
