import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * รับ webhook จาก LINE — มีไว้หา Group ID เป็นหลัก
 *
 * LINE ไม่มีหน้าจอให้ดู Group ID ตรง ๆ วิธีเดียวที่ได้มาคือให้ bot รับ event
 * จากกลุ่มแล้วอ่าน source.groupId ออกมา หน้านี้จึงพิมพ์ค่าลง log ให้เห็นชัด ๆ
 *
 * ตั้งค่าครั้งเดียวตอนติดตั้ง:
 *   1) LINE Console -> Messaging API -> Webhook URL ใส่ URL ของหน้านี้
 *   2) เปิด Use webhook
 *   3) พิมพ์อะไรก็ได้ในกลุ่มที่เชิญ bot ไว้
 *   4) ดู Group ID ได้สองทาง — Vercel -> Logs หรือเปิด URL นี้ด้วย GET
 *
 * เสร็จแล้วปิด Use webhook ได้ การแจ้งเตือนไม่ได้ใช้ webhook
 * เพราะเป็นการส่งออกทางเดียว (push) ไม่ต้องรับอะไรกลับมา
 */

export const dynamic = 'force-dynamic';

/*
 * Group ID ที่เพิ่งเห็นล่าสุด — เก็บในหน่วยความจำของ instance เท่านั้น
 *
 * ไม่เก็บลงฐานข้อมูลเพราะใช้ครั้งเดียวตอนติดตั้ง แล้วค่าจริงไปอยู่ใน
 * environment variable ถาวร การเพิ่มตารางให้ของที่ใช้ครั้งเดียวไม่คุ้ม
 *
 * ผลข้างเคียงคือถ้า serverless instance ถูกรีไซเคิล ค่าจะหาย
 * ให้พิมพ์ในกลุ่มใหม่อีกทีแล้วรีบเปิดดู หรืออ่านจาก Vercel Logs ซึ่งอยู่ถาวรกว่า
 */
let lastSeen: Array<{ type: string; id: string; at: string }> = [];

/**
 * ตรวจลายเซ็นว่ามาจาก LINE จริง
 *
 * ปลายทางนี้เปิดสาธารณะ ใครยิงเข้ามาก็ได้ ถ้าไม่ตรวจก็จะมีคนยัด Group ID ปลอม
 * เข้ามาให้เราหยิบไปใส่ config แล้วแจ้งเตือนไปออกกลุ่มของคนอื่น
 *
 * LINE เซ็นด้วย channel secret ไม่ใช่ access token — คนละค่ากัน
 */
function verify(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  // ไม่ได้ตั้ง secret ไว้ก็ตรวจไม่ได้ ปฏิเสธทุกอย่างดีกว่ารับของปลอม
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // เทียบแบบเวลาคงที่ กัน timing attack เหมือนที่ตรวจ session token
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verify(raw, request.headers.get('x-line-signature'))) {
    return NextResponse.json({ ok: false, error: 'ลายเซ็นไม่ถูกต้อง' }, { status: 401 });
  }

  let events: Array<{ source?: { type?: string; groupId?: string; roomId?: string; userId?: string } }> = [];
  try {
    events = (JSON.parse(raw) as { events?: typeof events }).events ?? [];
  } catch {
    // LINE ยิง body ว่างมาตอนกดปุ่ม Verify ในหน้า Console ซึ่งถือว่าปกติ
    return NextResponse.json({ ok: true });
  }

  for (const event of events) {
    const source = event.source ?? {};
    const id = source.groupId ?? source.roomId ?? source.userId;
    if (!id) continue;
    const entry = { type: source.type ?? 'unknown', id, at: new Date().toISOString() };
    // เก็บ 5 รายการล่าสุดพอ เผื่อมีหลายกลุ่มส่งเข้ามาปนกันตอนตั้งค่า
    lastSeen = [entry, ...lastSeen.filter((x) => x.id !== id)].slice(0, 5);
    console.log(`[LINE webhook] ${entry.type} · ${id}`);
  }

  // ต้องตอบ 200 เสมอ ไม่งั้น LINE จะปิด webhook ให้เองเมื่อพลาดหลายครั้งติดกัน
  return NextResponse.json({ ok: true });
}

/**
 * เปิดด้วยเบราว์เซอร์เพื่อดู Group ID ที่เพิ่งเห็น
 *
 * ไม่ต้องมีสิทธิ์อะไรเพราะเปิดเผยแค่ Group ID ซึ่งเอาไปทำอะไรไม่ได้
 * ถ้าไม่มี access token กับ channel secret อยู่ในมือด้วย
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: lastSeen.length
      ? 'คัดลอกค่า id ของแถว type=group ไปใส่ LINE_GROUP_ID'
      : 'ยังไม่เห็น event — พิมพ์อะไรก็ได้ในกลุ่มที่เชิญ bot ไว้ แล้วรีเฟรชหน้านี้',
    configured: {
      LINE_CHANNEL_SECRET: Boolean(process.env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      LINE_GROUP_ID: process.env.LINE_GROUP_ID ?? null,
    },
    lastSeen,
  });
}
