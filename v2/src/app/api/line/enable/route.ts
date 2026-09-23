import { NextResponse } from 'next/server';

/**
 * เปิดสวิตช์ Use webhook ผ่าน API — ใช้ตอนติดตั้งเท่านั้น
 *
 * หน้าจอของ LINE ย้ายที่บ่อยและบางบัญชีไม่มีสวิตช์นี้ให้กดเลย
 * แต่ API เปิดได้ตรง ๆ จึงตัดปัญหา "หาปุ่มไม่เจอ" ออกไปทั้งหมด
 *
 * เรียกด้วย POST เท่านั้น เพราะเป็นการเปลี่ยนการตั้งค่าฝั่ง LINE
 * ไม่ใช่การอ่านค่า จึงไม่ควรเกิดขึ้นเพราะมีคนเผลอเปิด URL ด้วยเบราว์เซอร์
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' });
  }
  const auth = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  /*
   * ตั้ง endpoint ใหม่ด้วยเสมอ — การ PUT endpoint จะเปิด active ให้เองในตัว
   * ซึ่งเชื่อถือได้กว่าการสั่งเปิดสวิตช์แยก เพราะบางบัญชีไม่มี endpoint
   * บันทึกไว้เลย แล้วการสั่งเปิดเฉย ๆ จะล้มโดยไม่บอกสาเหตุที่ชัดเจน
   */
  const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://erp-kola.vercel.app';
  const endpoint = `${origin}/api/line/webhook`;

  const put = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    method: 'PUT', headers: auth, body: JSON.stringify({ endpoint }),
  });
  const putBody = await put.json().catch(() => ({}));

  const after = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  const state = await after.json().catch(() => ({}));

  return NextResponse.json({
    ok: put.ok,
    setTo: endpoint,
    putStatus: put.status,
    putBody,
    current: state,
    hint: put.ok
      ? 'เปิดแล้ว — พิมพ์ในกลุ่มอีกครั้งแล้วเปิด /api/line/webhook ดู Group ID'
      : 'เปิดไม่สำเร็จ ดู putBody ว่า LINE บอกอะไร',
  });
}
