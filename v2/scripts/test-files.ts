/** ทดสอบว่าเปิดไฟล์ที่ย้ายเข้า Storage แล้วได้จริง และคนไม่ล็อกอินเปิดไม่ได้ */
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const { encodeSession } = await import('../src/lib/session-token');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const [user] = await sql<{ id: string; username: string; display_name: string }[]>`
    select id, username, display_name from users where is_active = true order by role = 'ADMIN' desc limit 1`;
  const sid = `FTEST-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await sql`insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
            values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')},
                    ${user.id}, ${expiresAt}, now())`;
  const cookie = encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: 'ADMIN', mcp: false, exp: expiresAt.getTime(),
  });

  const samples = await sql<{ id: string; file_name: string; size_bytes: number; mime_type: string }[]>`
    select id, file_name, size_bytes, mime_type from files
    where storage_key not like 'drive:%' order by size_bytes desc limit 5`;

  let failed = 0;
  for (const f of samples) {
    const t = performance.now();
    const res = await fetch(`http://localhost:3000/files/${f.id}`, {
      headers: { cookie: `kola_session=${cookie}` },
    });
    const body = Buffer.from(await res.arrayBuffer());
    const sizeOk = body.length === f.size_bytes;
    const ok = res.status === 200 && sizeOk;
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ผ่าน' : 'พัง '} ${String(res.status)} ${f.file_name.slice(0, 42).padEnd(44)} ` +
      `${body.length} bytes ${sizeOk ? '(ตรง)' : `(คาด ${f.size_bytes})`} ${(performance.now() - t).toFixed(0)} ms`);
  }

  // ไม่ล็อกอินต้องเปิดไม่ได้
  const anon = await fetch(`http://localhost:3000/files/${samples[0].id}`);
  const blocked = anon.status === 401;
  console.log(`\n  ${blocked ? 'ผ่าน' : 'พัง '} ไม่ล็อกอินแล้วเปิดไฟล์ -> HTTP ${anon.status}`);
  if (!blocked) failed += 1;

  await sql`delete from sessions where id = ${sid}`;
  await sql.end();
  console.log(failed ? `\nมี ${failed} เคสไม่ผ่าน` : '\nPASS: เปิดไฟล์ได้ถูกต้อง และกันคนไม่ล็อกอินได้');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
