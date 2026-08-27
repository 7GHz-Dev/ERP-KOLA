/**
 * ตรวจ DATABASE_URL ว่าต่อได้จริงไหม และบอกสาเหตุให้ตรงจุด
 *
 * error ของ Supabase pooler มักขึ้นเป็น XX000 / FATAL เฉย ๆ ซึ่งไม่บอกอะไร
 * สคริปต์นี้แปลให้เป็นภาษาคนพร้อมวิธีแก้
 *
 *   npx tsx scripts/check-db.ts
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ไม่พบ DATABASE_URL ใน .env.local');
  process.exit(1);
}

/* ---------- ตรวจรูปแบบก่อนต่อจริง ---------- */

function inspect(raw: string) {
  const problems: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push('รูปแบบ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย postgresql://');
    return { parsed: null, problems };
  }

  const user = decodeURIComponent(parsed.username || '');
  const host = parsed.hostname;
  const port = parsed.port;
  const password = parsed.password;

  console.log('ค่าที่อ่านได้จาก DATABASE_URL:');
  console.log(`   host     : ${host}`);
  console.log(`   port     : ${port || '(ไม่ระบุ)'}`);
  console.log(`   user     : ${user}`);
  console.log(`   database : ${parsed.pathname.replace('/', '')}`);
  console.log(`   password : ${password ? `ใส่แล้ว (${password.length} ตัวอักษร)` : 'ยังไม่ได้ใส่'}`);
  console.log('');

  const isPooler = host.includes('pooler.supabase.com');

  if (!password) {
    problems.push('ยังไม่ได้ใส่รหัสผ่าน — ต้องแทนที่ [YOUR-PASSWORD] ด้วยรหัส database จริง');
  }
  if (password && /[@#?/[\]]/.test(decodeURIComponent(password)) && password === decodeURIComponent(password)) {
    problems.push(
      'รหัสผ่านมีอักขระพิเศษ (@ # ? / [ ]) ที่ยังไม่ได้เข้ารหัส URL\n' +
        '       ตัวอย่าง: @ ต้องเขียนเป็น %40, # เป็น %23',
    );
  }
  if (isPooler && !user.includes('.')) {
    problems.push(
      'ใช้ pooler แต่ user เป็น "postgres" เฉย ๆ\n' +
        '       pooler ต้องใช้รูปแบบ postgres.<project-ref> เช่น postgres.abcdefghijklm\n' +
        '       คัดลอกจาก Supabase → Project Settings → Database → Connection string → แท็บ Transaction pooler',
    );
  }
  if (isPooler && port === '5432') {
    problems.push('host เป็น pooler แต่ port เป็น 5432 — Transaction pooler ต้องใช้ port 6543');
  }
  if (!isPooler && port === '6543') {
    problems.push('port 6543 เป็นของ pooler แต่ host ไม่ใช่ pooler — คัดลอก connection string มาไม่ครบ');
  }
  // ค่าตัวอย่างจาก .env.example ที่ยังไม่ได้แทนที่ — เจอบ่อยที่สุด
  const placeholders: string[] = [];
  if (/^postgres\.x+$/i.test(user)) placeholders.push(`user ยังเป็น ${user}`);
  if (decodeURIComponent(password) === 'PASSWORD') placeholders.push('password ยังเป็นคำว่า PASSWORD');
  if (raw.includes('xxxx')) placeholders.push('ยังมี xxxx ค้างอยู่ใน URL');
  if (placeholders.length) {
    problems.push(
      [
        'ยังใช้ค่าตัวอย่างจาก .env.example อยู่ ไม่ได้แทนที่ด้วยค่าจริง:',
        ...placeholders.map((x) => '       - ' + x),
        '       คัดลอกทั้งบรรทัดใหม่จาก Supabase → Project Settings → Database',
        '       → Connection string → แท็บ Transaction pooler แล้วแทนรหัสผ่านจริง',
      ].join('\n'),
    );
  }
  if (raw.includes('[') || raw.includes(']')) {
    problems.push('ยังมีวงเล็บ [ ] ค้างอยู่ใน URL — ต้องแทนที่ placeholder ให้หมด');
  }

  return { parsed, problems };
}

const { problems } = inspect(url);

if (problems.length) {
  console.error('พบปัญหาในรูปแบบ DATABASE_URL:\n');
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
  console.error('');
  process.exit(1);
}

async function connect(url: string) {
  /* ---------- ต่อจริง ---------- */

  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });

  try {
    const [row] = await sql<{ version: string; now: Date }[]>`select version(), now() as now`;
    console.log('ต่อฐานข้อมูลสำเร็จ');
    console.log(`   ${row.version.split(',')[0]}`);
    console.log(`   เวลาเซิร์ฟเวอร์: ${row.now.toISOString()}`);

    const tables = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.tables where table_schema = 'public'`;
    console.log(`   ตารางใน schema public: ${tables[0].count}`);
    if (tables[0].count === 0) console.log('\n   ยังไม่มีตาราง — รัน npm run db:push ต่อได้เลย');
    await sql.end();
  } catch (error: any) {
    const message = String(error?.message ?? error);
    console.error('\nต่อฐานข้อมูลไม่สำเร็จ');
    console.error(`   ข้อความจากเซิร์ฟเวอร์: ${message}`);
    console.error(`   รหัส: ${error?.code ?? '-'}\n`);

    if (/tenant.*not found|Tenant or user not found/i.test(message)) {
      console.error('สาเหตุ: pooler หา project ไม่เจอจาก username');
      console.error('วิธีแก้: user ต้องเป็น postgres.<project-ref> ไม่ใช่ postgres เฉย ๆ');
      console.error('        คัดลอกใหม่จากแท็บ Transaction pooler ใน Supabase');
    } else if (/password authentication failed/i.test(message)) {
      console.error('สาเหตุ: รหัสผ่าน database ไม่ถูกต้อง');
      console.error('วิธีแก้: Supabase → Project Settings → Database → Reset database password');
      console.error('        ถ้ารหัสมีอักขระพิเศษ ต้องเข้ารหัส URL ก่อน (@ = %40)');
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
      console.error('สาเหตุ: หา host ไม่เจอ — พิมพ์ชื่อ host ผิด หรือเน็ตมีปัญหา');
    } else if (/ETIMEDOUT|ECONNREFUSED/i.test(message)) {
      console.error('สาเหตุ: ต่อไม่ติด — อาจโดน firewall บล็อก หรือ project ถูก pause อยู่');
      console.error('วิธีแก้: เช็คว่า project ยัง active ที่หน้า Supabase dashboard');
    } else {
      console.error('ลองคัดลอก connection string ใหม่จาก Supabase แล้วรันคำสั่งนี้อีกครั้ง');
    }
    await sql.end({ timeout: 1 }).catch(() => {});
    process.exit(1);
  }

}

connect(url);
