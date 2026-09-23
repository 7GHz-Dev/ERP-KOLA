import { NextResponse } from 'next/server';

/**
 * โควต้าข้อความของ LINE — เหลือกี่ข้อความในเดือนนี้
 *
 * แผน Free ส่งได้ 200 ข้อความต่อเดือน เกินแล้วข้อความจะถูกปฏิเสธเงียบ ๆ
 * ซึ่งอันตรายกว่าที่คิด เพราะการแจ้งเตือนถูกออกแบบให้ล้มเงียบเพื่อไม่ให้กระทบ
 * การกดส่ง Partner ถ้าโควต้าหมดจึงไม่มีใครรู้จนกว่าจะสังเกตว่าไม่มีข้อความเข้ากลุ่ม
 *
 * หน้านี้เปิดดูได้ตลอดเพื่อเช็คว่าใช้ไปเท่าไหร่แล้ว
 * นับเฉพาะข้อความแบบ push (ที่ระบบส่งเอง) ข้อความตอบกลับไม่นับรวมในโควต้า
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' });
  }
  const headers = { Authorization: `Bearer ${token}` };
  const read = async (path: string) => {
    try {
      const res = await fetch(`https://api.line.me${path}`, { headers, cache: 'no-store' });
      return res.ok ? await res.json() : { error: `HTTP ${res.status}` };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const [quota, consumption] = await Promise.all([
    read('/v2/bot/message/quota'),           // โควต้าทั้งหมดของเดือน
    read('/v2/bot/message/quota/consumption'), // ใช้ไปแล้วเท่าไหร่
  ]);

  const limit = (quota as { value?: number; type?: string }).value ?? null;
  const used = (consumption as { totalUsage?: number }).totalUsage ?? null;
  const left = limit !== null && used !== null ? limit - used : null;

  return NextResponse.json({
    ok: true,
    แผน: (quota as { type?: string }).type ?? null,
    โควต้าต่อเดือน: limit,
    ใช้ไปแล้ว: used,
    คงเหลือ: left,
    เปอร์เซ็นต์ที่ใช้: limit && used !== null ? `${Math.round((used / limit) * 100)}%` : null,
    /*
     * type=none แปลว่าไม่จำกัด (แผนที่จ่ายรายเดือนบางแบบ)
     * ส่วน type=limited คือมีเพดาน ซึ่งเป็นกรณีของแผน Free
     */
    หมายเหตุ: (quota as { type?: string }).type === 'none'
      ? 'แผนนี้ไม่จำกัดจำนวนข้อความ'
      : 'นับเฉพาะข้อความที่ระบบส่งเอง (push) · รีเซ็ตทุกต้นเดือน',
    raw: { quota, consumption },
  });
}
