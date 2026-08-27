/** เทียบจำนวนแถวต้นทางกับปลายทางทีละตาราง หาว่ามีอะไรหายระหว่างย้าย */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const MASTER_MAP: Record<string, string> = {
  MD_SHIPPERS: 'shippers', MD_CONSIGNEES: 'consignees', MD_NOTIFY: 'notify',
  MD_PEOPLE: 'people', MD_PORTS: 'ports', MD_TERMINALS: 'terminals',
  MD_JOB_TYPES: 'jobTypes', MD_LOADING_TYPES: 'loadingTypes',
  MD_CONTAINER_TYPES: 'containerTypes', MD_PACKAGE_TYPES: 'packageTypes',
  MD_SETTINGS: 'settings',
};

async function call(fn: string, args: unknown[]) {
  const res = await fetch(process.env.LEGACY_EXEC_URL!, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args }), redirect: 'follow',
  });
  const body = await res.json();
  if (!body.ok) throw new Error(String(body.error));
  return body.data;
}

async function main() {
  const login = await call('authLogin', [process.env.LEGACY_ADMIN_USERNAME, process.env.LEGACY_ADMIN_PASSWORD]);
  const dump = await call('exportAllData', [login.token, []]);
  const T = dump.tables as Record<string, any[]>;
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  let issues = 0;
  console.log('เทียบ master แต่ละชนิด:\n');
  for (const [sheet, type] of Object.entries(MASTER_MAP)) {
    const source = T[sheet] ?? [];
    const [{ c }] = await sql<{ c: number }[]>`
      select count(*)::int as c from master_records where type = ${type}`;
    const flag = source.length === c ? '   ' : ' ! ';
    if (source.length !== c) issues += 1;
    console.log(`${flag}${type.padEnd(16)} ต้นทาง ${String(source.length).padStart(3)}  ปลายทาง ${String(c).padStart(3)}`);

    if (source.length !== c) {
      // หาแถวที่หาย โดยเทียบ id
      const ids = await sql<{ id: string }[]>`select id from master_records where type = ${type}`;
      const have = new Set(ids.map((r) => r.id));
      const missing = source.filter((r) => !have.has(String(r.id)));
      missing.forEach((r) => console.log(`      หาย: id=${r.id} code=${JSON.stringify(r.code)} name=${JSON.stringify(r.name)}`));

      // เช็คว่าซ้ำกับแถวไหน
      for (const m of missing) {
        const dup = source.filter((r) =>
          String(r.code ?? '').trim().toUpperCase() === String(m.code ?? '').trim().toUpperCase());
        if (dup.length > 1) {
          console.log(`      สาเหตุ: code "${m.code}" ซ้ำกัน ${dup.length} แถวในต้นทาง`);
          dup.forEach((d) => console.log(`         - id=${d.id} name=${JSON.stringify(d.name)}`));
        }
      }
    }
  }

  console.log(issues ? `\nพบ ${issues} ชนิดที่จำนวนไม่ตรง` : '\nจำนวนตรงกันทุกชนิด');
  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
