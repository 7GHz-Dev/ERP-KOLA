/**
 * ตัว monitor ใบขน — เช็กสถานะใบขนใน NETBAY จน ACCEPT ครบทุกรายการ แล้วปิดตัวเอง
 *
 * FAH กด SEND TO CUSTOMS ใน NETBAY เอง แล้วกด "สร้างใบขนแล้ว" ที่ ERP (ตรวจ Draft / ทำใบขน)
 * หน้าเว็บเปิดลิงก์ kola-worker://customs ให้ตัวเปิดในเครื่องรัน npm run worker:customs
 * เครื่องที่กดล่าสุดรับหน้าที่ต่อ (บัญชี monitor login ได้ทีละที่) ตัวเก่าเห็นในรอบถัดไปแล้วปิดตัวเอง
 *
 * ทุก 10 วินาทีถาม ERP ว่ายังมีรายการค้างไหม (ไม่แตะ NETBAY)
 *   ไม่เหลือ                     -> ปิดตัว (ACCEPT ครบแล้ว)
 *   มีคนกด Refresh บนหน้าเว็บ     -> เช็กทุกรายการทันที ด้วย NETBAY user ที่ผู้กดเลือก แล้วบอก ERP ว่าเสร็จ
 *   มีรายการใหม่ที่ยังไม่เคยเช็ก -> เช็กทันที
 *   ครบรอบ (ค่าตั้งต้น 5 นาที)   -> เช็กทุกรายการ (scripts/customs-check.ts)
 *
 * วิธีรัน (ในโฟลเดอร์ v2):
 *   npm run worker:customs              วนจนครบ
 *   npm run worker:customs -- --once    เช็กรอบเดียวแล้วจบ
 *
 * บัญชี NETBAY ขอจาก ERP (NETBAY_MONITOR_ACCOUNT บน Vercel) ไม่ใช้บัญชีประจำเครื่อง
 * ไม่มีหน้าต่าง Chrome เพราะเช็กซ้ำระหว่างที่ FAH ใช้เครื่องอยู่ (CUSTOMS_MONITOR_SHOW=1 = แสดงหน้าต่าง)
 * CUSTOMS_MONITOR_MINUTES = ระยะห่างของแต่ละรอบ · ดูการทำงานได้ที่ คิวงาน Automation > รอสร้างใบขน
 */
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { loadEnv } from '../src/lib/env';
import { checkRound, type MonitorTask } from './customs-check';
import { netbaySettings, type NetbaySettings } from './netbay-kola';
import { AGENT_VERSION } from '../src/lib/agent-version';

loadEnv();

const ERP_URL = (process.env.ERP_URL ?? 'https://erp-kola.vercel.app').replace(/\/$/, '');
const KEY = process.env.WORKER_API_KEY ?? '';
const MODE = 'customs';                     // CUSTOMS_MONITOR_MODE — แยกจาก worker แลก DO และ worker สร้าง Draft
const WORKER = `customs@${hostname()}`;
// lease แยกตาม process — กดซ้ำบนเครื่องเดิมแล้วตัวเปิดสั่งรันใหม่ ตัวเก่าก็ยังรู้ว่าไม่ใช่ตัวมันแล้ว
const LEASE = `${WORKER}#${process.pid}#${Date.now()}`;
const ONCE = process.argv.includes('--once');
const ROUND_MS = Math.max(1, Number(process.env.CUSTOMS_MONITOR_MINUTES ?? 5) || 5) * 60_000;
const TICK_MS = 10_000;                     // กด Refresh แล้วเริ่มเช็กภายใน 10 วินาที
const MIN_GAP_MS = 60_000;                  // รายการใหม่เช็กทันที แต่ไม่ถี่กว่านาทีละครั้ง กัน ERP ล่มแล้ววนเร็ว
const BEAT_MS = 15_000;                     // ERP ถือว่าออฟไลน์ถ้าเงียบเกิน 70 วินาที
const WORK_DIR = process.env.CUSTOMS_MONITOR_DIR ?? join(homedir(), '.kola-customs-monitor');

const recent: string[] = [];
let busy: string | null = null;

function log(msg: string) {
  const line = `${new Date().toLocaleTimeString('th-TH', { hour12: false })}  ${msg}`;
  console.log(line);
  recent.push(line);
  if (recent.length > 80) recent.shift();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${ERP_URL}/api/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, fn, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(`${fn}: ${body.error ?? res.status}`);
  return body.data as T;
}

async function heartbeat(extra: { shot?: string; offline?: boolean } = {}) {
  await api('heartbeat', {
    worker: WORKER, busy, mode: MODE, platform: process.platform, headless: true, version: AGENT_VERSION,
    log: recent, ...extra,
  }).catch((e) => console.log('heartbeat:', e instanceof Error ? e.message : e));
}

async function snap(page: Page) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 45 }).catch(() => null);
  await heartbeat(buf ? { shot: buf.toString('base64') } : {});
}

async function main() {
  if (!KEY) throw new Error('ยังไม่ได้ตั้ง WORKER_API_KEY ใน .env.local');
  const { account } = await api<{ account: { username: string; password: string } }>(
    'customsMonitorStart', { worker: WORKER, lease: LEASE });
  const netbay = {
    ...netbaySettings({ ...process.env, NETBAY_USER: account.username, NETBAY_PASSWORD: account.password }),
    headless: process.env.CUSTOMS_MONITOR_SHOW !== '1',
  };
  log(`ตัว monitor ใบขน ${WORKER} v${AGENT_VERSION} · ERP ${ERP_URL} · NETBAY ${netbay.url} (บัญชี ${account.username}) · เช็กทุก ${ROUND_MS / 60_000} นาที`);

  const beat = setInterval(() => { void heartbeat(); }, BEAT_MS);
  let stop = false;
  process.on('SIGINT', () => { stop = true; log('กำลังหยุดหลังจบรอบที่ทำอยู่…'); });
  process.on('SIGTERM', () => { stop = true; });

  let lastRound = 0;
  let handledRefresh = '';
  const withAccount = (a: { username: string; password: string }): NetbaySettings =>
    ({ ...netbay, username: a.username, password: a.password });
  try {
    await heartbeat();
    while (!stop) {
      let state: {
        owner: boolean; by?: string; tasks: MonitorTask[];
        refresh?: { at: string; account: { username: string; password: string } } | null;
      };
      try {
        state = await api('customsMonitorTasks', { lease: LEASE });
      } catch (error) {
        log(`ถามรายการจาก ERP ไม่ได้: ${error instanceof Error ? error.message : error}`);
        await sleep(TICK_MS);
        continue;
      }
      if (!state.owner) {
        // 'ปิดจากหน้าเว็บ' = MONITOR_STOPPED_BY ใน src/lib/customs-monitor.ts (กดปุ่มปิดเช็คสถานะ)
        log(state.by === 'ปิดจากหน้าเว็บ'
          ? 'สั่งปิดเช็คสถานะจากหน้าเว็บ — ปิดตัวนี้'
          : `เครื่อง ${state.by ?? 'อื่น'} รับหน้าที่ monitor ต่อแล้ว — ปิดตัวนี้`);
        break;
      }
      // คำขอ Refresh ที่ยังไม่เสร็จ — รวมคำขอที่ทำให้ตัวนี้ถูกเปิดขึ้นมา (ERP ไม่ส่งคำขอที่ค้างเกิน 10 นาที)
      const refresh = state.refresh && state.refresh.at !== handledRefresh ? state.refresh : null;
      if (!state.tasks.length) {
        if (refresh) await api('customsRefreshDone', { at: refresh.at, worker: WORKER, result: null }).catch(() => {});
        log('ACCEPT ครบทุกรายการแล้ว — ปิดตัว monitor');
        break;
      }

      const since = Date.now() - lastRound;
      const fresh = state.tasks.some((t) => !t.checkedAt);
      if (refresh || since >= ROUND_MS || (fresh && since >= MIN_GAP_MS)) {
        lastRound = Date.now();
        if (refresh) handledRefresh = refresh.at;
        const account = refresh ? withAccount(refresh.account) : netbay;
        busy = `เช็กใบขน ${state.tasks.length} รายการ${refresh ? ' (กด Refresh)' : ''}`;
        log(refresh
          ? `กด Refresh — เช็ก ${state.tasks.length} รายการทันที ด้วย NETBAY user ${account.username} ...`
          : `เช็ก ${state.tasks.length} รายการ ...`);
        await heartbeat();
        let result: { accepted: number; waiting: number; failed: number } | null = null;
        try {
          result = await checkRound(state.tasks, { api, netbay: account, workDir: WORK_DIR, log, onStep: snap });
          log(`จบรอบ: ACCEPT ${result.accepted} · รอ ${result.waiting} · ผิดพลาด ${result.failed}`);
        } catch (error) {
          log(`รอบนี้ไม่สำเร็จ: ${error instanceof Error ? error.message : error} — ลองใหม่รอบหน้า`);
        }
        if (refresh) await api('customsRefreshDone', { at: refresh.at, worker: WORKER, result }).catch(() => {});
        busy = null;
        await heartbeat();
        if (ONCE) break;
        continue;                           // ถามรายการใหม่ทันที — ACCEPT ครบในรอบนี้ก็ปิดได้เลย
      }
      await sleep(TICK_MS);
    }
  } finally {
    clearInterval(beat);
    busy = null;
    log('ปิดตัว monitor');
    await heartbeat({ offline: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
