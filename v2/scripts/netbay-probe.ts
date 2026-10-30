/**
 * อ่านหน้ารายการใบขนของ NETBAY แบบไม่กดอะไร — ใช้ตรวจว่าตัว monitor ใบขนอ่านหน้าจริงถูก
 *
 *   npm run netbay:probe -- QELS100015966 [QELS100015970 …]
 *
 * ค้นหาแต่ละ Ref No. แล้วพิมพ์สิ่งที่ตัว monitor อ่านได้ (สถานะ · รูปป้าย · เลขใบขน)
 * และเก็บ HTML ของแถว หัวตาราง ช่อง select และปุ่ม Save PDF ไว้ที่ netbay-probe/<Ref No.>.html
 * ใช้ส่งให้ผู้พัฒนาเมื่อสถานะขึ้น "ไม่รู้จัก" — ไม่ติ๊ก ไม่กด Save PDF ไม่แก้อะไรใน NETBAY
 *
 * บัญชี: NETBAY_MONITOR_USER / NETBAY_MONITOR_PASSWORD ใน .env.local ถ้ามี ไม่งั้นใช้บัญชีประจำเครื่อง
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/lib/env';
import { netbayStatusLabel } from '../src/lib/customs-status';
import { check, findDeclaration, launch, login, netbaySettings, readDeclaration } from './netbay-kola';

loadEnv();

async function main() {
  const refs = process.argv.slice(2).filter((a) => /^[A-Za-z0-9-]{4,40}$/.test(a));
  if (!refs.length) throw new Error('ใส่ Ref No. อย่างน้อย 1 เลข เช่น npm run netbay:probe -- QELS100015966');
  const env = process.env;
  const s = {
    ...netbaySettings({
      ...env,
      NETBAY_USER: env.NETBAY_MONITOR_USER || env.NETBAY_USER,
      NETBAY_PASSWORD: env.NETBAY_MONITOR_PASSWORD || env.NETBAY_PASSWORD,
    }),
    headless: true,
  };
  check(s);
  const out = join(process.cwd(), 'netbay-probe');
  mkdirSync(out, { recursive: true });

  const browser = await launch(s);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    const listUrl = await login(page, s);
    for (const ref of refs) {
      const row = await readDeclaration(page, listUrl, ref);
      console.log(`${ref}: ${row.found
        ? `สถานะ ${row.status ? `${row.status} (${netbayStatusLabel(row.status)})` : 'อ่านไม่ออก'} · รูป ${row.image || '-'} · เลขใบขน ${row.declarationNo ?? '-'}`
        : 'ไม่พบ'}`);

      const id = row.found ? await findDeclaration(page, listUrl, ref) : null;
      // ห้ามประกาศฟังก์ชันที่มีชื่อในนี้ — tsx ใส่ตัวช่วย __name ให้ ซึ่งไม่มีในหน้าเว็บ
      const html = await page.evaluate((pic) => {
        const img = pic ? document.getElementById(pic) : null;
        const header = Array.from(document.querySelectorAll('tr'))
          .find((tr) => Array.from(tr.cells).some((c) => /DECLARATION/i.test(c.textContent ?? '')));
        const save = Array.from(document.querySelectorAll('input,button'))
          .filter((el) => /Save PDF/i.test((el as HTMLInputElement).value ?? el.textContent ?? ''));
        return [
          '<h2>แถว</h2>', img?.closest('tr')?.outerHTML ?? '',
          '<h2>หัวตาราง</h2>', header?.outerHTML ?? '',
          '<h2>select</h2>', ...Array.from(document.querySelectorAll('select')).map((el) => el.outerHTML),
          '<h2>Save PDF</h2>', ...save.map((el) => el.outerHTML),
        ].join('\n');
      }, id ? `statusPic${id}` : null);
      const file = join(out, `${ref}.html`);
      writeFileSync(file, `<!doctype html><meta charset="utf-8"><base href="${s.url}/">\n${html}\n`);
      console.log(`  เก็บ HTML ไว้ที่ ${file}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
