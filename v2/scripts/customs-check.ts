/**
 * ตัว monitor ใบขน — เช็ก 1 รอบ: login NETBAY ครั้งเดียว แล้วไล่ทุก Ref No. ที่ค้าง
 *
 *   ไม่พบแถว           -> สถานะ NOT_FOUND (ป้ายแดงในคิว) เช็กต่อรอบหน้า
 *   ยังไม่ ACCEPT       -> ส่งสถานะที่เห็นเข้า ERP เช็กต่อรอบหน้า (REJECT ฯลฯ ก็เช็กต่อ รอ FAH แก้แล้วส่งใหม่)
 *   ACCEPT + มีเลขใบขน -> ดาวน์โหลด PDF (Save PDF -> zip) แล้ว completeTask: เลขใบขน + PDF
 *                         ERP ตั้งงานเป็น FILED งานจึงไปที่ งานคงค้าง > 4. เตรียมเอกสารเดิน E เอง
 *
 * รายการไหนพังไม่ลามไปรายการอื่น — บันทึกข้อผิดพลาดไว้ที่แถวนั้นแล้วรอบหน้าลองใหม่
 * แยกจากตัววน (customs-monitor.ts) ให้เทสต์กับ ERP จำลอง + NETBAY จำลองได้ (tests/customs-monitor.ts)
 */
import type { Page } from 'playwright-core';
import { NOT_FOUND } from '../src/lib/customs-status';
import {
  acceptedByFilter, check, downloadDeclarationPdf, launch, login, readDeclaration, type NetbaySettings,
} from './netbay-kola';

export type Api = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;

/** รายการจาก customsMonitorTasks ของ ERP */
export type MonitorTask = { id: string; jobNo: string | null; blNo: string | null; refNo: string; checkedAt: string | null };

export type Deps = {
  api: Api;
  netbay: NetbaySettings;
  workDir: string;
  log: (msg: string) => void;
  /** ภาพหน้าจอขึ้น ERP หลังเช็กแต่ละรายการ */
  onStep?: (page: Page) => Promise<void>;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function checkRound(tasks: MonitorTask[], deps: Deps) {
  const { api, log } = deps;
  const report = (taskId: string, result: { status?: string; error?: string }) =>
    api('customsStatus', { taskId, ...result });
  check(deps.netbay);

  const result = { accepted: 0, waiting: 0, failed: 0 };
  const browser = await launch(deps.netbay);
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    context.setDefaultTimeout(30_000);
    context.on('dialog', (d) => {
      log(`  NETBAY แจ้ง: ${d.message().slice(0, 200)}`);
      d.accept().catch(() => {});
    });
    const page = await context.newPage();

    log('login NETBAY ...');
    let listUrl: string;
    try {
      listUrl = await login(page, deps.netbay);
    } catch (e) {
      // เข้า NETBAY ไม่ได้ทั้งรอบ — บอกไว้ทุกแถว ให้คนดูคิวรู้ว่าทำไมยังไม่ขยับ
      for (const t of tasks) await report(t.id, { error: `เข้า NETBAY ไม่ได้: ${message(e)}` }).catch(() => {});
      throw e;
    }

    for (const t of tasks) {
      const label = `${t.refNo || '(ไม่มี Ref No.)'}${t.jobNo ? ` · งาน ${t.jobNo}` : ''}`;
      try {
        if (!t.refNo) throw new Error('งานนี้ไม่มี Ref No. — ให้ PAINT สร้าง Draft ใหม่');
        const row = await readDeclaration(page, listUrl, t.refNo);
        if (!row.found) {
          await report(t.id, { status: NOT_FOUND });
          log(`  ${label}: ไม่พบใน NETBAY`);
          result.waiting += 1;
          continue;
        }

        let status: string | null = row.status;
        // อ่านป้ายไม่ออก แต่มีเลขใบขนแล้ว — ถามช่อง Status ของ NETBAY ตรง ๆ ว่า Accept หรือยัง
        if (!status && row.declarationNo && await acceptedByFilter(page, listUrl, t.refNo)) status = 'ACCEPT';
        if (status !== 'ACCEPT') {
          const shown = status ?? `ไม่รู้จักสถานะ (${row.image || 'ไม่มีรูปป้าย'})`;
          await report(t.id, { status: shown });
          log(`  ${label}: ${shown}`);
          result.waiting += 1;
          continue;
        }
        if (!row.declarationNo) {
          await report(t.id, { status, error: 'ACCEPT แล้วแต่คอลัมน์ DECLARATION NO ยังว่าง — รอบหน้าเช็กใหม่' });
          log(`  ${label}: ACCEPT แต่ยังไม่มีเลขใบขน`);
          result.waiting += 1;
          continue;
        }

        log(`  ${label}: ACCEPT เลขใบขน ${row.declarationNo} — ดาวน์โหลด PDF ...`);
        const pdf = await downloadDeclarationPdf(page, listUrl, t.refNo, row.declarationNo, deps.workDir);
        await report(t.id, { status });
        await api('completeTask', {
          taskId: t.id, entryNo: row.declarationNo,
          file: { name: pdf.name, mimeType: 'application/pdf', base64: pdf.body.toString('base64') },
        });
        log(`  ✓ ${label}: ได้เลขใบขน ${row.declarationNo} + PDF แล้ว`);
        result.accepted += 1;
      } catch (e) {
        result.failed += 1;
        log(`  ✗ ${label}: ${message(e)}`);
        await report(t.id, { error: message(e) }).catch(() => {});
      }
      await deps.onStep?.(page);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}
