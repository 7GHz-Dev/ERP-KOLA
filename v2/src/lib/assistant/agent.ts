import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  ACTION_CODES, GROUP_KEYS, PIPELINE_STEP_KEYS, STEP_KEYS, STEPS,
  activity, countByStep, countGrouped, getJob, pipelineAsOf, searchJobs,
} from './data';

/**
 * ผู้ช่วยถามข้อมูล ERP (Chatbot)
 *
 * Claude ตอบโดยเรียกเครื่องมืออ่านข้อมูลใน data.ts เท่านั้น — ไม่มีเครื่องมือที่แก้ข้อมูล
 * ประวัติการคุยส่งมาเป็นข้อความล้วน (ไม่มีผลเครื่องมือของรอบก่อน) คำถามต่อเนื่องจึงให้บอทดึงข้อมูลใหม่เอง
 * ข้อมูลเปลี่ยนตลอดวันอยู่แล้ว ดึงสดดีกว่าตอบจากของเก่าในบทสนทนา
 */

export const MODEL = 'claude-opus-5-5';

/*
 * ราคา Claude Opus 5.5 (USD ต่อล้าน token) — ใช้คิดค่าใช้จ่ายรายคำถามลงบันทึก
 * คิดเป็นบาท ณ ตอนถาม แบบเดียวกับค่าอ่าน AN/BL (read-ai.ts) ราคาเปลี่ยนภายหลังยอดเก่าไม่เปลี่ยนตาม
 * เขียนลง cache คิด 1.25 เท่าของ input · อ่านจาก cache คิด $0.20
 * ถ้าคำถามถูกส่งต่อไปโมเดลสำรอง (fallback) ราคาจริงอาจต่างเล็กน้อย — ยอมรับได้สำหรับการติดตามยอด
 */
const PRICE = { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 };
const USD_THB = 33;

export type ChatUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; rounds: number };
export const emptyUsage = (): ChatUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, rounds: 0 });

export function usageBaht(u: ChatUsage): number {
  const usd = (u.input * PRICE.input + u.cacheWrite * PRICE.cacheWrite
    + u.cacheRead * PRICE.cacheRead + u.output * PRICE.output) / 1e6;
  return Math.round(usd * USD_THB * 10000) / 10000;
}
const MAX_ROUNDS = 8;

const SYSTEM = `คุณคือ "ผู้ช่วย KOLA" ผู้ช่วยตอบคำถามข้อมูลในระบบ KOLA ERP (งานนำเข้าสินค้าของ KOLA / MAESOT FREEZONE)
ผู้ถามคือพนักงาน PAINT, FAH, NAMKANG หรือผู้ดูแลระบบ ตอบเป็นภาษาไทย สั้น กระชับ ตรงคำถาม สรุปให้เข้าใจง่าย

## ลำดับงานในระบบ
1. PAINT รับ AN/BL ใส่ข้อมูล แล้วส่ง AN ให้ NAMKANG อนุมัติ
2. AN ผ่านแล้ว แยกเป็นสองสายขนานกัน:
   - FAH: อัป Invoice DO (InvDO) / ETA Official / Terminal แล้วส่ง Partner
   - PAINT: ทำ Final Invoice (FN) ส่ง FAH อนุมัติ → สร้าง Draft ใบขน ส่ง FAH ตรวจ → FAH ยื่นใบขน → ได้เลขใบขน → PAINT เตรียมเอกสาร E-Office ส่งมอบคนเดินเอกสาร → อัปชุดปล่อยที่เซ็นแล้ว ส่ง Partner
   - NAMKANG: ใส่ Client in Charge / ยืนยันข้อมูลลูกค้า / Surrender
3. หลังส่ง Partner: ANN แลก DO · MAY ตั้งเบิกค่า DO · NAMKANG ส่งแพลนลากตู้ → MAY รับแพลน
งานประเภท MUO: Partner แลก DO และลากตู้เอง ไม่เข้าคิวแลก DO / ตั้งเบิก / ลากตู้
"InvDO" = Invoice DO · "FN" = Final Invoice · "AN" = Arrival Notice

## ขั้นที่ค้นได้ (step)
${STEPS.map((s) => `- ${s.key} = ${s.owner}: ${s.label}`).join('\n')}

## วิธีทำงาน
- ใช้เครื่องมือดึงข้อมูลจริงทุกครั้ง ห้ามเดาตัวเลขหรือสถานะ ถ้าเครื่องมือไม่มีข้อมูลนั้นให้บอกตรง ๆ
- เลข BL / Job / ตู้ ที่ผู้ถามพิมพ์อาจไม่ครบหรือตัวพิมพ์เล็ก ให้ค้นด้วยส่วนที่พิมพ์มาได้เลย
- วันที่: ผู้ใช้มักเขียนแบบไทย วว/ดด/ปป เป็นปี พ.ศ. เช่น 30/10/69 = 30 ต.ค. 2569 = 2026-10-30 (ค.ศ. = พ.ศ. − 543) ส่งให้เครื่องมือเป็น YYYY-MM-DD เสมอ
- คำถามแบบ "วันที่ X มีงานรอ ... กี่งาน" ตีความได้สองแบบ:
  (ก) ณ สิ้นวันนั้นมีงานค้างขั้นนั้นกี่งาน → pipeline_as_of (ถ้าวันที่คือวันนี้ ใช้ count_by_stage ซึ่งตรงกับหน้างานจริงกว่า)
  (ข) งานที่ ETA วันนั้นยังค้างขั้นนั้นกี่งาน → search_jobs กรอง step + eta_from/eta_to
  ตอบแบบที่น่าจะใช่ที่สุดก่อน แล้วบอกตัวเลขอีกแบบสั้น ๆ ในบรรทัดเดียว ถ้าดึงได้ไม่ยาก
- ถามสถานะงานใบเดียว → get_job แล้วสรุป: ตอนนี้อยู่ขั้นไหน (current_steps) · อะไรเสร็จแล้ว · รออะไร/ใคร · วันที่สำคัญ
- ตอบตัวเลขให้บอกหน่วย (งาน / ตู้) และขอบเขตที่นับ ถ้าตัวเลขมาจากการคำนวณย้อนหลัง ให้บอกข้อจำกัดสั้น ๆ

## รูปแบบคำตอบ
- ใช้ Markdown แบบเรียบ: ตัวหนา รายการหัวข้อย่อย หรือตารางเมื่อมีหลายแถว
- อ้างถึงงานให้ทำเป็นลิงก์ไปหน้าสรุปงาน: [KOLA-2026-0431](/job/JOB-xxxx) โดยใช้ id จากผลเครื่องมือ
- รายการยาวเกิน 15 งาน ให้สรุปจำนวนแล้วแสดงแค่บางส่วน พร้อมบอกว่ามีอีกกี่งาน
- ไม่ต้องเล่าว่ากำลังใช้เครื่องมืออะไร ตอบผลลัพธ์เลย`;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const TOOLS = [
  {
    name: 'search_jobs',
    description: 'ค้นหางานและนับจำนวน กรองด้วยข้อความ (เลข Job / BL / ตู้ / Shipper / Consignee / Client / เรือ / Ref / เลขใบขน), ขั้นที่ค้างอยู่ตอนนี้, ช่วง ETA, ช่วงวันที่สร้างงาน, ประเภทงาน คืน total_jobs, total_containers และรายการงานพร้อม current_steps',
    schema: z.object({
      query: z.string().max(100).optional(),
      step: z.enum(STEP_KEYS as [string, ...string[]]).optional(),
      eta_from: iso.optional(), eta_to: iso.optional(),
      created_from: iso.optional(), created_to: iso.optional(),
      job_type: z.string().max(60).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'ข้อความค้นหา คั่นหลายคำด้วยช่องว่างได้ (ทุกคำต้องเจอ)' },
        step: { type: 'string', enum: STEP_KEYS, description: 'ขั้นที่งานค้างอยู่ตอนนี้' },
        eta_from: { type: 'string', description: 'YYYY-MM-DD' },
        eta_to: { type: 'string', description: 'YYYY-MM-DD' },
        created_from: { type: 'string', description: 'วันที่สร้างงาน YYYY-MM-DD (เวลาไทย)' },
        created_to: { type: 'string', description: 'YYYY-MM-DD' },
        job_type: { type: 'string', description: 'ชื่อประเภทงานบางส่วน เช่น MUO, USED CAR' },
        limit: { type: 'integer', description: 'จำนวนงานที่แสดง (ค่าตั้งต้น 15 สูงสุด 50) — total นับครบเสมอ' },
      },
      additionalProperties: false,
    },
    run: (i: any) => searchJobs(i),
  },
  {
    name: 'get_job',
    description: 'รายละเอียดเต็มของงานหนึ่งใบ: ขั้นที่ค้างอยู่ สถานะ AN/FN/ใบขน/Surrender วันที่ส่ง Partner แลก DO ตั้งเบิก ค่า DO ตู้ แพลนลากตู้ ไฟล์ปัจจุบัน ประวัติอนุมัติ และประวัติสถานะ ถ้าเจอหลายงานจะคืน candidates',
    schema: z.object({ ref: z.string().min(2).max(80) }),
    input_schema: {
      type: 'object' as const,
      properties: { ref: { type: 'string', description: 'เลข Job / BL / ตู้ / Ref NETBAY / เลขใบขน หรือ id (JOB-...)' } },
      required: ['ref'],
      additionalProperties: false,
    },
    run: (i: any) => getJob(i.ref),
  },
  {
    name: 'count_by_stage',
    description: 'จำนวนงานและตู้ที่ค้างแต่ละขั้น ณ ตอนนี้ (ตรงกับตัวเลขบนหน้างานของแต่ละแผนก) กรองช่วง ETA ได้',
    schema: z.object({ eta_from: iso.optional(), eta_to: iso.optional() }),
    input_schema: {
      type: 'object' as const,
      properties: { eta_from: { type: 'string', description: 'YYYY-MM-DD' }, eta_to: { type: 'string', description: 'YYYY-MM-DD' } },
      additionalProperties: false,
    },
    run: (i: any) => countByStep(i),
  },
  {
    name: 'count_jobs_grouped',
    description: 'นับงาน (และตู้) แยกกลุ่ม เช่น ตาม Consignee, Shipper, Client in charge, ประเภทงาน, เรือ, ท่าเรือ, วัน/เดือน ETA, วัน/เดือนที่สร้างงาน กรองได้เหมือน search_jobs',
    schema: z.object({
      group_by: z.enum(GROUP_KEYS as [string, ...string[]]),
      query: z.string().max(100).optional(),
      step: z.enum(STEP_KEYS as [string, ...string[]]).optional(),
      eta_from: iso.optional(), eta_to: iso.optional(),
      created_from: iso.optional(), created_to: iso.optional(),
      job_type: z.string().max(60).optional(),
    }),
    input_schema: {
      type: 'object' as const,
      properties: {
        group_by: { type: 'string', enum: GROUP_KEYS },
        query: { type: 'string' },
        step: { type: 'string', enum: STEP_KEYS },
        eta_from: { type: 'string' }, eta_to: { type: 'string' },
        created_from: { type: 'string' }, created_to: { type: 'string' },
        job_type: { type: 'string' },
      },
      required: ['group_by'],
      additionalProperties: false,
    },
    run: (i: any) => countGrouped(i),
  },
  {
    name: 'pipeline_as_of',
    description: 'จำนวนงานที่ค้างแต่ละขั้น ณ สิ้นวันที่ระบุในอดีต (คำนวณย้อนหลังจากเวลาที่บันทึกของแต่ละขั้น) ใส่ include_jobs=true เพื่อขอรายชื่องานด้วย (ควรใส่ step ด้วย)',
    schema: z.object({
      date: iso,
      step: z.enum(PIPELINE_STEP_KEYS as [string, ...string[]]).optional(),
      include_jobs: z.boolean().optional(),
    }),
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        step: { type: 'string', enum: PIPELINE_STEP_KEYS, description: 'fah-do = รอ InvDO/ส่ง Partner' },
        include_jobs: { type: 'boolean' },
      },
      required: ['date'],
      additionalProperties: false,
    },
    run: (i: any) => pipelineAsOf(i.date, i.step, i.include_jobs),
  },
  {
    name: 'activity_log',
    description: 'บันทึกการทำงานของงานในช่วงวันที่: ใครทำอะไร เมื่อไร (ส่ง/อนุมัติ AN-FN, อัปไฟล์, ส่ง InvDO ให้ Partner, แลก DO, ตั้งเบิก ฯลฯ) พร้อมยอดรวมแต่ละการกระทำ กรองเฉพาะงานหรือเฉพาะการกระทำได้',
    schema: z.object({
      date_from: iso, date_to: iso.optional(),
      job_ref: z.string().max(80).optional(),
      action: z.enum(ACTION_CODES as [string, ...string[]]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'YYYY-MM-DD' },
        date_to: { type: 'string', description: 'YYYY-MM-DD (ไม่ใส่ = วันเดียว)' },
        job_ref: { type: 'string', description: 'เลข Job / BL / ตู้ ถ้าต้องการเฉพาะงานนั้น' },
        action: { type: 'string', enum: ACTION_CODES },
        limit: { type: 'integer' },
      },
      required: ['date_from'],
      additionalProperties: false,
    },
    run: (i: any) => activity(i),
  },
];

/** ข้อความสั้น ๆ ที่หน้าจอแสดงระหว่างรอเครื่องมือ */
const TOOL_LABELS: Record<string, string> = {
  search_jobs: 'ค้นหางาน', get_job: 'เปิดรายละเอียดงาน', count_by_stage: 'นับงานค้างแต่ละขั้น',
  count_jobs_grouped: 'นับงานแยกกลุ่ม', pipeline_as_of: 'คำนวณงานค้างย้อนหลัง', activity_log: 'ดูบันทึกการทำงาน',
};

const API_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
  eager_input_streaming: true,
}));

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatEvent =
  | { t: 'text'; d: string }
  | { t: 'step'; label: string }
  | { t: 'done'; usage: ChatUsage & { baht: number } }
  | { t: 'error'; message: string };

function todayBangkok() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

/**
 * คุยหนึ่งรอบ — วนเรียกเครื่องมือจนได้คำตอบ ส่งเหตุการณ์ออกทาง emit ทีละชิ้น
 *
 * ประวัติในรอบเดียวกันต่อท้ายอย่างเดียว (append-only) ไม่แก้ของเดิม
 * วันที่วันนี้อยู่ใน system ก้อนที่สอง ก้อนแรกกับรายการเครื่องมือคงที่จึงใช้ cache ได้ทุกครั้ง
 */
export async function runChat(
  history: ChatTurn[], emit: (e: ChatEvent) => void, usage: ChatUsage, signal?: AbortSignal,
) {
  // usage มาจากผู้เรียก — ล้มกลางทางก็ยังรู้ว่าใช้ token ไปเท่าไรแล้ว (เสียเงินไปแล้วจริง)
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    usage.rounds = round + 1;
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: `วันนี้: ${todayBangkok()} (เวลาไทย)` },
      ],
      tools: API_TOOLS,
      messages,
    }, { signal });

    stream.on('text', (d) => emit({ t: 'text', d }));
    const message = await stream.finalMessage();
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

    if (message.stop_reason === 'refusal') {
      emit({ t: 'error', message: 'คำถามนี้ตอบไม่ได้ ลองถามใหม่อีกแบบ' });
      return usage;
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || !calls.length) return usage;

    messages.push({ role: 'assistant', content: message.content });
    // แยกย่อหน้าระหว่างข้อความก่อนเรียกเครื่องมือกับคำตอบจริง
    emit({ t: 'text', d: '\n\n' });

    const results = await Promise.all(calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
      const tool = TOOLS.find((t) => t.name === call.name);
      emit({ t: 'step', label: TOOL_LABELS[call.name] ?? call.name });
      if (!tool) return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `ไม่มีเครื่องมือ ${call.name}` };
      // eager_input_streaming ทำให้เซิร์ฟเวอร์ไม่ตรวจ input ให้ ต้องตรวจเองก่อนรันทุกครั้ง
      const parsed = tool.schema.safeParse(call.input);
      if (!parsed.success) {
        return {
          type: 'tool_result', tool_use_id: call.id, is_error: true,
          content: `input ไม่ถูกต้อง: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        };
      }
      try {
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(await tool.run(parsed.data)) };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: call.id, is_error: true, content: `ดึงข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  emit({ t: 'text', d: '\n\n(หยุดค้นต่อเพราะใช้หลายขั้นเกินไป ลองถามให้แคบลง)' });
  return usage;
}
