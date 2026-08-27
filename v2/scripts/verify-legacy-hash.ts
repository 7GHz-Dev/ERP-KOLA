/**
 * พิสูจน์ว่าสูตรแฮชที่เขียนใหม่ใน src/lib/password.ts ให้ผลตรงกับ passwordHash_() ของระบบเดิม
 *
 * โหลดไฟล์ .gs ตัวจริงเข้า sandbox แล้วเทียบผลลัพธ์ตรง ๆ
 * ถ้าไม่ตรง ผู้ใช้ทุกคนจะล็อกอินไม่ได้หลังย้ายระบบ จึงต้องมีตัวตรวจนี้ไว้
 *
 *   npx tsx scripts/verify-legacy-hash.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { legacyHash } from '../src/lib/password';

const LEGACY_ROOT = resolve(process.cwd(), '..');
const PEPPER = 'test-pepper-value-1234567890';

function buildLegacyContext() {
  const properties = new Map<string, string>([['PASSWORD_PEPPER', PEPPER]]);
  const context: Record<string, unknown> = {
    console,
    Date,
    JSON,
    Math,
    String,
    Number,
    Object,
    Array,
    isNaN,
    isFinite,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm: string, value: string) =>
        Array.from(createHash('sha256').update(String(value), 'utf8').digest()),
      getUuid: () => 'uuid',
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key) ?? null,
        setProperty: (key: string, value: string) => properties.set(key, String(value)),
      }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => '' }) },
    Logger: { log: () => {} },
  };
  const vmContext = createContext(context);
  ['Config.gs', 'Utils.gs', 'Auth.gs'].forEach((file) => {
    runInContext(readFileSync(resolve(LEGACY_ROOT, file), 'utf8'), vmContext, { filename: file });
  });
  return vmContext as Record<string, any>;
}

const legacy = buildLegacyContext();

const cases: Array<[string, string]> = [
  ['AdminPass123!', 'a1b2c3d4e5f6'],
  ['Kola!Abcdef1234', 'ZZZZ0000ffff'],
  ['รหัสผ่านไทย123', 'thai-salt-001'],           // ต้องรองรับ UTF-8 ให้ตรงกัน
  ['p@ss|word|with|pipes1', 'salt|with|pipes'],   // ตัวคั่นในสูตรคือ | จึงต้องทดสอบเคสนี้
];

let failed = 0;
for (const [password, salt] of cases) {
  const fromLegacy = legacy.passwordHash_(password, salt);
  const fromNode = legacyHash(password, salt, PEPPER);
  const match = fromLegacy === fromNode;
  if (!match) failed += 1;
  console.log(`${match ? 'ตรงกัน  ' : 'ไม่ตรง '} ${JSON.stringify(password)}`);
  if (!match) {
    console.log(`   เดิม: ${fromLegacy}`);
    console.log(`   ใหม่: ${fromNode}`);
  }
}

assert.equal(legacy.APP_CONFIG.PASSWORD_ROUNDS, 600, 'จำนวนรอบของระบบเดิมเปลี่ยนไป ต้องแก้ LEGACY_ROUNDS ให้ตรง');
assert.equal(failed, 0, `มี ${failed} เคสที่แฮชไม่ตรงกัน`);
console.log('\nPASS: สูตรแฮชเข้ากันได้กับระบบเดิมทุกเคส ผู้ใช้เดิมล็อกอินด้วยรหัสเดิมได้');
