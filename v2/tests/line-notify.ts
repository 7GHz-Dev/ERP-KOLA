import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { lineConfigured, newJobsMessage, notifyNewJobs, pushToLine } from '../src/lib/line-notify';

/**
 * การแจ้งเตือนเข้ากลุ่ม LINE
 *
 * สิ่งที่ต้องรับประกันคือ "ส่งไม่ได้ต้องไม่ทำให้กดส่ง Partner ไม่ได้"
 * เพราะการแจ้งเตือนเป็นของเสริม ส่วนการบันทึกว่าส่งแล้วเป็นงานหลัก
 * ถ้าปล่อยให้ error เด้งขึ้นไป ผู้ใช้จะกดปุ่มไม่ได้เลยทั้งที่ข้อมูลบันทึกเรียบร้อย
 * ซึ่งเป็นความเสียหายที่หนักกว่าการไม่ได้รับแจ้งเตือนมาก
 */

const ENV = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_GROUP_ID'] as const;

function withEnv(values: Partial<Record<typeof ENV[number], string>>, run: () => Promise<void> | void) {
  const saved = ENV.map((k) => [k, process.env[k]] as const);
  for (const k of ENV) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v) process.env[k] = v;
  const restore = () => { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  const out = run();
  return out instanceof Promise ? out.finally(restore) : (restore(), out);
}

function messageTest() {
  const text = newJobsMessage([
    { blNo: 'ONEYTYO123', jobNo: 'KOLA-2026-0001', consigneeName: 'บริษัท ก',
      vessel: 'BANGKOK BRIDGE', voyage: '0518W', lastDem: '30/09/2026' },
  ], 'FAH');

  assert.match(text, /รายการใหม่รอแลก DO 1 รายการ/);
  assert.match(text, /จาก FAH/, 'ต้องบอกว่ามาจากฝั่งไหน');
  assert.match(text, /ONEYTYO123/);
  assert.match(text, /บริษัท ก/);
  assert.match(text, /BANGKOK BRIDGE \/ 0518W/);
  assert.match(text, /DEM ถึง 30\/09\/2026/, 'ต้องมีวันสุดท้ายของ DEM ไว้ดูว่าต้องรีบไหม');

  // ไม่มีเลข BL ต้องใช้ Job No. แทน ไม่ใช่ปล่อยว่างจนไม่รู้ว่าใบไหน
  const noBl = newJobsMessage([{ blNo: null, jobNo: 'KOLA-2026-0002' }], 'PAINT');
  assert.match(noBl, /KOLA-2026-0002/, 'ไม่มีเลข BL ต้องใช้ Job No. แทน');

  // ช่องที่ไม่มีค่าต้องหายไปเฉย ๆ ไม่ใช่โผล่เป็น null หรือขีดกลางลอย ๆ
  assert.doesNotMatch(noBl, /null|undefined/, 'ค่าว่างต้องไม่โผล่ในข้อความ');

  console.log('PASS: ข้อความมีข้อมูลที่ใช้ตัดสินใจได้จากในแชท');
}

function longListTest() {
  const many = Array.from({ length: 25 }, (_, i) => ({
    blNo: `BL-${i}`, jobNo: `JOB-${i}`,
  }));
  const text = newJobsMessage(many, 'FAH');

  assert.match(text, /25 รายการ/, 'หัวข้อต้องบอกจำนวนจริงทั้งหมด');
  assert.match(text, /และอีก 5 รายการ/, 'เกิน 20 ใบต้องตัดแล้วบอกจำนวนที่เหลือ');
  assert.ok(!text.includes('BL-20'), 'ใบที่ 21 เป็นต้นไปต้องไม่ถูกไล่ทั้งหมด');
  // LINE จำกัด 5,000 ตัวอักษร ข้อความต้องไม่ยาวจนโดนตัดกลางคัน
  assert.ok(text.length < 4900, 'ข้อความต้องไม่ยาวเกินที่ LINE รับ');

  console.log('PASS: รายการยาวถูกตัดพอดีและยังบอกจำนวนครบ');
}

async function notConfiguredTest() {
  /*
   * ยังไม่ได้ตั้งค่า — ต้องข้ามไปเงียบ ๆ ไม่ใช่ error
   * ไม่งั้นระบบจะใช้ไม่ได้เลยจนกว่าจะตั้งค่า LINE เสร็จ
   */
  await withEnv({}, async () => {
    assert.equal(lineConfigured(), false);
    const r = await pushToLine('ทดสอบ');
    assert.deepEqual(r, { ok: false, skipped: true }, 'ไม่ได้ตั้งค่าต้องข้าม ไม่ใช่ error');
  });

  // ตั้งค่าไม่ครบก็ถือว่ายังไม่ได้ตั้ง — ครึ่ง ๆ กลาง ๆ ยิงไปก็ได้ 401 เปล่า ๆ
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: 'x' }, () => {
    assert.equal(lineConfigured(), false, 'มีแค่ token ยังไม่พอ ต้องมี group id ด้วย');
  });

  console.log('PASS: ยังไม่ตั้งค่าแล้วข้ามไปเงียบ ๆ');
}

async function failureTest() {
  const original = globalThis.fetch;

  // LINE ตอบ error — ต้องคืนผลว่าไม่สำเร็จ ไม่ใช่ throw
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: 't', LINE_GROUP_ID: 'C1' }, async () => {
    globalThis.fetch = (async () =>
      new Response('{"message":"Invalid token"}', { status: 401 })) as typeof fetch;
    const r = await pushToLine('ทดสอบ');
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /401/, 'ต้องบอกว่า LINE ตอบอะไรกลับมา');

    // เน็ตพัง / timeout — ต้องกลืน error เองเหมือนกัน
    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    const r2 = await pushToLine('ทดสอบ');
    assert.equal(r2.ok, false);
    assert.match(r2.error ?? '', /network down/);

    // สำเร็จ
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    assert.equal((await pushToLine('ทดสอบ')).ok, true);
  });

  globalThis.fetch = original;
  console.log('PASS: ส่งไม่สำเร็จแล้วคืนผลแทนการ throw');
}

async function payloadTest() {
  const original = globalThis.fetch;
  type Sent = { url: string; body: { to: string; messages: Array<{ type: string; text: string }> }; auth: string };
  const captured: Sent[] = [];

  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_GROUP_ID: 'Cgroup' }, async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      captured.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: headers.Authorization,
      });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await notifyNewJobs([{ blNo: 'BL-1', jobNo: 'J-1' }], 'FAH');
  });
  globalThis.fetch = original;

  assert.equal(captured.length, 1, 'ต้องยิงออกไปจริงครั้งเดียว');
  const sent = captured[0];
  assert.equal(sent.url, 'https://api.line.me/v2/bot/message/push', 'ต้องเป็น endpoint ของ Messaging API');
  assert.equal(sent.auth, 'Bearer tok');
  assert.equal(sent.body.to, 'Cgroup', 'ต้องส่งเข้ากลุ่มที่ตั้งค่าไว้');
  assert.equal(sent.body.messages[0].type, 'text');
  assert.match(sent.body.messages[0].text, /BL-1/);

  // รายการว่างต้องไม่ยิงอะไรออกไปเลย
  let called = false;
  await withEnv({ LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_GROUP_ID: 'Cgroup' }, async () => {
    globalThis.fetch = (async () => { called = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
    const r = await notifyNewJobs([], 'FAH');
    assert.equal(r.skipped, true);
  });
  globalThis.fetch = original;
  assert.equal(called, false, 'ไม่มีรายการต้องไม่ยิงข้อความเปล่า');

  console.log('PASS: ยิงเข้า endpoint และกลุ่มที่ถูกต้อง');
}

/**
 * ปลายทาง webhook ที่ใช้หา Group ID เปิดสาธารณะ ใครยิงเข้ามาก็ได้
 *
 * ถ้าไม่ตรวจลายเซ็น จะมีคนยัด Group ID ปลอมเข้ามาให้เราหยิบไปใส่ config
 * แล้วการแจ้งเตือนทั้งหมดจะไปออกกลุ่มของคนอื่น ซึ่งเป็นข้อมูลงานของลูกค้า
 */
async function webhookSignatureTest() {
  const secret = 'test-secret';
  const saved = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = secret;

  const { POST } = await import('../src/app/api/line/webhook/route');
  const body = JSON.stringify({
    events: [{ source: { type: 'group', groupId: 'Cabc123' } }],
  });
  const sign = (text: string, key: string) =>
    createHmac('sha256', key).update(text).digest('base64');

  const call = (payload: string, signature: string | null) =>
    POST(new Request('https://example.com/api/line/webhook', {
      method: 'POST',
      body: payload,
      headers: signature ? { 'x-line-signature': signature } : {},
    }));

  // ลายเซ็นถูกต้อง — ต้องรับ
  assert.equal((await call(body, sign(body, secret))).status, 200, 'ลายเซ็นถูกต้องต้องรับ');

  // ไม่มีลายเซ็น / ลายเซ็นผิด / เซ็นด้วยคีย์อื่น — ต้องปฏิเสธทั้งหมด
  assert.equal((await call(body, null)).status, 401, 'ไม่มีลายเซ็นต้องปฏิเสธ');
  assert.equal((await call(body, 'bm90LWEtc2lnbmF0dXJl')).status, 401, 'ลายเซ็นผิดต้องปฏิเสธ');
  assert.equal((await call(body, sign(body, 'another-secret'))).status, 401,
    'เซ็นด้วยคีย์อื่นต้องปฏิเสธ');

  /*
   * เนื้อหาถูกแก้หลังเซ็น — ต้องปฏิเสธ
   * เป็นกรณีที่ลายเซ็นถูกต้องกับ body เดิม แต่ body ที่ส่งมาจริงไม่ใช่ตัวนั้น
   */
  const other = JSON.stringify({ events: [{ source: { type: 'group', groupId: 'Cfake999' } }] });
  assert.equal((await call(other, sign(body, secret))).status, 401,
    'แก้เนื้อหาหลังเซ็นต้องปฏิเสธ');

  // ไม่ได้ตั้ง secret — ตรวจไม่ได้ ต้องปฏิเสธทุกอย่าง ไม่ใช่ปล่อยผ่าน
  delete process.env.LINE_CHANNEL_SECRET;
  assert.equal((await call(body, sign(body, secret))).status, 401,
    'ไม่ได้ตั้ง secret ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน');

  if (saved === undefined) delete process.env.LINE_CHANNEL_SECRET;
  else process.env.LINE_CHANNEL_SECRET = saved;
  console.log('PASS: webhook รับเฉพาะคำขอที่ LINE เซ็นมาจริง');
}

async function main() {
  messageTest();
  longListTest();
  await notConfiguredTest();
  await failureTest();
  await payloadTest();
  await webhookSignatureTest();
  console.log('\nทั้งหมดผ่าน');
}

main().catch((e) => { console.error('ล้มเหลว:', e); process.exit(1); });
