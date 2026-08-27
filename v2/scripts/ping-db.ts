import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL!;
  console.log('host:', new URL(url).hostname);
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20 });

  const t0 = performance.now();
  await sql`select 1`;
  console.log(`ต่อครั้งแรก + query แรก : ${(performance.now() - t0).toFixed(0)} ms`);

  const samples: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const t = performance.now();
    await sql`select 1`;
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  console.log(`select 1 (กลาง)        : ${samples[4].toFixed(0)} ms`);
  console.log(`   เร็วสุด ${samples[0].toFixed(0)} / ช้าสุด ${samples[samples.length - 1].toFixed(0)} ms`);
  await sql.end();
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
