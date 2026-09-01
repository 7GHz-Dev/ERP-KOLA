/**
 * วัดความแม่นของตัวอ่าน AN / BL กับเอกสารจริงที่ปกปิดข้อมูลแล้ว
 *
 * รันด้วย:  npx tsx --tsconfig tsconfig.json tests/parse-accuracy.ts
 *
 * ใช้เป็นตาข่ายกันพลาด — แก้ pattern ให้สายเรือหนึ่งแล้วอีกสายพังเป็นเรื่องปกติมาก
 * ตัวเลขที่ได้ต้อง "ไม่ต่ำกว่า" ของเดิมเสมอ ถ้าต่ำลงแปลว่าแก้แล้วทำของเดิมพัง
 *
 * วิธีเพิ่มเอกสารใหม่: ดูขั้นตอนใน docs/PARSER-ACCURACY.md
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArrivalText } from '../src/lib/parse-arrival';

const DIR = path.join(process.cwd(), 'tests', 'fixtures', 'arrival');

/**
 * ค่าที่ถูกต้องเท่าที่ตรวจด้วยตาแล้ว — เว้นช่องไหนไว้แปลว่ายังไม่ได้ตรวจ
 * ไม่ใช่ว่าอ่านไม่ได้ ช่องที่ตรวจแล้วเท่านั้นที่ถูกนับเป็นคะแนนความถูกต้อง
 */
const EXPECTED: Record<string, Partial<Record<'vessel' | 'voyage' | 'grossWeight' | 'portOfLoading' | 'eta' | 'shipperName', string>>> = {
  '3_ARRIVAL_NOTICE_maersk': {
    vessel: 'MAERSK NAMSOS', voyage: '620S', grossWeight: '7600', portOfLoading: 'HAKATA,JAPAN',
  },
  '11_ARRIVAL_NOTICE_oocl': {
    vessel: 'BRIGHT TSUBAKI', voyage: '031S', grossWeight: '11510', portOfLoading: 'NAGOYA',
  },
  '4_BL_oocl': {
    vessel: 'BRIGHT TSUBAKI', voyage: '031S', grossWeight: '11510', portOfLoading: 'NAGOYA',
  },
  '8_ARRIVAL_NOTICE_one': {
    vessel: 'BROOKLYN BRIDGE', voyage: '0183W', grossWeight: '16350',
  },
  '1_ARRIVAL_NOTICE_EVERGR_1.PDF': {
    vessel: 'EVER BEING', voyage: '0849-071N', eta: '2026-06-01',
  },
  '13_ARRIVAL_NOTICE_DB_aabhiehiceij0x0376': {
    vessel: 'MARTIN SCHULTE', voyage: '628S', portOfLoading: 'OSAKA',
  },
  '10_ARRIVAL_NOTICE_shanghai_jinjiang': {
    // ใบนี้ชื่อเรือติดกับช่อง ATTN พอดี ตอนปกปิดข้อมูลจึงกลายเป็น "CONTACT XIU HONG"
    // ของจริงคือ "HAKATA XIU HONG" — ที่ทดสอบคือตัวจับยังตัดคำหน้าออกได้ถูกตำแหน่ง
    vessel: 'CONTACT XIU HONG', voyage: '2620W', grossWeight: '7000',
  },
};

const FIELDS = ['vessel', 'voyage', 'grossWeight', 'portOfLoading', 'eta', 'blNo', 'shipperName'] as const;

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.txt')).sort();
  const filled: Record<string, number> = {};
  let checked = 0;
  let correct = 0;
  const wrong: string[] = [];

  for (const f of files) {
    const parsed = parseArrivalText(await readFile(path.join(DIR, f), 'utf8'));
    for (const key of FIELDS) if (parsed[key]) filled[key] = (filled[key] ?? 0) + 1;

    const want = EXPECTED[f.replace(/\.txt$/, '')];
    if (!want) continue;
    for (const [key, value] of Object.entries(want)) {
      checked += 1;
      const got = String(parsed[key as (typeof FIELDS)[number]] ?? '');
      if (got === value) correct += 1;
      else wrong.push(`${f} · ${key}: ได้ ${JSON.stringify(got)} ควรเป็น ${JSON.stringify(value)}`);
    }
  }

  console.log(`เอกสารทดสอบ ${files.length} ใบ\n`);
  console.log('อ่านได้กี่ใบ (ยังไม่ตัดสินว่าถูกหรือผิด)');
  for (const key of FIELDS) {
    console.log(`  ${key.padEnd(14)} ${filled[key] ?? 0}/${files.length}`);
  }
  console.log(`\nค่าที่ตรวจด้วยตาแล้ว: ถูก ${correct}/${checked}`);
  if (wrong.length) {
    console.log('\nที่ยังไม่ตรง:');
    for (const line of wrong) console.log(`  ${line}`);
  }
  process.exit(wrong.length ? 1 : 0);
}

void main();
