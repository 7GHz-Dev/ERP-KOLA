/**
 * ทดลองอ่าน AN/BL ด้วยวิธีใหม่ แล้ววัดว่าแม่นกว่าของเดิมจริงไหม
 *
 * ตอบคำถามเดียว — "ใบที่ตอนนี้อ่านไม่ได้ วิธีใหม่อ่านได้กี่ช่อง"
 * และ "ใบที่อ่านได้อยู่แล้ว วิธีใหม่ทำให้แย่ลงหรือเปล่า"
 *
 * เทียบ 3 วิธีกับเอกสารใบเดียวกัน
 *   เดิม    ตัวอ่าน regex + กรอบ (ที่ใช้อยู่ตอนนี้)
 *   drive   ส่งไฟล์เข้า Google Drive OCR แล้วเอาข้อความมาเข้าตัวอ่านเดิม
 *   claude  ส่งไฟล์ให้ Claude อ่านให้ตรง ๆ
 *
 * รัน:
 *   npx tsx --tsconfig tsconfig.json scripts/try-ocr-ai.ts <โฟลเดอร์> --drive
 *   npx tsx --tsconfig tsconfig.json scripts/try-ocr-ai.ts <โฟลเดอร์> --claude
 *   npx tsx --tsconfig tsconfig.json scripts/try-ocr-ai.ts <โฟลเดอร์> --drive --claude
 *
 * ไม่แตะฐานข้อมูล ไม่บันทึกอะไร — เป็นการทดลองล้วน ๆ
 *
 * ต้องตั้งค่าก่อนใช้
 *   --drive   GOOGLE_OAUTH_* ใน .env.local (ดู .env.example · ขอด้วย scripts/google-oauth.mts)
 *   --claude  ANTHROPIC_API_KEY ใน .env.local
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';
import { parseArrivalText } from '../src/lib/parse-arrival';
import { driveOcrConfigured, driveOcrText } from '../src/lib/drive-ocr';
import { readWithAi } from '../src/lib/read-ai';
import {
  combineRead, matchTemplate, type ParseTemplate, type TextPiece,
} from '../src/lib/parse-template';

loadEnv();

/* ---------------- ค่าที่ถูกต้อง สำหรับให้คะแนน ---------------- */

/**
 * เฉลยของแต่ละใบ — อ่านด้วยตาจากเอกสารจริง
 *
 * ช่องไหนไม่ใส่ = ยังไม่ได้ตรวจ ไม่นับคะแนน (ไม่ใช่ว่าอ่านไม่ได้)
 * นับเฉพาะช่องที่ตรวจแล้วเท่านั้น ตัวเลขจึงบอกความแม่นจริง ไม่ใช่ความครบ
 */
type Expected = Partial<Record<'blNo' | 'vessel' | 'voyage' | 'eta' | 'portOfLoading' | 'grossWeight' | 'shipperName', string>>;

const ANSWERS: Record<string, Expected> = {
  /* --- ใบสแกน: ตอนนี้อ่านไม่ได้เลยสักช่อง นี่คือกลุ่มที่อยากรู้ผลที่สุด --- */
  'wanhai_bl_1.pdf': {
    blNo: '011GX04250', vessel: 'WAN HAI 278', voyage: 'S058',
    portOfLoading: 'HAKATA', grossWeight: '16900', shipperName: 'KANSAI GROUP CORPORATION',
  },
  'wanhai_bl_2.pdf': {
    blNo: '011GX03396', vessel: 'WAN HAI 276', voyage: 'S060',
    portOfLoading: 'HAKATA, JAPAN', grossWeight: '22820', shipperName: 'KANSAI GROUP CORPORATION',
  },
  'maersk_bl_1.pdf': {
    blNo: '271756831', vessel: 'MAERSK NARVIK', voyage: '626S',
    portOfLoading: 'OSAKA', grossWeight: '17840', shipperName: 'KANSAI GROUP CORPORATION',
  },
  'One_BL_2.pdf': {
    blNo: 'ONEYOSAG31213800', vessel: 'MOL EARNEST', voyage: '0116W',
    portOfLoading: 'YOKOHAMA', grossWeight: '18060', shipperName: 'KANSAI GROUP CORPORATION',
  },
  'Namsung_1.pdf': {
    blNo: 'NSSLKNILC26Q0020', vessel: 'SUNNY CANNA', voyage: '2601W',
    grossWeight: '26000', shipperName: 'FUKUOKA TRADING CO.,LTD.',
  },

  /* --- ใบที่อ่านได้อยู่แล้ว: ใส่ไว้กันวิธีใหม่ทำของเดิมพัง --- */
  'wanhai_an_1.pdf': {
    blNo: '011GX05220', vessel: 'WAN HAI 176', voyage: 'S111',
    eta: '2026-09-07', grossWeight: '48660',
  },
  'maersk_1.pdf': {
    blNo: '270911631', vessel: 'NORDAGER MAERSK', voyage: '622S', grossWeight: '50390',
  },
  'cnc_1.pdf': {
    blNo: 'AMP0559733', vessel: 'ASL HONG KONG', eta: '2026-09-06',
  },
  'Knot Global_1.pdf': {
    blNo: 'KG1222026-69605', vessel: 'NYK FUJI', voyage: '0139W', grossWeight: '31270',
  },
};

const FIELDS = ['blNo', 'vessel', 'voyage', 'eta', 'portOfLoading', 'grossWeight', 'shipperName'] as const;
type Field = (typeof FIELDS)[number];

const LABEL: Record<Field, string> = {
  blNo: 'เลข BL', vessel: 'ชื่อเรือ', voyage: 'เที่ยวเรือ', eta: 'ETA',
  portOfLoading: 'POL', grossWeight: 'น้ำหนัก', shipperName: 'Shipper',
};

/** เทียบแบบไม่สนตัวพิมพ์ วรรค และเครื่องหมาย — ต่างแค่รูปแบบถือว่าถูก */
const same = (a: string, b: string) => {
  const n = (v: string) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n(a) === n(b) && n(a) !== '';
};

/* ---------------- อ่านไฟล์ ---------------- */

async function pdfText(file: string): Promise<{ text: string; pieces: TextPiece[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false,
  }).promise;
  const texts: string[] = [];
  const pieces: TextPiece[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items as Array<Record<string, any>>;
    for (const it of items) {
      if (!('str' in it) || !String(it.str).trim()) continue;
      const [, , , , x, yBottom] = it.transform as number[];
      const h = it.height || 8;
      pieces.push({
        page: i,
        left: x / vp.width,
        right: (x + it.width) / vp.width,
        top: (vp.height - (yBottom + h)) / vp.height,
        bottom: (vp.height - yBottom) / vp.height,
        str: String(it.str),
      });
    }
    texts.push(items.map((t) => ('str' in t ? String(t.str) : '')).join(' '));
  }
  return { text: texts.join('\n'), pieces, pages: doc.numPages };
}

/**
 * แบบร่างที่เปิดใช้งานอยู่จริงในฐานข้อมูล
 *
 * ต้องเอามาด้วย ไม่งั้น "วิธีเดิม" ที่เอาไปเทียบจะเป็นแค่ตัวอ่าน regex เปล่า ๆ
 * ซึ่งไม่ใช่ของที่ใช้งานอยู่ — เทียบแล้วจะดูเหมือนวิธีใหม่ดีกว่าความจริง
 */
async function loadTemplates(): Promise<ParseTemplate[]> {
  if (!process.env.DATABASE_URL) return [];
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const rows = await sql<{ id: string; name: string; description: string | null; value: string | null }[]>`
      select id, name, description, value from master_records
      where type = 'parseTemplate' and is_active = true`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      match: String(r.description ?? '').split('\n').map((v) => v.trim()).filter(Boolean),
      areas: JSON.parse(r.value || '[]'),
      isActive: true,
    })).filter((t) => t.areas.length);
  } catch {
    return [];
  } finally {
    await sql.end();
  }
}

/* ---------------- วิธีที่ 2 — Google Drive OCR ---------------- */

/**
 * Drive แปลง PDF เป็น Google Doc พร้อมทำ OCR ให้ในขั้นตอนเดียว
 * จึงส่งไฟล์ PDF เข้าไปตรง ๆ ได้ ไม่ต้องแปลงหน้าเป็นรูปก่อน
 *
 * ข้อจำกัดที่ต้องรู้ — OCR คืนมาแค่ "ข้อความ" ไม่มีพิกัด
 * ระบบกรอบจึงใช้กับผลของ OCR ไม่ได้ ต้องพึ่งตัวอ่าน regex ล้วน ๆ
 */
async function viaDrive(file: string): Promise<string> {
  const bytes = fs.readFileSync(file);
  return driveOcrText(`data:application/pdf;base64,${bytes.toString('base64')}`);
}

/* ---------------- วิธีที่ 3 — Claude อ่านให้ ---------------- */

/**
 * เรียกตัวอ่าน AI ตัวเดียวกับที่ระบบจริงใช้ (src/lib/read-ai.ts)
 *
 * เดิมสคริปต์นี้มีสำเนาโค้ดเรียก API ของตัวเอง ซึ่งแยกร่างจากของจริงไปแล้ว —
 * ของจริงถูกแก้ให้หาบล็อกข้อความให้ถูก (คำตอบมีบล็อก "thinking" นำหน้า)
 * แต่สำเนาในนี้ยังหยิบบล็อกแรกอยู่ ทำให้วัดผลแล้วล้มทุกใบทั้งที่ API ใช้ได้
 *
 * เรียกของจริงจึงวัดสิ่งที่ผู้ใช้จะได้เจอจริง และไม่มีทางแยกร่างอีก
 */
async function viaClaude(file: string): Promise<Record<string, string>> {
  const out = await readWithAi(fs.readFileSync(file));
  lastCost = out.baht;

  const flat: Record<string, string> = {};
  for (const f of FIELDS) flat[f] = String((out.values as Record<string, unknown>)[f] ?? '');
  flat.containers = (out.values.containers ?? []).join(',');
  flat.seals = (out.values.seals ?? []).join(',');
  return flat;
}

/** ค่าใช้จ่ายของใบล่าสุด — ตัวอ่านคืนมาพร้อมผล */
let lastCost = 0;

/* ---------------- ให้คะแนน ---------------- */

type Score = { hit: number; total: number; detail: string[] };

function score(got: Record<string, string>, want: Expected): Score {
  const detail: string[] = [];
  let hit = 0; let total = 0;
  for (const f of FIELDS) {
    const expected = want[f];
    if (!expected) continue;          // ช่องที่ยังไม่ได้ตรวจ ไม่นับ
    total += 1;
    const actual = String(got[f] ?? '');
    if (same(actual, expected)) { hit += 1; continue; }
    detail.push(`${LABEL[f]}: ได้ "${actual || '(ว่าง)'}" ควรได้ "${expected}"`);
  }
  return { hit, total, detail };
}

/* ---------------- ตัวรัน ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const useDrive = args.includes('--drive');
  const useClaude = args.includes('--claude');

  if (!dir || (!useDrive && !useClaude)) {
    console.log('ใช้: npx tsx --tsconfig tsconfig.json scripts/try-ocr-ai.ts <โฟลเดอร์> --drive --claude');
    process.exit(1);
  }
  if (!fs.existsSync(dir)) { console.log(`ไม่พบโฟลเดอร์ ${dir}`); process.exit(1); }

  if (useDrive && !driveOcrConfigured()) {
    console.log('ยังไม่ได้ตั้ง GOOGLE_OAUTH_* ใน .env.local — ขอด้วย:');
    console.log('   npx tsx scripts/google-oauth.mts <CLIENT_ID> <CLIENT_SECRET>\n');
    process.exit(1);
  }
  if (useClaude && !process.env.ANTHROPIC_API_KEY) {
    console.log('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน .env.local\n');
    process.exit(1);
  }

  const templates = await loadTemplates();
  console.log(templates.length
    ? `ใช้แบบร่างจากฐานข้อมูล ${templates.length} แบบ (วิธีเดิม = regex + กรอบ)`
    : 'อ่านแบบร่างจากฐานข้อมูลไม่ได้ — "วิธีเดิม" จะเป็น regex ล้วน ไม่รวมกรอบ');

  const totals = {
    old: { hit: 0, total: 0 },
    drive: { hit: 0, total: 0 },
    claude: { hit: 0, total: 0 },
  };
  let claudeBaht = 0;
  let claudeFiles = 0;

  for (const [name, want] of Object.entries(ANSWERS)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { console.log(`\n— ${name} — ข้าม (ไม่มีไฟล์)`); continue; }

    const { text, pieces, pages } = await pdfText(file);
    const scanned = pieces.length === 0;
    console.log(`\n### ${name}  (${pages} หน้า · ${scanned ? 'ไฟล์สแกน' : `ข้อความ ${pieces.length} ชิ้น`})`);

    // วิธีเดิม — regex + กรอบ แบบเดียวกับที่หน้าอัปโหลดใช้จริง
    const auto = parseArrivalText(text);
    const tpl = matchTemplate(templates, text);
    const combined = combineRead(auto as never, tpl, pieces);
    const old = score(combined as unknown as Record<string, string>, want);
    totals.old.hit += old.hit; totals.old.total += old.total;
    console.log(`  เดิม    ${old.hit}/${old.total} ช่อง${tpl ? ` (แบบ: ${tpl.name})` : ''}`);
    old.detail.slice(0, 3).forEach((d) => console.log(`            ${d}`));

    if (useDrive) {
      try {
        const ocr = await viaDrive(file);
        const got = parseArrivalText(ocr) as unknown as Record<string, string>;
        const s = score(got, want);
        totals.drive.hit += s.hit; totals.drive.total += s.total;
        console.log(`  drive   ${s.hit}/${s.total} ช่อง  (OCR ได้ข้อความ ${ocr.replace(/\s+/g, ' ').trim().length} ตัวอักษร)`);
        s.detail.slice(0, 3).forEach((d) => console.log(`            ${d}`));
      } catch (e) {
        console.log(`  drive   ล้มเหลว — ${e instanceof Error ? e.message : e}`);
      }
    }

    if (useClaude) {
      try {
        const got = await viaClaude(file);
        const s = score(got, want);
        totals.claude.hit += s.hit; totals.claude.total += s.total;
        claudeBaht += lastCost; claudeFiles += 1;
        console.log(`  claude  ${s.hit}/${s.total} ช่อง  (~${lastCost.toFixed(2)} บาท)`);
        s.detail.slice(0, 3).forEach((d) => console.log(`            ${d}`));
        if (got.containers) console.log(`            ตู้: ${got.containers}`);
      } catch (e) {
        console.log(`  claude  ล้มเหลว — ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const pct = (h: number, t: number) => (t ? `${Math.round((h / t) * 100)}%` : '-');
  console.log('\n══════ สรุป ══════');
  console.log(`  เดิม    ${totals.old.hit}/${totals.old.total} = ${pct(totals.old.hit, totals.old.total)}`);
  if (useDrive) console.log(`  drive   ${totals.drive.hit}/${totals.drive.total} = ${pct(totals.drive.hit, totals.drive.total)}`);
  if (useClaude) {
    console.log(`  claude  ${totals.claude.hit}/${totals.claude.total} = ${pct(totals.claude.hit, totals.claude.total)}`);
    if (claudeFiles) {
      console.log(`\n  ค่าใช้จ่าย Claude: ~${claudeBaht.toFixed(2)} บาท / ${claudeFiles} ใบ`
        + ` = เฉลี่ย ~${(claudeBaht / claudeFiles).toFixed(2)} บาทต่อใบ`);
      console.log(`  ถ้าเดือนละ 200 ใบ ≈ ${((claudeBaht / claudeFiles) * 200).toFixed(0)} บาท/เดือน`);
    }
  }
  console.log('\n(ทดลองอย่างเดียว ไม่ได้บันทึกอะไรลงฐานข้อมูล)');
}

main().catch((e) => { console.error(e); process.exit(1); });
