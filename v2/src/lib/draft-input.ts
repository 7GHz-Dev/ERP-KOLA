import { analyze, buildCsv, KEEP, lookupKeys, NEW, safeName, type EngineLookup, type EngineRow } from '@/lib/draft/analyze';
import { loadDraftData, type Totals } from '@/lib/draft/csv';
import { readInvoice } from '@/lib/draft/invoice';
import { engineLookup, issueEngineNumbers } from '@/lib/engine-numbers';

/**
 * CSV สำหรับ Draft ใบขน ที่เซิร์ฟเวอร์สร้างจาก Final Invoice ตอนกด "สร้าง Draft"
 *
 * ทีมขอให้ worker นำ CSV ที่ได้หลังสร้าง Final Invoice ไปยื่น NETBAY แทนการให้ worker อ่าน .xlsx เอง
 * ใช้ตัวตรวจและตัวสร้าง CSV ชุดเดียวกับ worker (lib/draft/analyze) ไฟล์จึงตรงกันทุกช่อง
 *
 * ใช้ได้เมื่อรถทุกคันมีเลขเครื่องแล้ว — Final Invoice จาก Create Cargo Invoice ออกเลขตอนบันทึกอยู่แล้ว
 * ใบที่ยังไม่มีเลข (เช่นอัปโหลด Final Invoice เอง) คืน null ให้ใช้ทางเดิม: worker อ่าน .xlsx แล้วออกเลขเอง
 */
export type DraftCsvInput = { bytes: Buffer; fileName: string; blNo: string; totals: Totals; warnings: string[] };

const normBl = (s: string) => (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function lookupFrom(rows: EngineRow[]): EngineLookup {
  return {
    find: (n) => rows.filter((r) => r.number === n),
    history: (c) => rows.filter((r) => r.chassis === c).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
}

export async function draftCsvInput(
  finalInvoice: Buffer,
  ctx: { jobId: string; jobBl: string | null; sourceFile: string },
): Promise<DraftCsvInput | null> {
  const inv = await readInvoice(finalInvoice);
  const data = await loadDraftData();
  const keys = lookupKeys(inv);
  const rows = keys.numbers.length || keys.chassis.length ? await engineLookup(keys.numbers, keys.chassis) : [];
  const a = analyze(inv, data, lookupFrom(rows), { reuseBl: true });
  // ไฟล์ไม่ผ่านการตรวจ หรือยังมีคันที่ต้องสุ่มเลขใหม่ — ให้ worker ทำทางเดิม (แจ้งเหตุผลกลับงานเหมือนเดิม)
  if (!a.ok || a.lines.some((l) => l.status === NEW)) return null;

  const want = ctx.jobBl ?? '';
  if (want && !normBl(want).includes(normBl(inv.bl_no)) && !normBl(inv.bl_no).includes(normBl(want))) {
    throw new Error(`เลข BL ใน Final Invoice (${inv.bl_no}) ไม่ตรงกับงาน (${want}) — ตรวจว่าแนบ Final Invoice ถูกงาน`);
  }

  // เลขที่มีครบในไฟล์แต่ยังไม่อยู่ในตาราง — บันทึกเพิ่มแบบที่ worker เคยทำ กันเลขซ้ำกับใบอื่นภายหลัง
  const keep = a.lines.filter((l) => l.status === KEEP);
  if (keep.length) {
    await issueEngineNumbers({
      taskId: null, jobId: ctx.jobId, blNo: inv.bl_no, invoiceNo: inv.invoice_no, sourceFile: ctx.sourceFile,
      issue: [], add: keep.map((l) => ({ number: l.number, full: l.full_engine, chassis: l.car.chassis })),
    });
  }

  const csv = buildCsv(a, data);
  return {
    bytes: Buffer.from(csv.bytes), fileName: `${safeName(inv.bl_no)}.csv`, blNo: inv.bl_no,
    totals: csv.totals, warnings: a.warnings,
  };
}
