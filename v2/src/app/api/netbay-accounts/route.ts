import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { netbayChoices } from '@/lib/netbay-accounts';

export const dynamic = 'force-dynamic';

/** บัญชี NETBAY ให้เลือกก่อนกด "สร้าง Draft" / "Refresh" — ชื่อบัญชีกับเครื่องที่จองไว้ ไม่มีรหัสผ่าน */
export async function GET() {
  if (!(await currentUser())) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, choices: await netbayChoices() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
