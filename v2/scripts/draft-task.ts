/**
 * งาน "สร้าง Draft ใบขน" หนึ่งงาน — ยกมาจาก worker.py ของโปรแกรม imp
 *
 *   1. ตรวจ Final Invoice  ไม่ผ่าน = ส่งเหตุผลกลับไปที่งาน ไม่สร้างอะไร
 *   2. ออกเลขเครื่อง (ตาราง engine_numbers ผ่าน /api/worker) เติมลง Excel และสร้าง CSV
 *      chassis ที่เคยได้เลขใน BL เดียวกันใช้เลขเดิม — กดสร้าง Draft ซ้ำได้ เลขไม่เปลี่ยน
 *   3. สร้างใบขนใน NETBAY กรอกหัวใบขน แนบ CSV แล้วจบเมื่อขึ้น "success please check your invoice"
 *   4. ส่ง Reference No. + Excel ที่เติมเลขเครื่อง + CSV กลับเข้างานใน ERP
 *
 * แยกจาก draft-worker.ts (วนรับงาน) เพื่อให้เทสต์เรียกได้โดยไม่ต้องต่อ ERP จริง
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from 'playwright-core';
import {
  analyze, buildCsv, excelUpdates, KEEP, lookupKeys, NEW, safeName, type EngineLookup, type EngineRow,
} from '../src/lib/draft/analyze';
import type { DraftData } from '../src/lib/draft/csv';
import { patchWorkbook } from '../src/lib/draft/excel-patch';
import { readInvoice } from '../src/lib/draft/invoice';
import { createDraft, type DraftInfo, type NetbaySettings } from './netbay-kola';

export type Api = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;
export type Task = {
  id: string; jobId: string | null; inputFileName: string | null; hasInputFile: boolean;
  data: { jobNo?: string; blNo?: string };
};
export type Deps = {
  api: Api; data: DraftData; netbay: NetbaySettings; workDir: string;
  log: (msg: string) => void; onStep?: (page: Page) => Promise<void>;
  /** วินาทีที่รอก่อนส่งผลกลับ ERP แต่ละครั้ง */
  retryWaits?: number[];
};

/** invoice หรือข้อมูลงานมีปัญหาที่ PAINT ต้องแก้ — ข้อความนี้ไปแสดงที่งานใน ERP */
export class DraftError extends Error {}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_UPLOAD = 3_000_000;            // ความยาว base64 สูงสุดที่ส่งไฟล์ขึ้น ERP (Vercel รับ request ราว 4.5MB)
const normBl = (s: string) => (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeId = (s: string) => s.replace(/[^\w.-]/g, '_');

type Result = { refNo: string; excel: string; csv: string };

function lookupFrom(rows: EngineRow[]): EngineLookup {
  return {
    find: (n) => rows.filter((r) => r.number === n),
    history: (c) => rows.filter((r) => r.chassis === c).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
}

export async function makeDraft(task: Task, deps: Deps, info: DraftInfo): Promise<Result> {
  const { api, log } = deps;
  if (!task.hasInputFile) throw new DraftError('งานนี้ไม่มีไฟล์ Final Invoice');
  const input = await api<{ fileName: string; base64: string }>('downloadInputFile', { taskId: task.id });
  const name = input.fileName || task.inputFileName || 'invoice.xlsx';
  const ext = extname(name).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xlsm') throw new DraftError(`Final Invoice ต้องเป็นไฟล์ Excel (.xlsx) — ไฟล์ที่แนบคือ ${name}`);
  const dir = join(deps.workDir, safeId(task.id));
  mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(input.base64, 'base64');
  writeFileSync(join(dir, `invoice${ext}`), buf);
  log(`ได้ไฟล์ ${name}`);

  const inv = await readInvoice(buf);
  const keys = lookupKeys(inv);
  const { rows } = keys.numbers.length || keys.chassis.length
    ? await api<{ rows: EngineRow[] }>('engineLookup', keys)
    : { rows: [] };
  const a = analyze(inv, deps.data, lookupFrom(rows), { reuseBl: true });
  if (!a.ok) throw new DraftError(`invoice ไม่ผ่านการตรวจ:\n- ${(a.errors.length ? a.errors : ['ไม่พบรถในไฟล์']).join('\n- ')}`);
  const want = task.data.blNo ?? '';
  if (want && !normBl(want).includes(normBl(inv.bl_no)) && !normBl(inv.bl_no).includes(normBl(want))) {
    throw new DraftError(`เลข BL ใน invoice (${inv.bl_no}) ไม่ตรงกับงาน (${want}) — ตรวจว่าแนบ Final Invoice ถูกงาน`);
  }
  for (const w of a.warnings) log(`  เตือน: ${w}`);
  const missing = a.lines.filter((l) => l.tariff.includes('X')).length;
  // เหมือนโปรแกรมเดิม: ไม่พบพิกัด = XXXX  หลายพิกัด = 0000XXXX  ไปแก้ในใบขนเอง
  if (missing) log(`  พิกัดยังไม่ครบ ${missing} คัน — ใส่ XXXX ไว้ ต้องแก้ในใบขนบน NETBAY`);

  try {        // ลองเขียน Excel ด้วยเลขสมมติก่อน เขียนไม่ได้จะได้รู้ก่อนออกเลขจริง
    const dry = excelUpdates(a, true);
    await patchWorkbook(buf, dry.values, dry.cached);
  } catch (e) {
    throw new DraftError(`เขียนเลขเครื่องลงไฟล์ Excel ไม่ได้: ${e instanceof Error ? e.message : e}`);
  }

  const fresh = a.lines.filter((l) => l.status === NEW);
  const keep = a.lines.filter((l) => l.status === KEEP);
  if (fresh.length || keep.length) {
    const { issued } = await api<{ issued: { number: string; full: string }[] }>('engineIssue', {
      taskId: task.id, blNo: inv.bl_no, invoiceNo: inv.invoice_no, sourceFile: name,
      issue: fresh.map((l) => ({ head: l.engine.head, chassis: l.car.chassis })),
      add: keep.map((l) => ({ number: l.number, full: l.full_engine, chassis: l.car.chassis })),
    });
    fresh.forEach((l, i) => { l.number = issued[i].number; l.full_engine = issued[i].full; });
  }
  const csv = buildCsv(a, deps.data);
  const up = excelUpdates(a);
  const base = safeName(inv.bl_no);
  const csvPath = join(dir, `${base}.csv`);
  const excelPath = join(dir, `${base}${ext}`);
  writeFileSync(csvPath, csv.bytes);
  writeFileSync(excelPath, await patchWorkbook(buf, up.values, up.cached));
  log(`เลขเครื่อง ${a.lines.length} คัน (สุ่มใหม่ ${fresh.length} · ใช้เลขเดิม ${a.lines.length - fresh.length})  CSV ${base}.csv`);

  const refNo = await createDraft({
    csvPath, blNo: inv.bl_no, totals: csv.totals, settings: deps.netbay, info, log, onStep: deps.onStep,
  });
  return { refNo, excel: excelPath, csv: csvPath };
}

/* ---------------- งานที่ทำใน NETBAY แล้ว (กันสร้างใบขนซ้ำ) ---------------- */

const donePath = (deps: Deps, taskId: string) => join(deps.workDir, 'done', `${safeId(taskId)}.json`);

function readDone(deps: Deps, taskId: string): Result | null {
  const p = donePath(deps, taskId);
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, 'utf8')) as Result;
  return existsSync(d.excel) && existsSync(d.csv) ? d : null;
}

function writeDone(deps: Deps, taskId: string, r: Result) {
  mkdirSync(join(deps.workDir, 'done'), { recursive: true });
  writeFileSync(donePath(deps, taskId), JSON.stringify({ ...r, at: new Date().toISOString() }));
}

const asFile = (path: string, mimeType: string) => {
  const base64 = readFileSync(path).toString('base64');
  return { name: path.split(/[\\/]/).pop()!, mimeType, base64 };
};

/** ทำงาน 1 ชิ้นจากคิว แล้วส่งผล (หรือเหตุผลที่ไม่สำเร็จ) กลับ ERP */
export async function processTask(task: Task, deps: Deps) {
  const { api, log } = deps;
  const info: DraftInfo = { dialogs: [] };
  let result: Result;
  try {
    const done = readDone(deps, task.id);
    if (done) {            // ทำใน NETBAY ไปแล้วแต่ส่งผลกลับไม่ถึง — ส่งซ้ำ ไม่สร้างใบขนใบที่สอง
      log(`งานนี้สร้างใบขน ${done.refNo} ไปแล้ว — ส่งผลกลับอีกครั้ง`);
      result = done;
    } else {
      result = await makeDraft(task, deps, info);
      writeDone(deps, task.id, result);
    }
  } catch (e) {
    let msg = e instanceof DraftError ? e.message : `${e instanceof Error ? e.name : 'Error'}: ${e instanceof Error ? e.message : e}`;
    if (!(e instanceof DraftError) && info.refNo) msg += ` — ใบขน ${info.refNo} ถูกสร้างค้างไว้ใน NETBAY (ลบ หรือเปิดทำต่อเองได้)`;
    log(`ไม่สำเร็จ: ${msg}`);
    await api('failTask', { taskId: task.id, error: msg.slice(0, 1000) }).catch((x) => log(`ส่งเหตุผลกลับ ERP ไม่ได้: ${x}`));
    return;
  }

  let file: ReturnType<typeof asFile> | undefined = asFile(result.excel, XLSX_MIME);
  let csv: ReturnType<typeof asFile> | undefined = asFile(result.csv, 'text/csv');
  if (file.base64.length + csv.base64.length > MAX_UPLOAD) {
    log(`ไฟล์ใหญ่เกินส่งขึ้น ERP — ส่งเฉพาะ Ref No. (ไฟล์อยู่ที่ ${result.excel})`);
    file = undefined; csv = undefined;
  }
  for (const wait of deps.retryWaits ?? [0, 5, 20, 60]) {
    await sleep(wait * 1000);
    try {
      await api('completeTask', { taskId: task.id, refNo: result.refNo, file, csv });
      log(`เสร็จ: ใบขน ${result.refNo} ส่งกลับ ERP แล้ว`);
      return;
    } catch (e) {
      log(`ส่งผลกลับ ERP ไม่ได้: ${e instanceof Error ? e.message : e}`);
    }
  }
  log(`ยังส่งผลกลับไม่ได้ — งานจะถูกหยิบใหม่ใน 30 นาที แล้วส่ง ${result.refNo} ซ้ำ (ไม่สร้างใบขนใหม่)`);
}
