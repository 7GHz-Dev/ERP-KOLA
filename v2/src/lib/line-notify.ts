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

/**
 * OA ที่ใช้ส่ง — token ของ channel กับกลุ่มปลายทาง
 *
 * มีได้หลาย OA (ดู line-accounts.ts) เพราะแผนฟรีมีโควต้าต่อเดือน หมดแล้วต้องสลับไปตัวอื่น
 * ฟังก์ชันในไฟล์นี้รับ OA เข้ามาตรง ๆ ไม่ได้ไปอ่านฐานข้อมูลเอง จะได้ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 * ไม่ส่งมา = ใช้ OA ที่ตั้งไว้ใน env (LINE_CHANNEL_ACCESS_TOKEN + LINE_GROUP_ID) แบบเดิม
 */
export type LineTarget = { token: string; groupId: string };

export function envLineTarget(): LineTarget | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = process.env.LINE_GROUP_ID;
  return token && groupId ? { token, groupId } : null;
}

/** ตั้งค่าครบหรือยัง — ไม่ครบก็ใช้ระบบได้ปกติ แค่ไม่มีการแจ้งเตือน */
export function lineConfigured(): boolean {
  return envLineTarget() !== null;
}

export type LineResult = { ok: boolean; skipped?: boolean; error?: string };

/**
 * ส่งข้อความเข้ากลุ่ม
 *
 * timeout 10 วินาที เพราะฟังก์ชันนี้ถูกเรียกระหว่างที่ผู้ใช้รอหน้าเว็บตอบกลับ
 * ถ้า LINE ค้าง ผู้ใช้ไม่ควรต้องรอไปด้วยจนหมดเวลาของ serverless function
 */
export async function pushToLine(text: string, target: LineTarget | null = envLineTarget()): Promise<LineResult> {
  if (!target) return { ok: false, skipped: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify({
        to: target.groupId,
        // LINE จำกัดข้อความละ 5,000 ตัวอักษร ตัดกันไว้ก่อนเพื่อไม่ให้ทั้งข้อความหาย
        messages: [{ type: 'text', text: text.slice(0, 4900) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // 429 = โควต้าของเดือนหมด ข้อความนี้หายไปเลย ต้องสลับ OA ที่หน้าการใช้งานและค่าใช้จ่าย
      if (res.status === 429) return { ok: false, error: 'โควต้าข้อความของ LINE OA นี้หมดแล้ว' };
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
  /** ETA — วันที่เรือเข้า ใช้ดูว่าใบไหนต้องแลกก่อน */
  eta?: string | null;
};

/**
 * ข้อความแจ้งรายการใหม่
 *
 * หนึ่งบรรทัดต่อหนึ่งใบ — BL · Consignee · ETA
 * เอาเรือ/เที่ยวกับวันสุดท้ายของ DEM ออก เพราะฝั่งที่รับแจ้งใช้แค่สามตัวนี้
 * ในการหยิบงาน ส่วนรายละเอียดที่เหลือเปิดดูในระบบได้อยู่แล้ว
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเองเพื่อให้ทดสอบข้อความได้โดยไม่ต้องยิงเข้า LINE จริง
 */
export function newJobsMessage(jobs: NewJobLine[], from: string): string {
  const head = `📦 มีรายการใหม่รอแลก DO ${jobs.length} รายการ (จาก ${from})`;
  const lines = jobs.slice(0, 20).map((job, i) => {
    // ไม่มีเลข BL ใช้ Job No. แทน ไม่ปล่อยว่างจนไม่รู้ว่าใบไหน
    const parts = [`${i + 1}. BL : ${job.blNo || job.jobNo}`];
    if (job.consigneeName) parts.push(job.consigneeName);
    if (job.eta) parts.push(job.eta);
    return parts.join(' · ');
  });
  // เกิน 20 ใบไม่ไล่ทั้งหมด เพราะข้อความยาวเกินจะอ่านยากกว่าไม่มีรายละเอียดเลย
  if (jobs.length > 20) lines.push(`… และอีก ${jobs.length - 20} รายการ`);
  return [head, '', ...lines].join('\n');
}

/**
 * เตือนเมื่อโควต้าใกล้เต็ม — แนบท้ายข้อความปกติ ไม่ได้ส่งเป็นข้อความใหม่
 *
 * ถ้าส่งแยกอีกข้อความ ตัวเตือนเองก็กินโควต้าด้วย ซึ่งยิ่งเร่งให้เต็มเร็วขึ้น
 * แนบท้ายจึงได้ผลเดียวกันโดยไม่เสียอะไรเพิ่ม
 *
 * เตือนที่ 80% เพราะยังเหลือที่ให้ตัดสินใจทัน ถ้ารอถึง 100%
 * ข้อความจะเริ่มหายไปแล้วโดยไม่มีใครรู้ เนื่องจาก LINE ปฏิเสธเงียบ ๆ
 */
async function quotaWarning(token: string): Promise<string> {
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [q, c] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers, cache: 'no-store' }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers, cache: 'no-store' }),
    ]);
    if (!q.ok || !c.ok) return '';
    const quota = await q.json() as { type?: string; value?: number };
    const used = await c.json() as { totalUsage?: number };
    // แผนที่ไม่จำกัดไม่ต้องเตือน
    if (quota.type !== 'limited' || !quota.value || used.totalUsage === undefined) return '';
    const percent = (used.totalUsage / quota.value) * 100;
    if (percent < 80) return '';
    const left = quota.value - used.totalUsage;
    return `\n\n⚠️ โควต้าข้อความ LINE เหลือ ${left} จาก ${quota.value} (ใช้ไป ${Math.round(percent)}%)`
      + '\nถ้าเต็มแล้วข้อความแจ้งเตือนจะไม่ถูกส่งโดยไม่มีการแจ้งใด ๆ'
      + '\nADMIN สลับไปใช้ LINE OA ตัวอื่นได้ที่หน้า "การใช้งานและค่าใช้จ่าย"';
  } catch {
    // เช็คโควต้าไม่ได้ก็ส่งข้อความปกติไป ไม่ใช่เรื่องที่ควรขวางการแจ้งเตือน
    return '';
  }
}

/**
 * แจ้งรายการใหม่ — เรียกหลังบันทึกข้อมูลเสร็จแล้วเท่านั้น
 *
 * ไม่ await ผลที่ฝั่งผู้เรียกก็ได้ แต่บน Vercel ต้อง await
 * เพราะ serverless function จะถูกหยุดทันทีที่ response ถูกส่งกลับ
 * งานที่ยังค้างอยู่หลังจากนั้นจะไม่ได้รันต่อ การแจ้งเตือนจึงหายเงียบ ๆ
 */
export async function notifyNewJobs(
  jobs: NewJobLine[], from: string, target: LineTarget | null = envLineTarget(),
): Promise<LineResult> {
  if (!jobs.length) return { ok: false, skipped: true };
  if (!target) return { ok: false, skipped: true };
  const warning = await quotaWarning(target.token);
  return pushToLine(newJobsMessage(jobs, from) + warning, target);
}
