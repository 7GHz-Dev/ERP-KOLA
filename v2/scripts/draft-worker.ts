/**
 * worker สร้าง Draft ใบขนใน NETBAY (KOLA) — PAINT > งานคงค้าง > 3. Draft ใบขน > "สร้าง Draft"
 *
 * รันบนเครื่องในออฟฟิศที่เปิด NETBAY (192.168.1.123) ได้ เป็นฝ่ายถามคิวของ ERP เอง (ไม่ต้องเปิด port ให้ใครเข้ามา)
 * ทำงานแต่ละชิ้นตาม scripts/draft-task.ts: ตรวจ Final Invoice -> ออกเลขเครื่อง -> CSV -> สร้างใบขน + Import
 * แท็บ Draft ใบขนบน ERP บอกว่า worker ออนไลน์ไหม ทำงานไหนอยู่ พร้อม log และภาพหน้าจอสด
 *
 * วิธีรัน (ในโฟลเดอร์ v2):
 *   npm run worker:draft              รอรับงานไปเรื่อย ๆ  (ปิด: Ctrl+C)
 *   npm run worker:draft -- --once    ทำงานที่ค้างในคิว 1 งานแล้วจบ
 *   npm run worker:draft -- --task TASK-…   ทำเฉพาะงานนั้นแล้วจบ — ปุ่ม "สร้าง Draft" เปิดผ่านลิงก์
 *                                            kola-worker://draft?task=… ให้เครื่องที่กดเป็นคนทำ
 *   ปุ่ม "เปิด worker" ที่แท็บ Draft ใบขน (ติดตั้งตัวเปิดก่อน: scripts/install/)
 *
 * ตัวแปรใน .env.local: WORKER_API_KEY · ERP_URL (ค่าตั้งต้นเว็บจริง) · NETBAY_USER · NETBAY_PASSWORD
 *   NETBAY_HEADLESS=1 = ไม่มีหน้าต่าง Chrome · ค่าหัวใบขนอื่นดู scripts/netbay-kola.ts
 */
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { loadDraftData } from '../src/lib/draft/csv';
import { loadEnv } from '../src/lib/env';
import { processTask, type Task } from './draft-task';
import { netbaySettings } from './netbay-kola';
import { taskFromArgs } from './draft-worker-args';

loadEnv();

const ERP_URL = (process.env.ERP_URL ?? 'https://erp-kola.vercel.app').replace(/\/$/, '');
const KEY = process.env.WORKER_API_KEY ?? '';
const TASK_TYPE = 'DRAFT_ENTRY';
const MODE = 'draft';                       // แยกจาก worker กรอกเว็บแลก DO (DRAFT_WORKER_MODE)
const ONCE = process.argv.includes('--once');

const ONLY_TASK = taskFromArgs(process.argv.slice(2));
// ตัวที่เปิดมาทำงานเดียวใช้ชื่อแยก — ปิดตัวแล้วไม่ทำให้ worker ตัวหลักของเครื่องเดียวกันดูเหมือนออฟไลน์
const WORKER = ONLY_TASK ? `draft@${hostname()} (งานจากเครื่องนี้)` : `draft@${hostname()}`;
const POLL_MS = 20_000;
const BEAT_MS = 15_000;                     // ERP ถือว่าออฟไลน์ถ้าเงียบเกิน 70 วินาที
const WORK_DIR = process.env.DRAFT_WORKER_DIR ?? join(homedir(), '.kola-draft-worker');

const recent: string[] = [];
let busy: string | null = null;
// ปุ่ม "ปิด worker" บนหน้าเว็บ — ตัวที่เปิดก่อนเวลาที่สั่งปิดหยุดหลังจบงานที่ทำอยู่
const STARTED = Date.now();
let stopping = false;

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
  const netbay = netbaySettings();
  const res = await api<{ settings?: { stopAt?: string | null } }>('heartbeat', {
    worker: WORKER, busy, mode: MODE, platform: process.platform, headless: netbay.headless,
    log: recent, ...extra,
  }).catch((e) => { console.log('heartbeat:', e instanceof Error ? e.message : e); return null; });
  const stopAt = res?.settings?.stopAt;
  if (stopAt && Date.parse(stopAt) > STARTED && !stopping) {
    stopping = true;
    log(busy ? 'สั่งปิดจากหน้าเว็บ — ปิดหลังจบงานที่ทำอยู่' : 'สั่งปิดจากหน้าเว็บ');
  }
}

/** ภาพหน้าจอ NETBAY ขึ้น ERP ระหว่างทำงาน */
async function snap(page: Page) {
  const buf = await page.screenshot({ type: 'jpeg', quality: 45 }).catch(() => null);
  await heartbeat(buf ? { shot: buf.toString('base64') } : {});
}

async function main() {
  if (!KEY) throw new Error('ยังไม่ได้ตั้ง WORKER_API_KEY ใน .env.local');
  const netbay = netbaySettings();
  if (!netbay.username || !netbay.password) throw new Error('ยังไม่ได้ตั้ง NETBAY_USER / NETBAY_PASSWORD ใน .env.local');
  await api('queueStatus');                  // เช็กคีย์และที่อยู่ระบบก่อน
  const data = await loadDraftData();
  log(`worker ${WORKER} รับงาน Draft ใบขนจาก ${ERP_URL} · NETBAY ${netbay.url}`);

  const beat = setInterval(() => { void heartbeat(); }, BEAT_MS);
  process.on('SIGINT', () => { stopping = true; log('กำลังหยุดหลังจบงานที่ทำอยู่…'); });
  process.on('SIGTERM', () => { stopping = true; });

  try {
    await heartbeat();
    if (ONLY_TASK) {
      // เครื่องที่กดสร้าง Draft — ทำเฉพาะงานนั้นแล้วปิด ไม่วนรับงานอื่น
      const { task } = await api<{ task: Task }>('claimTask', { taskId: ONLY_TASK, worker: WORKER });
      busy = `Draft ใบขน ${task.data.jobNo || task.data.blNo || task.id}`;
      log(`รับงาน ${task.id} บนเครื่องนี้  (งาน ${task.data.jobNo ?? '-'}  BL ${task.data.blNo ?? '-'})`);
      await heartbeat();
      await processTask(task, { api, data, netbay: netbaySettings(), workDir: WORK_DIR, log, onStep: snap });
      return;
    }
    while (!stopping) {
      let task: Task | null = null;
      try {
        ({ task } = await api<{ task: Task | null }>('claimNext', { type: TASK_TYPE, worker: WORKER }));
      } catch (error) {
        log(`ถามคิวไม่ได้: ${error instanceof Error ? error.message : error}`);
      }
      if (task) {
        busy = `Draft ใบขน ${task.data.jobNo || task.data.blNo || task.id}`;
        log(`รับงาน ${task.id}  (งาน ${task.data.jobNo ?? '-'}  BL ${task.data.blNo ?? '-'})`);
        await heartbeat();
        await processTask(task, { api, data, netbay: netbaySettings(), workDir: WORK_DIR, log, onStep: snap });
        busy = null;
        await heartbeat();
        if (ONCE) break;
        continue;
      }
      if (ONCE) { log('คิวว่าง'); break; }
      // นอนเป็นช่วงสั้น ๆ — กดปิดจากหน้าเว็บแล้วปิดได้ภายในไม่กี่วินาที ไม่ต้องรอครบรอบถามคิว
      for (let waited = 0; waited < POLL_MS && !stopping; waited += 2_000) await sleep(2_000);
    }
  } finally {
    clearInterval(beat);
    busy = null;
    log('ปิด worker');
    await heartbeat({ offline: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
