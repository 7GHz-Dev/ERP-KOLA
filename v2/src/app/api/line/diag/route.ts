import { NextResponse } from 'next/server';

/**
 * ตรวจว่า LINE จำการตั้งค่า webhook ไว้ว่าอะไร — ใช้ตอนติดตั้งเท่านั้น
 *
 * ตอนตั้งค่าแล้วไม่มี event เข้ามา ปัญหาอยู่ได้สองฝั่งและแยกจากกันไม่ออก
 * จากหน้าจอ — LINE ยังไม่ได้เปิด webhook หรือใส่ URL ผิด กับฝั่งเราไม่ได้รับ
 * หน้านี้ถาม LINE ตรง ๆ ว่าจำอะไรไว้ แล้วให้ LINE ลองยิงมาหาเราจริง ๆ ด้วย
 *
 * ไม่เปิดเผยค่าลับใด ๆ คืนแค่ URL ที่ตั้งไว้กับผลการทดสอบ
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' });
  }
  const auth = { Authorization: `Bearer ${token}` };

  const read = async (path: string) => {
    try {
      const res = await fetch(`https://api.line.me${path}`, { headers: auth, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    } catch (error) {
      return { status: 0, body: { error: error instanceof Error ? error.message : String(error) } };
    }
  };

  const endpoint = await read('/v2/bot/channel/webhook/endpoint');

  /*
   * ให้ LINE ลองยิงมาหาเราจริง ๆ
   * เป็นวิธีเดียวที่พิสูจน์ได้ว่าเส้นทางจาก LINE มาถึงเราใช้งานได้
   * ไม่ใช่แค่ URL สะกดถูก
   */
  let test: { status: number; body: unknown } | null = null;
  if (endpoint.status === 200) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      test = { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (error) {
      test = { status: 0, body: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  return NextResponse.json({
    ok: true,
    webhookEndpoint: endpoint,
    webhookTest: test,
    hint: 'ดู webhookEndpoint.body.endpoint ว่าตรงกับ /api/line/webhook ไหม '
      + 'และ active ต้องเป็น true · webhookTest.body.success ต้องเป็น true',
  });
}
