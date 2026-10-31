import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { agentMachines } from '@/lib/agent-machines';
import { AGENT_VERSION } from '@/lib/agent-version';

export const dynamic = 'force-dynamic';

/** เวอร์ชันล่าสุด กับเวอร์ชันที่แต่ละเครื่องรายงานมาครั้งล่าสุด — ส่วน "ติดตั้งบนเครื่องนี้" */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json(
    { ok: true, latest: AGENT_VERSION, machines: await agentMachines() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
