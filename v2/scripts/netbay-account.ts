/**
 * ขอบัญชี NETBAY ประจำเครื่องนี้จาก ERP-KOLA แล้วเขียนลง .env.local (NETBAY_USER / NETBAY_PASSWORD)
 *
 *   npm run netbay:account
 *
 * NETBAY ให้ login ด้วยบัญชีเดียวได้ทีละที่ — เครื่องละบัญชี ไม่งั้นสองเครื่องเตะกันหลุดกลางงาน
 * เครื่องเดิมรันซ้ำได้บัญชีเดิม · ตัวติดตั้ง (windows-setup.cmd, mac-worker-launcher.sh) เรียกตัวนี้ให้
 * ต้องมี WORKER_API_KEY ใน .env.local ก่อน
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/lib/env';

loadEnv();

const ERP_URL = (process.env.ERP_URL ?? 'https://erp-kola.vercel.app').replace(/\/$/, '');
const KEY = process.env.WORKER_API_KEY ?? '';
const ENV_FILE = join(__dirname, '..', '.env.local');

/** แทนค่าบรรทัด KEY=… ที่มีอยู่ ไม่มีก็ต่อท้าย · บรรทัดอื่นคงไว้ */
export function setEnvLines(text: string, values: Record<string, string>) {
  const lines = text.split(/\r?\n/);
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (m && m[1] in values) { done.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) out.push(`${k}=${v}`);
  return `${out.join('\n')}\n`;
}

async function main() {
  if (!KEY) throw new Error('ยังไม่มี WORKER_API_KEY ใน .env.local');
  const machine = process.env.COMPUTERNAME || hostname();
  const res = await fetch(`${ERP_URL}/api/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, fn: 'netbayAccount', args: { machine } }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; data?: { username: string; password: string; reused: boolean };
  };
  if (!res.ok || !body.ok || !body.data) throw new Error(body.error ?? `ERP ตอบ ${res.status}`);
  const { username, password, reused } = body.data;
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').replace(/^﻿/, '') : '';
  // UTF-8 ไม่มี BOM — Node อ่านชื่อตัวแปรแรกเพี้ยนถ้ามี BOM
  writeFileSync(ENV_FILE, setEnvLines(text, { NETBAY_USER: username, NETBAY_PASSWORD: password }), 'utf8');
  console.log(`บัญชี NETBAY ของเครื่อง ${machine}: ${username}${reused ? ' (บัญชีเดิม)' : ' (จองใหม่)'}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ขอบัญชี NETBAY ไม่สำเร็จ: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
