/**
 * เปิดใบขนใน NETBAY จาก Reference No. — ลิงก์ Ref No. บน ERP-KOLA (kola-netbay://open?ref=...) เรียกตัวนี้
 *
 *   npm run netbay:open -- QENX000000020
 *   npm run netbay:open -- "kola-netbay://open?ref=QENX000000020"
 *
 * เปิด Chrome -> login -> Import -> ค้นหา Reference No. -> เปิดใบขนนั้น แล้วปล่อยหน้าต่างไว้ให้ตรวจต่อ
 * ใช้ NETBAY_USER / NETBAY_PASSWORD จาก .env.local ของเครื่องนี้ · ตัวเปิดลิงก์ติดตั้งด้วย scripts/install/
 */
import { loadEnv } from '../src/lib/env';
import { netbaySettings, openDeclaration } from './netbay-kola';

loadEnv();

const REF = /^[A-Z0-9][A-Z0-9-]{3,39}$/;

/** 'QENX000000020' หรือ 'kola-netbay://open?ref=QENX000000020' -> 'QENX000000020' */
export function parseRef(arg: string): string {
  let raw = (arg ?? '').trim();
  if (raw.includes('://')) {
    try { raw = new URL(raw).searchParams.get('ref') ?? ''; } catch { raw = ''; }
  }
  const ref = raw.trim().toUpperCase();
  if (!REF.test(ref)) throw new Error(`Reference No. ไม่ถูกต้อง: '${arg}'`);
  return ref;
}

async function main() {
  const ref = parseRef(process.argv[2] ?? '');
  const log = (m: string) => console.log(`${new Date().toLocaleString('sv-SE')}  ${m}`);   // YYYY-MM-DD HH:MM:SS เวลาเครื่อง
  log(`เปิดใบขน ${ref}`);
  await openDeclaration(ref, { ...netbaySettings(), headless: false }, { log });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ไม่สำเร็จ: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
