import Anthropic from '@anthropic-ai/sdk';
import { currentUser } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';
import { logActivity } from '@/lib/actions/common';
import { emptyUsage, runChat, usageBaht, type ChatEvent, type ChatTurn } from '@/lib/assistant/agent';
import { ASSISTANT_ACTION } from '@/lib/usage-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TURNS = 16;
const MAX_CHARS = 2000;

/**
 * ผู้ช่วยถามข้อมูล — รับประวัติการคุย (ข้อความล้วน) ส่งคำตอบกลับเป็น NDJSON ทีละบรรทัด
 * บรรทัดละเหตุการณ์: text (ข้อความที่ทยอยมา) · step (กำลังดึงข้อมูลอะไร) · done · error
 *
 * เปิดให้ role เดียวกับหน้าภาพรวมงาน — ANN · MAY · ACCOUNT ไม่ได้ดูข้อมูลทั้งระบบ
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return new Response('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (homePageFor(user.role) !== '/overview') return new Response('ไม่มีสิทธิ์ใช้ผู้ช่วย', { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response('ยังไม่ได้ตั้ง ANTHROPIC_API_KEY', { status: 503 });

  const body = await request.json().catch(() => null) as { messages?: unknown } | null;
  const raw = Array.isArray(body?.messages) ? body!.messages as unknown[] : [];
  const history: ChatTurn[] = raw
    .filter((m): m is ChatTurn => !!m && typeof m === 'object'
      && ['user', 'assistant'].includes((m as ChatTurn).role) && typeof (m as ChatTurn).content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .filter((m) => m.content.trim())
    .slice(-MAX_TURNS);
  // ต้องขึ้นต้นด้วยผู้ใช้ และจบด้วยคำถามของผู้ใช้
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') {
    return new Response('ไม่มีคำถาม', { status: 400 });
  }

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      const usage = emptyUsage();
      let ok = true;
      try {
        await runChat(history, emit, usage, request.signal);
        emit({ t: 'done', usage: { ...usage, baht: usageBaht(usage) } });
      } catch (e) {
        ok = false;
        emit({ t: 'error', message: errorMessage(e) });
      }
      /*
       * บันทึกทุกคำถามรวมที่ล้ม — ใช้ token ไปแล้วก็เสียเงินแล้ว หน้า Monitor ต้องเห็น
       * เก็บคำถามสั้น ๆ ไว้ดูว่าใช้ถามอะไรกัน ไม่เก็บคำตอบ
       */
      await logActivity(user.id, ASSISTANT_ACTION, 'AI', user.id, {
        q: history[history.length - 1].content.slice(0, 200),
        baht: usageBaht(usage), ms: Date.now() - started, ok, ...usage,
      }).catch(() => undefined);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'มีคนใช้ผู้ช่วยมากเกินไป รอสักครู่แล้วลองใหม่';
  if (e instanceof Anthropic.APIError) return `ผู้ช่วยตอบไม่ได้ (${e.status ?? 'เชื่อมต่อไม่ได้'})`;
  if (e instanceof Error && e.name === 'AbortError') return 'ยกเลิกแล้ว';
  return `เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`;
}
