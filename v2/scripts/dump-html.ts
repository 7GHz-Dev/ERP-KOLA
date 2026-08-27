/** ดึง HTML ของหน้าจริงมาตรวจ ใช้ตอนไล่ปัญหาโครงสร้างหน้า */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  let path = '/' + (process.env.DUMP_PATH ?? 'pending');
  const out = process.env.DUMP_OUT ?? 'dump.html';
  const { encodeSession } = await import('../src/lib/session-token');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const [user] = await sql<{
    id: string; username: string; display_name: string; must_change_password: boolean;
  }[]>`select id, username, display_name, must_change_password from users
       where is_active = true order by role = 'ADMIN' desc limit 1`;

  const sid = `DUMP-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await sql`insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
            values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')},
                    ${user.id}, ${expiresAt}, now())`;

  const cookie = encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: 'ADMIN', mcp: user.must_change_password, exp: expiresAt.getTime(),
  });

  const rounds = Number(process.env.DUMP_ROUNDS ?? 1);
  for (let i = 0; i < rounds; i += 1) {
    const t = performance.now();
    // DUMP_PATH=job/@first จะไปหยิบ id ของงานแรกมาให้เอง
  if (path.includes('@filed')) {
    const [j] = await sql`select id from jobs where customs_status = 'FILED' order by job_no limit 1`;
    path = path.replace('@filed', j.id);
  }

  const res = await fetch(`http://localhost:3000${path}`, {
      headers: { cookie: `kola_session=${cookie}` }, redirect: 'manual',
    });
    const body = await res.text();
    const ms = performance.now() - t;
    if (i === rounds - 1) writeFileSync(out, body);
    console.log(`${res.status} ${path} ${ms.toFixed(0)} ms (${body.length} bytes)`);
  }

  await sql`delete from sessions where id = ${sid}`;
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
