/** ทดสอบตัวอ่าน PDF กับเอกสารจริงที่อยู่ใน Storage */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const { downloadFile } = await import('../src/lib/storage');
  const { parseArrivalText } = await import('../src/lib/parse-arrival');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const rows = await sql<{ id: string; file_name: string; category: string; storage_key: string }[]>`
    select id, file_name, category, storage_key from files
    where category in ('ARRIVAL_NOTICE', 'BL')
      and storage_key not like 'drive:%'
      and (mime_type like '%pdf%' or file_name ilike '%.pdf')
    order by file_name limit 12`;

  if (!rows.length) {
    console.log('ไม่มีไฟล์ Arrival Notice / BL ที่เป็น PDF ในระบบ');
    await sql.end();
    return;
  }

  console.log(`ทดสอบกับเอกสารจริง ${rows.length} ไฟล์\n`);
  let anyField = 0;

  for (const row of rows) {
    try {
      const { body } = await downloadFile(row.storage_key);
      const doc = await pdfjs.getDocument({ data: new Uint8Array(body) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const content = await (await doc.getPage(i)).getTextContent();
        pages.push(content.items.map((it: any) => it.str ?? '').join(' '));
      }
      const r = parseArrivalText(pages.join('\n'));

      const got = [
        r.carrier && `สายเรือ=${r.carrier}`,
        r.blNo && `BL=${r.blNo}`,
        r.vessel && `เรือ=${r.vessel.slice(0, 18)}`,
        r.voyage && `เที่ยว=${r.voyage}`,
        r.eta && `ETA=${r.eta}`,
        r.grossWeight && `น้ำหนัก=${r.grossWeight}`,
        r.containers.length && `ตู้=${r.containers.length}`,
      ].filter(Boolean);

      if (got.length) anyField += 1;
      console.log(`  ${row.file_name.slice(0, 34).padEnd(36)} ${got.length ? got.join(' · ') : '— ไม่พบข้อมูลที่รู้จัก'}`);
    } catch (error: any) {
      console.log(`  ${row.file_name.slice(0, 34).padEnd(36)} อ่านไม่ได้: ${error.message}`);
    }
  }

  console.log(`\nอ่านข้อมูลได้อย่างน้อย 1 ช่อง: ${anyField}/${rows.length} ไฟล์`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
