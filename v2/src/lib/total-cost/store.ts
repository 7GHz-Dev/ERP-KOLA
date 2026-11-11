import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog, jobs, shipmeCostLines, shipmeCosts, specialChargeItems, specialCharges } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { jobsForBl } from '@/lib/cargo-invoice/jobs';
import { CHARGE_STATUS, type ChargeStatus } from '@/lib/sale/charges';
import { blKey, round2, summarize, type CostBl, type CostInvoiceRef, type CostPayload, type RawLine, type SaleSpecial } from './cost';

/**
 * Total cost ในฐานข้อมูล — BL ละแถว รับจาก SHIPME แล้วแทนรายการเดิมทั้งชุด
 */

async function receiveOne(bl: CostBl, batchName: string | null) {
  const key = blKey(bl.blNo);
  const [existing] = await db.select({ id: shipmeCosts.id, jobId: shipmeCosts.jobId })
    .from(shipmeCosts).where(eq(shipmeCosts.blKey, key)).limit(1);
  // งานที่ผูกไว้แล้วไม่เปลี่ยน — หาใหม่เฉพาะที่ยังไม่พบงาน
  let jobId = existing?.jobId ?? null;
  let jobMatches = jobId ? 1 : 0;
  if (!jobId) {
    const matches = await jobsForBl(bl.blNo);
    jobMatches = matches.length;
    jobId = matches.length === 1 ? matches[0].id : null;
  }
  const id = existing?.id ?? newId('TCO');
  const values = {
    blNo: bl.blNo, jobId, customer: bl.customer, batchName: bl.invoices.find((i) => i.batchName)?.batchName ?? batchName,
    invoicesJson: JSON.stringify(bl.invoices), updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    if (existing) {
      await tx.update(shipmeCosts).set(values).where(eq(shipmeCosts.id, id));
      await tx.delete(shipmeCostLines).where(eq(shipmeCostLines.costId, id));
    } else {
      await tx.insert(shipmeCosts).values({ id, blKey: key, ...values });
    }
    if (bl.lines.length) {
      await tx.insert(shipmeCostLines).values(bl.lines.map((l, i) => ({
        id: newId('TCL'), costId: id, lineNo: i + 1, source: l.source, ref: l.ref, kind: l.kind, sourceKey: l.key,
        label: l.label, amount: String(l.amount), vat: String(l.vat), note: l.note,
      })));
    }
  });
  return { blNo: bl.blNo, id, created: !existing, jobMatched: Boolean(jobId), jobMatches, lines: bl.lines.length };
}

export async function receiveCosts(p: CostPayload) {
  const results = [];
  for (const bl of p.bls) results.push(await receiveOne(bl, p.batchName));
  await db.insert(activityLog).values({
    id: newId('LOG'), userId: 'SHIPME', action: 'SHIPME_COSTS_RECEIVED', entityType: 'SHIPME_COST', entityId: results[0]?.id ?? '-',
    detail: JSON.stringify({ batchName: p.batchName, bls: results.length, lines: results.reduce((s, r) => s + r.lines, 0) }),
  });
  return results;
}

/**
 * ค่าใช้จ่ายพิเศษจาก Sale (ยางเกิน / สำแดงเท็จ) ของหลาย BL
 * ใช้ชุดล่าสุดของ BL (SHIPME ส่งชุดใหม่ -2, -3 เมื่อรายการเปลี่ยนหลังเริ่มเจรจา)
 * อนุมัติแล้ว = ยอดที่ตกลง · ยังไม่อนุมัติ = ยอดที่ SHIPME ขอ (ติดป้ายให้รู้)
 */
async function saleSpecials(keys: string[]): Promise<Map<string, SaleSpecial>> {
  const out = new Map<string, SaleSpecial>();
  if (!keys.length) return out;
  const heads = await db.select({ id: specialCharges.id, blNo: specialCharges.blNo, status: specialCharges.status, receivedAt: specialCharges.receivedAt })
    .from(specialCharges)
    .where(inArray(sql`regexp_replace(upper(${specialCharges.blNo}), '[^A-Z0-9]', '', 'g')`, keys))
    .orderBy(desc(specialCharges.receivedAt));
  const latest = new Map<string, (typeof heads)[number]>();
  for (const h of heads) if (!latest.has(blKey(h.blNo))) latest.set(blKey(h.blNo), h);
  if (!latest.size) return out;
  const ids = [...latest.values()].map((h) => h.id);
  const items = await db.select({ chargeId: specialChargeItems.chargeId, code: specialChargeItems.code, description: specialChargeItems.description,
    requested: specialChargeItems.requestedAmount, agreed: specialChargeItems.agreedAmount })
    .from(specialChargeItems).where(inArray(specialChargeItems.chargeId, ids));
  for (const [key, h] of latest) {
    const approved = h.status === 'APPROVED';
    const mine = items.filter((i) => i.chargeId === h.id
      && (i.code === 'TIRE_OVER' || i.code === 'FALSE_DECL' || /ยางเกิน|สำแดงเท็จ/.test(i.description)));
    if (!mine.length) continue;
    const amount = round2(mine.reduce((s, i) => s + Number(approved && i.agreed !== null ? i.agreed : i.requested), 0));
    out.set(key, { amount, approved, status: CHARGE_STATUS[h.status as ChargeStatus] ?? h.status, chargeId: h.id, items: mine.length });
  }
  return out;
}

const toRaw = (l: typeof shipmeCostLines.$inferSelect): RawLine => ({
  source: l.source as RawLine['source'], ref: l.ref, kind: l.kind, key: l.sourceKey,
  label: l.label, amount: Number(l.amount), vat: Number(l.vat), note: l.note,
});

const invoicesOf = (json: string): CostInvoiceRef[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

export async function listTotalCosts(search: string) {
  const q = search.trim();
  const like = `%${q.replace(/[%_\\]/g, '')}%`;
  const heads = await db.select({ c: shipmeCosts, jobNo: jobs.jobNo })
    .from(shipmeCosts)
    .leftJoin(jobs, eq(jobs.id, shipmeCosts.jobId))
    .where(q ? sql`(${shipmeCosts.blNo} ilike ${like} or ${shipmeCosts.blKey} ilike ${`%${blKey(q)}%`} or ${jobs.jobNo} ilike ${like}
      or ${shipmeCosts.customer} ilike ${like} or ${shipmeCosts.batchName} ilike ${like} or ${shipmeCosts.invoicesJson} ilike ${like})` : undefined)
    .orderBy(desc(shipmeCosts.updatedAt))
    .limit(500);
  const ids = heads.map((h) => h.c.id);
  const [lines, sale] = await Promise.all([
    ids.length ? db.select().from(shipmeCostLines).where(inArray(shipmeCostLines.costId, ids)).orderBy(asc(shipmeCostLines.lineNo)) : Promise.resolve([]),
    saleSpecials(heads.map((h) => h.c.blKey)),
  ]);
  const byCost = new Map<string, RawLine[]>();
  for (const l of lines) byCost.set(l.costId, [...(byCost.get(l.costId) ?? []), toRaw(l)]);
  return heads.map(({ c, jobNo }) => ({
    id: c.id, blNo: c.blNo, jobId: c.jobId, jobNo, customer: c.customer, batchName: c.batchName,
    invoices: invoicesOf(c.invoicesJson), updatedAt: c.updatedAt,
    summary: summarize(byCost.get(c.id) ?? [], sale.get(c.blKey) ?? null),
  }));
}

export async function getTotalCost(id: string) {
  const [row] = await db.select({ c: shipmeCosts, jobNo: jobs.jobNo })
    .from(shipmeCosts).leftJoin(jobs, eq(jobs.id, shipmeCosts.jobId)).where(eq(shipmeCosts.id, id)).limit(1);
  if (!row) return null;
  const [lines, sale] = await Promise.all([
    db.select().from(shipmeCostLines).where(eq(shipmeCostLines.costId, id)).orderBy(asc(shipmeCostLines.lineNo)),
    saleSpecials([row.c.blKey]),
  ]);
  return {
    id: row.c.id, blNo: row.c.blNo, jobId: row.c.jobId, jobNo: row.jobNo, customer: row.c.customer,
    batchName: row.c.batchName, invoices: invoicesOf(row.c.invoicesJson), receivedAt: row.c.receivedAt, updatedAt: row.c.updatedAt,
    summary: summarize(lines.map(toRaw), sale.get(row.c.blKey) ?? null),
  };
}
