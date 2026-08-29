/** เปิดทุกหน้าด้วย session จริง ตรวจว่าไม่มีหน้าไหนพัง */
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const PATHS = [
  '/overview', '/intake/an', '/intake/bl', '/pending', '/pending?tab=fn', '/pending?tab=draft', '/pending?tab=edoc',
  '/pending?tab=bl&sub=approve', '/pending?blNo=OOLU', '/pending?sortBy=eta&sortDir=asc',
  '/fah/do', '/fah/fn', '/fah/draft', '/fah/draft?tab=waiting', '/fah/draft?tab=done',
  '/nam/approve', '/nam/customer', '/nam/release',
  '/automation', '/automation?tab=customs',
  '/master', '/master?type=settings', '/master?type=terminals&q=A',
  '/master/eoffice', '/api/eoffice/form-preview',
  '/jobs', '/jobs?tab=active', '/jobs?tab=done', '/jobs?blNo=OOLU',
];

async function main() {
  const { encodeSession } = await import('../src/lib/session-token');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const [user] = await sql<{
    id: string; username: string; display_name: string; must_change_password: boolean;
  }[]>`select id, username, display_name, must_change_password from users
       where is_active = true order by role = 'ADMIN' desc limit 1`;

  const sid = `SMOKE-${randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 600_000);
  await sql`insert into sessions (id, token_hash, user_id, expires_at, last_seen_at)
            values (${sid}, ${createHash('sha256').update(randomBytes(32)).digest('hex')},
                    ${user.id}, ${expiresAt}, now())`;

  // ทดสอบเป็น ADMIN เพื่อให้เข้าได้ทุกหน้าในรอบเดียว
  const cookie = encodeSession({
    sid, uid: user.id, username: user.username, name: user.display_name,
    role: 'ADMIN', mcp: user.must_change_password, exp: expiresAt.getTime(),
  });

  // หน้าที่ต้องมี id จริง เติมทีหลังเพราะต้องถามฐานข้อมูลก่อน
  const [anyJob] = await sql<{ id: string }[]>`select id from jobs limit 1`;
  const [anyEoffice] = await sql<{ job_id: string }[]>`select job_id from eoffice_requests limit 1`;
  const paths = [...PATHS];
  if (anyJob) paths.push(`/job/${anyJob.id}`);
  if (anyEoffice) paths.push(`/eoffice/${anyEoffice.job_id}`);

  let failed = 0;
  const times: number[] = [];
  for (const path of paths) {
    const t = performance.now();
    const res = await fetch(`http://localhost:3000${path}`, {
      headers: { cookie: `kola_session=${cookie}` }, redirect: 'manual',
    });
    const body = await res.text();
    const ms = performance.now() - t;
    times.push(ms);

    const broken = res.status !== 200 || /Application error|Internal Server Error/i.test(body);
    if (broken) failed += 1;
    console.log(`  ${broken ? 'พัง ' : 'ผ่าน'} ${String(res.status)} ${path.padEnd(34)} ${ms.toFixed(0)} ms`);
    if (broken) console.log(`       ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  }

  times.sort((a, b) => a - b);
  console.log(`\nกลาง ${times[Math.floor(times.length / 2)].toFixed(0)} ms · เร็วสุด ${times[0].toFixed(0)} · ช้าสุด ${times[times.length - 1].toFixed(0)}`);
  console.log(failed ? `\nมี ${failed} หน้าที่พัง` : `\nPASS: ทั้ง ${PATHS.length} หน้าทำงานได้`);

  await sql`delete from sessions where id = ${sid}`;
  await sql.end();
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
