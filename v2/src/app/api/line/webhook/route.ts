import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog } from '@/db/schema';

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
 * บันทึก Group ID ที่เห็นลง activity_log ไม่ใช่หน่วยความจำ
 *
 * เดิมเก็บไว้ในตัวแปรของ instance ซึ่งใช้ไม่ได้จริงบน Vercel เพราะแต่ละ request
 * ไปคนละ instance ได้ — event เข้าที่ instance หนึ่ง แต่ตอนเปิดดูไปโดนอีกตัว
 * ที่ไม่มีข้อมูล แล้วดูเหมือน webhook ไม่ทำงานทั้งที่ทำงานปกติ
 *
 * ใช้ activity_log ที่มีอยู่แล้ว ไม่ต้องเพิ่มตารางใหม่ให้ของที่ใช้ครั้งเดียว
 */
const LINE_SOURCE_ACTION = 'LINE_WEBHOOK_SOURCE';

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
    const type = source.type ?? 'unknown';
    console.log(`[LINE webhook] ${type} · ${id}`);
    /*
     * บันทึกไม่ได้ก็ไม่เป็นไร ยังมี console.log ให้ดูใน Vercel Logs
     * และต้องตอบ 200 ให้ LINE เสมอ ไม่ว่าการบันทึกจะสำเร็จหรือไม่
     */
    try {
      await db.insert(activityLog).values({
        id: `LOG-${randomBytes(10).toString('hex').toUpperCase()}`,
        userId: null, action: LINE_SOURCE_ACTION,
        entityType: 'LINE', entityId: id,
        detail: JSON.stringify({ type, id }),
      });
    } catch { /* ข้ามไป */ }
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
  /*
   * ตรวจ token กับ LINE จริง ไม่ใช่แค่ดูว่ามีค่าอยู่ไหม
   *
   * token ที่ copy มาไม่ครบหรือหมดอายุจะดูเหมือนตั้งค่าแล้วทุกอย่าง
   * แล้วไปพังตอนส่งข้อความจริง ซึ่งตอนนั้นไม่มีใครเห็น เพราะการแจ้งเตือน
   * ถูกออกแบบให้ล้มเงียบ ๆ เพื่อไม่ให้กระทบการกดส่ง Partner
   */
  let bot: { ok: boolean; name?: string; error?: string } | null = null;
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const info = await res.json() as { displayName?: string; basicId?: string };
        bot = { ok: true, name: `${info.displayName ?? '-'} (${info.basicId ?? '-'})` };
      } else {
        bot = { ok: false, error: `LINE ตอบ ${res.status} — token อาจไม่ถูกต้องหรือหมดอายุ` };
      }
    } catch (error) {
      bot = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // อ่านจากฐานข้อมูล จึงเห็นค่าไม่ว่า request จะไปลงที่ instance ไหน
  let lastSeen: Array<{ type: string; id: string; at: string }> = [];
  try {
    const rows = await db.select({
      entityId: activityLog.entityId, detail: activityLog.detail,
      createdAt: activityLog.createdAt,
    }).from(activityLog)
      .where(eq(activityLog.action, LINE_SOURCE_ACTION))
      .orderBy(desc(activityLog.createdAt))
      .limit(10);
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.entityId ?? '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      let type = 'unknown';
      try { type = (JSON.parse(row.detail ?? '{}') as { type?: string }).type ?? 'unknown'; } catch { /* ใช้ค่าตั้งต้น */ }
      lastSeen.push({ type, id, at: String(row.createdAt) });
    }
  } catch {
    lastSeen = [];
  }

  return NextResponse.json({
    ok: true,
    hint: lastSeen.length
      ? 'คัดลอกค่า id ของแถว type=group ไปใส่ LINE_GROUP_ID'
      : 'ยังไม่เห็น event — เชิญ bot เข้ากลุ่ม แล้วพิมพ์อะไรก็ได้ในกลุ่มนั้น แล้วรีเฟรชหน้านี้',
    configured: {
      LINE_CHANNEL_SECRET: Boolean(process.env.LINE_CHANNEL_SECRET),
      LINE_CHANNEL_ACCESS_TOKEN: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      LINE_GROUP_ID: process.env.LINE_GROUP_ID ?? null,
    },
    bot,
    lastSeen,
  });
}
