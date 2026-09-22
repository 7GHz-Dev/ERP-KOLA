/**
 * แจ้งเตือนเข้ากลุ่ม LINE เมื่อมีรายการใหม่เข้าคิวแลก DO
 *
 * ANN กับ MAY รอรายการจาก FAH และ PAINT ซึ่งทยอยส่งมาเรื่อย ๆ ไม่มีรอบแน่นอน
 * เดิมต้องเปิดหน้าเว็บดูเองว่ามีของใหม่หรือยัง ของที่ส่งตอนเย็นจึงมักเห็นเช้าวันรุ่งขึ้น
 *
 * ใช้ LINE Messaging API ไม่ใช่ LINE Notify เพราะ LINE Notify ปิดบริการไปแล้ว
 * เมษายน 2568 (ดู https://notify-bot.line.me/closing-announcement)
 *
 * ---
 * ออกแบบให้ "ส่งไม่ได้ต้องไม่ทำให้งานหลักพัง"
 *
 * การแจ้งเตือนเป็นของเสริม ส่วนการบันทึกว่าส่ง Partner แล้วเป็นงานหลัก
 * ถ้า LINE ล่ม คีย์หมดอายุ หรือเน็ตมีปัญหา แล้วปล่อยให้ error เด้งขึ้นไป
 * ผู้ใช้จะกดส่ง Partner ไม่ได้เลยทั้งที่ข้อมูลบันทึกเรียบร้อยแล้ว
 * ทุกฟังก์ชันในไฟล์นี้จึงกลืน error เองและคืนค่าบอกผลแทนการ throw
 */

/** ตั้งค่าครบหรือยัง — ไม่ครบก็ใช้ระบบได้ปกติ แค่ไม่มีการแจ้งเตือน */
export function lineConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_GROUP_ID);
}

export type LineResult = { ok: boolean; skipped?: boolean; error?: string };

/**
 * ส่งข้อความเข้ากลุ่ม
 *
 * timeout 10 วินาที เพราะฟังก์ชันนี้ถูกเรียกระหว่างที่ผู้ใช้รอหน้าเว็บตอบกลับ
 * ถ้า LINE ค้าง ผู้ใช้ไม่ควรต้องรอไปด้วยจนหมดเวลาของ serverless function
 */
export async function pushToLine(text: string): Promise<LineResult> {
  if (!lineConfigured()) return { ok: false, skipped: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: process.env.LINE_GROUP_ID,
        // LINE จำกัดข้อความละ 5,000 ตัวอักษร ตัดกันไว้ก่อนเพื่อไม่ให้ทั้งข้อความหาย
        messages: [{ type: 'text', text: text.slice(0, 4900) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `LINE ตอบ ${res.status} ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

export type NewJobLine = {
  blNo: string | null;
  jobNo: string;
  consigneeName?: string | null;
  vessel?: string | null;
  voyage?: string | null;
  /** วันสุดท้ายของ DEM — ตัวที่บอกว่าใบไหนต้องรีบ */
  lastDem?: string | null;
};

/**
 * ข้อความแจ้งรายการใหม่
 *
 * ใส่เฉพาะสิ่งที่ใช้ตัดสินใจว่า "ต้องรีบไหม" ได้จากในแชทโดยไม่ต้องเปิดเว็บ
 * คือเลข BL ลูกค้า และวันสุดท้ายของ DEM ส่วนรายละเอียดที่เหลืออยู่ในระบบอยู่แล้ว
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเองเพื่อให้ทดสอบข้อความได้โดยไม่ต้องยิงเข้า LINE จริง
 */
export function newJobsMessage(jobs: NewJobLine[], from: string): string {
  const head = `📦 มีรายการใหม่รอแลก DO ${jobs.length} รายการ (จาก ${from})`;
  const lines = jobs.slice(0, 20).map((job, i) => {
    const parts = [`${i + 1}. ${job.blNo || job.jobNo}`];
    if (job.consigneeName) parts.push(job.consigneeName);
    const vessel = [job.vessel, job.voyage].filter(Boolean).join(' / ');
    if (vessel) parts.push(vessel);
    if (job.lastDem) parts.push(`DEM ถึง ${job.lastDem}`);
    return parts.join(' · ');
  });
  // เกิน 20 ใบไม่ไล่ทั้งหมด เพราะข้อความยาวเกินจะอ่านยากกว่าไม่มีรายละเอียดเลย
  if (jobs.length > 20) lines.push(`… และอีก ${jobs.length - 20} รายการ`);
  return [head, '', ...lines].join('\n');
}

/**
 * แจ้งรายการใหม่ — เรียกหลังบันทึกข้อมูลเสร็จแล้วเท่านั้น
 *
 * ไม่ await ผลที่ฝั่งผู้เรียกก็ได้ แต่บน Vercel ต้อง await
 * เพราะ serverless function จะถูกหยุดทันทีที่ response ถูกส่งกลับ
 * งานที่ยังค้างอยู่หลังจากนั้นจะไม่ได้รันต่อ การแจ้งเตือนจึงหายเงียบ ๆ
 */
export async function notifyNewJobs(jobs: NewJobLine[], from: string): Promise<LineResult> {
  if (!jobs.length) return { ok: false, skipped: true };
  return pushToLine(newJobsMessage(jobs, from));
}
