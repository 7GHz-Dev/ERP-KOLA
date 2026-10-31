import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { AGENT_VERSION, isLatestAgent } from '@/lib/agent-version';

/**
 * เวอร์ชันโค้ดของแต่ละเครื่องในออฟฟิศ — ตัวเปิดบน Windows ถามทุกครั้งที่ถูกเรียก (agentCheck ใน /api/worker)
 * ได้คำตอบว่าเก่ากว่า ERP ก็อัปเดตตัวเองเบื้องหลัง แล้วรายงานเลขใหม่อีกครั้ง
 * เก็บใน master_records แถวละเครื่อง (code = ชื่อเครื่อง) หน้าติดตั้งแสดงว่าเครื่องไหนล่าสุดแล้ว
 */

const TYPE = 'agentVersion';

type Stored = { version: string; status?: string };

export async function recordAgentVersion(machineName: string, version: string, status = '') {
  const machine = machineName.trim().toLowerCase().slice(0, 120);
  const v = version.trim().slice(0, 40);
  if (machine) {
    const value = JSON.stringify({ version: v, status: status.slice(0, 200) } satisfies Stored);
    await db.insert(masterRecords)
      .values({ id: newId('AGV'), type: TYPE, code: machine, name: machine, value })
      .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
  }
  return { latest: AGENT_VERSION, upToDate: isLatestAgent(v) };
}

export type AgentMachine = { machine: string; version: string; status: string; seenAt: string; upToDate: boolean };

export async function agentMachines(): Promise<AgentMachine[]> {
  const rows = await db.select({ code: masterRecords.code, value: masterRecords.value, updatedAt: masterRecords.updatedAt })
    .from(masterRecords).where(eq(masterRecords.type, TYPE)).orderBy(desc(masterRecords.updatedAt));
  return rows.map((r) => {
    let s: Partial<Stored> = {};
    try { s = JSON.parse(r.value ?? '{}'); } catch { /* ค่าเสีย */ }
    return {
      machine: r.code ?? '', version: s.version ?? '', status: s.status ?? '',
      seenAt: r.updatedAt.toISOString(), upToDate: isLatestAgent(s.version),
    };
  });
}
