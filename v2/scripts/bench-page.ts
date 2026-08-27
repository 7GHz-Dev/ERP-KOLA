/** วัดเวลาโหลดหน้า /pending จริง โดยสร้าง session ชั่วคราวแล้วลบทิ้ง */
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const { encodeSession } = await import('../src/lib/session-token');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const [user] = await sql<{
    id: string; username: string; display_name: string; role: string; must_change_password: boolean;
  }[]>`select id, username, display_name, role, must_change_password
       from users where is_active = true order by role = 'ADMIN' desc limit 1`;
  if (!user) throw new Error('ไม่มีผู้ใช้ในฐานข้อมูล');

  const sid = `BENCH-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await sql`
    insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
    values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')}, ${user.id},
            ${expiresAt}, now())`;

  const cookie = encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: user.role, mcp: user.must_change_password, exp: expiresAt.getTime(),
  });
  console.log(`สร้าง session ชั่วคราวให้ ${user.username}\n`);

  const hit = async (path: string) => {
    const t = performance.now();
    const res = await fetch(`http://localhost:3000${path}`, {
      headers: { cookie: `kola_session=${cookie}` },
      redirect: 'manual',
    });
    await res.text();
    return { ms: performance.now() - t, status: res.status };
  };

  for (const path of ['/pending', '/pending?stage=fn', '/pending?stage=draft', '/pending?blNo=OOLU']) {
    const samples: number[] = [];
    let status = 0;
    for (let i = 0; i < 4; i += 1) {
      const r = await hit(path);
      samples.push(r.ms);
      status = r.status;
    }
    samples.sort((a, b) => a - b);
    console.log(`  ${path.padEnd(26)} HTTP ${status}  กลาง ${samples[2].toFixed(0)} ms  (เร็วสุด ${samples[0].toFixed(0)})`);
  }

  await sql`delete from sessions where id = ${sid}`;
  console.log('\nลบ session ชั่วคราวแล้ว');
  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
