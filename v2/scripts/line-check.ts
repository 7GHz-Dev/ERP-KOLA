/**
 * ตรวจการตั้งค่า LINE แล้วยิงข้อความทดสอบเข้ากลุ่ม
 *
 *   npx tsx scripts/line-check.ts
 *
 * บอกให้ชัดว่าติดตรงไหน เพราะ error ของ LINE เป็นภาษาอังกฤษสั้น ๆ
 * อย่าง "Invalid reply token" ซึ่งอ่านไม่ออกว่าต้องแก้อะไร
 */
import { loadEnv } from '../src/lib/env';

loadEnv();

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const group = process.env.LINE_GROUP_ID;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!token) fail('ไม่พบ LINE_CHANNEL_ACCESS_TOKEN ใน .env.local\n  ขอได้ที่ https://developers.line.biz/console/ -> channel -> Messaging API -> Channel access token');
  if (!group) fail('ไม่พบ LINE_GROUP_ID ใน .env.local\n  เชิญ bot เข้ากลุ่มก่อน แล้วดู source.groupId จาก webhook event');

  // ตรวจ token ก่อนว่าใช้ได้ไหม แยกจากปัญหาเรื่องกลุ่ม จะได้รู้ว่าติดตรงไหน
  const info = await fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!info.ok) {
    fail(`Token ใช้ไม่ได้ (LINE ตอบ ${info.status})\n  ${await info.text()}\n  ลอง Issue token ใหม่ที่หน้า Messaging API`);
  }
  const bot = await info.json() as { displayName?: string; basicId?: string };
  console.log(`✓ Token ใช้ได้ — bot ชื่อ "${bot.displayName}" (${bot.basicId})`);

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to: group,
      messages: [{ type: 'text', text: '✅ ทดสอบการแจ้งเตือนจาก KOLA ERP — ตั้งค่าเรียบร้อยแล้ว' }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403) {
      fail(`ส่งเข้ากลุ่มไม่ได้ (403)\n  ${detail}\n  มักเกิดจาก bot ยังไม่ได้ถูกเชิญเข้ากลุ่มนี้ หรือ LINE_GROUP_ID ผิด`);
    }
    fail(`ส่งไม่สำเร็จ (LINE ตอบ ${res.status})\n  ${detail}`);
  }
  console.log(`✓ ส่งข้อความทดสอบเข้ากลุ่ม ${group} แล้ว — ไปดูในกลุ่มได้เลย`);
  console.log('\nพร้อมใช้งาน');
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
