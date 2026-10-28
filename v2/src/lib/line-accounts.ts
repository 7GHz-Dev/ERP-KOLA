import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog, masterRecords } from '@/db/schema';
import { notifyNewJobs, type LineResult, type LineTarget, type NewJobLine } from '@/lib/line-notify';
import { lineQuota, type LineQuota } from '@/lib/queries/usage';
import { open } from '@/lib/secret-box';
import { LINE_SOURCE_ACTION } from '@/lib/usage-log';

/**
 * LINE OA หลายตัวสำหรับแจ้งเตือนแลก DO — ADMIN เลือกตัวที่ใช้ส่งได้จากหน้าการใช้งานและค่าใช้จ่าย
 *
 * แผนฟรีของ LINE มีโควต้าข้อความต่อเดือน หมดแล้ว LINE ปฏิเสธเงียบ ๆ ข้อความหายทั้งหมด
 * เดิมผูก OA ไว้ตัวเดียวใน env ต้องแก้ Vercel แล้ว deploy ใหม่ถึงจะเปลี่ยนได้
 * ตอนนี้เพิ่ม OA จากหน้าเว็บแล้วกดสลับได้ทันที
 *
 * - OA ใน env (LINE_CHANNEL_ACCESS_TOKEN / LINE_GROUP_ID) ยังเป็นตัวเลือกหนึ่ง id = env และเป็นค่าตั้งต้น
 * - OA ที่เพิ่มจากหน้าเว็บเก็บใน master_records (type lineAccount, code = userId ของ bot กันเพิ่มซ้ำ)
 *   token / Group ID / Channel secret เข้ารหัสด้วย secret-box ก่อนเก็บ
 * - ตัวที่เลือกเก็บที่ master_records (type lineSetting, code activeAccount)
 *
 * ไม่สลับ OA ให้เองเมื่อโควต้าหมด เพราะ OA อื่นอาจเป็นของงานอื่น (เช่นคุยกับลูกค้า)
 * ที่ไม่ควรถูกใช้โควต้าโดยไม่มีใครตั้งใจ
 */

export const LINE_ACCOUNT_TYPE = 'lineAccount';
export const ENV_LINE_ACCOUNT = 'env';
const ACTIVE = { type: 'lineSetting', code: 'activeAccount' } as const;

export type LineAccount = LineTarget & {
  id: string;
  name: string;
  basicId: string | null;
  /** Channel secret — ใช้ตรวจลายเซ็น webhook ตอนหา Group ID เท่านั้น */
  secret: string;
  fromEnv: boolean;
  /** ถอด token ไม่ได้ (SESSION_SECRET เปลี่ยน) — ต้องลบแล้วเพิ่มใหม่ */
  unreadable: boolean;
};

type Stored = { token: string; groupId: string; secret: string };

function envAccount(): LineAccount | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  return {
    id: ENV_LINE_ACCOUNT, name: 'LINE OA ที่ตั้งใน Vercel', basicId: null, token,
    groupId: process.env.LINE_GROUP_ID ?? '', secret: process.env.LINE_CHANNEL_SECRET ?? '',
    fromEnv: true, unreadable: false,
  };
}

export async function lineAccounts(): Promise<LineAccount[]> {
  const rows = await db
    .select({ id: masterRecords.id, name: masterRecords.name, basicId: masterRecords.description, value: masterRecords.value })
    .from(masterRecords)
    .where(eq(masterRecords.type, LINE_ACCOUNT_TYPE))
    .orderBy(asc(masterRecords.createdAt));
  const stored = rows.map((r): LineAccount => {
    let data: Partial<Stored> | null = null;
    try { data = JSON.parse(open(r.value) ?? 'null'); } catch { data = null; }
    return {
      id: r.id, name: r.name, basicId: r.basicId, fromEnv: false, unreadable: !data?.token,
      token: data?.token ?? '', groupId: data?.groupId ?? '', secret: data?.secret ?? '',
    };
  });
  const env = envAccount();
  return env ? [env, ...stored] : stored;
}

export async function activeLineAccountId(): Promise<string> {
  const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, ACTIVE.type), eq(masterRecords.code, ACTIVE.code))).limit(1);
  return row?.value || ENV_LINE_ACCOUNT;
}

/** ตัวที่ใช้ส่งจริง — ตัวที่เลือกถูกลบไปแล้วหรือข้อมูลไม่ครบ ถอยกลับไปตัวใน env */
function pickActive(accounts: LineAccount[], id: string): LineAccount | null {
  const usable = (a?: LineAccount) => (a && a.token && a.groupId ? a : null);
  return usable(accounts.find((a) => a.id === id)) ?? usable(accounts.find((a) => a.fromEnv));
}

export async function activeLineTarget(): Promise<LineTarget | null> {
  try {
    const [id, accounts] = await Promise.all([activeLineAccountId(), lineAccounts()]);
    const active = pickActive(accounts, id);
    return active ? { token: active.token, groupId: active.groupId } : null;
  } catch {
    // อ่านฐานข้อมูลไม่ได้ก็ยังส่งด้วยตัวใน env ได้ การแจ้งเตือนต้องไม่ล้มเพราะเรื่องนี้
    const env = envAccount();
    return env?.groupId ? { token: env.token, groupId: env.groupId } : null;
  }
}

/** แจ้งรายการใหม่รอแลก DO ด้วย OA ที่เลือกไว้ — ไม่ throw เหมือน notifyNewJobs */
export async function notifyDoQueue(jobs: NewJobLine[], from: string): Promise<LineResult> {
  if (!jobs.length) return { ok: false, skipped: true };
  return notifyNewJobs(jobs, from, await activeLineTarget());
}

export async function setActiveLineAccount(id: string) {
  await db.insert(masterRecords)
    .values({ id: `SET-LINE-ACTIVE`, type: ACTIVE.type, code: ACTIVE.code, name: 'LINE OA ที่ใช้ส่งแจ้งเตือนแลก DO', value: id })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value: id, updatedAt: new Date() } });
}

/** Channel secret ทุกตัว — webhook รับ event จาก OA ไหนก็ได้ที่เพิ่มไว้ (ใช้หา Group ID ของ OA ใหม่) */
export async function lineWebhookSecrets(): Promise<Array<{ id: string; secret: string }>> {
  const env = process.env.LINE_CHANNEL_SECRET ? [{ id: ENV_LINE_ACCOUNT, secret: process.env.LINE_CHANNEL_SECRET }] : [];
  try {
    const stored = (await lineAccounts()).filter((a) => !a.fromEnv && a.secret);
    return [...env, ...stored.map((a) => ({ id: a.id, secret: a.secret }))];
  } catch {
    return env;
  }
}

/* ---------- ถาม LINE ตรง ๆ — ทุกตัวไม่กินโควต้าข้อความ ---------- */

async function lineGet(token: string, path: string) {
  try {
    const res = await fetch(`https://api.line.me${path}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch (error) {
    return { status: 0, body: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export type LineBot = { ok: true; userId: string; basicId: string; name: string } | { ok: false; error: string };

export async function lineBotInfo(token: string): Promise<LineBot> {
  const r = await lineGet(token, '/v2/bot/info');
  if (r.status === 200) {
    return { ok: true, userId: String(r.body.userId ?? ''), basicId: String(r.body.basicId ?? ''), name: String(r.body.displayName ?? '-') };
  }
  if (r.status === 401) return { ok: false, error: 'token ไม่ถูกต้องหรือถูกออกใหม่แล้ว' };
  return { ok: false, error: r.status ? `LINE ตอบ ${r.status}` : String(r.body.message) };
}

export type LineGroup = { ok: boolean; name?: string; members?: number; error?: string };

/**
 * bot ของ OA นี้อยู่ในกลุ่มปลายทางหรือยัง — ส่งไม่ได้ส่วนใหญ่เพราะลืมเชิญ bot เข้ากลุ่ม
 * ตรวจได้เฉพาะกลุ่ม (ID ขึ้นต้นด้วย C) ห้องแชทหรือผู้ใช้ตรวจล่วงหน้าไม่ได้ ถือว่าใช้ได้
 */
export async function lineGroupInfo(token: string, groupId: string): Promise<LineGroup> {
  if (!groupId) return { ok: false, error: 'ยังไม่ได้ใส่ Group ID' };
  if (!groupId.startsWith('C')) return { ok: true };
  const base = `/v2/bot/group/${encodeURIComponent(groupId)}`;
  const [summary, count] = await Promise.all([lineGet(token, `${base}/summary`), lineGet(token, `${base}/members/count`)]);
  if (summary.status !== 200) {
    return {
      ok: false,
      error: summary.status === 400 || summary.status === 404
        ? 'bot ของ OA นี้ยังไม่อยู่ในกลุ่ม หรือ Group ID ไม่ตรง'
        : summary.status ? `LINE ตอบ ${summary.status}` : String(summary.body.message),
    };
  }
  return {
    ok: true,
    name: String(summary.body.groupName ?? ''),
    members: typeof count.body.count === 'number' ? count.body.count : undefined,
  };
}

/* ---------- หน้าการใช้งานและค่าใช้จ่าย ---------- */

export type LineAccountView = Omit<LineAccount, 'token' | 'secret'> & {
  active: boolean;
  hasSecret: boolean;
  bot: LineBot;
  group: LineGroup;
  quota: LineQuota;
  /** Group ID ที่ webhook ของ OA นี้เห็นล่าสุด — ใช้เติมให้ OA ที่ยังไม่มีกลุ่ม */
  seenGroups: string[];
};

/** Group ID ที่ webhook เห็นล่าสุดแยกตาม OA (บันทึกใน activity_log โดย /api/line/webhook) */
async function seenGroupsByAccount(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const rows = await db.select({ entityId: activityLog.entityId, detail: activityLog.detail })
    .from(activityLog).where(eq(activityLog.action, LINE_SOURCE_ACTION))
    .orderBy(desc(activityLog.createdAt)).limit(50);
  for (const row of rows) {
    let detail: { type?: string; account?: string } = {};
    try { detail = JSON.parse(row.detail ?? '{}'); } catch { /* แถวเก่าก่อนมีหลาย OA */ }
    const account = detail.account ?? ENV_LINE_ACCOUNT;
    if (detail.type !== 'group' || !row.entityId) continue;
    const list = map.get(account) ?? [];
    if (!list.includes(row.entityId) && list.length < 3) list.push(row.entityId);
    map.set(account, list);
  }
  return map;
}

export async function lineAccountsOverview(): Promise<LineAccountView[]> {
  const [accounts, activeId, seen] = await Promise.all([lineAccounts(), activeLineAccountId(), seenGroupsByAccount()]);
  const active = pickActive(accounts, activeId);
  return Promise.all(accounts.map(async ({ token, secret, ...a }): Promise<LineAccountView> => {
    const unreadable: LineBot = { ok: false, error: 'ถอดรหัส token ไม่ได้ (SESSION_SECRET ถูกเปลี่ยน) — ลบแล้วเพิ่มใหม่' };
    const [bot, group, quota] = a.unreadable
      ? [unreadable, { ok: false }, await lineQuota(null)]
      : await Promise.all([lineBotInfo(token), lineGroupInfo(token, a.groupId), lineQuota(token)]);
    return { ...a, active: active?.id === a.id, hasSecret: Boolean(secret), bot, group, quota, seenGroups: seen.get(a.id) ?? [] };
  }));
}
