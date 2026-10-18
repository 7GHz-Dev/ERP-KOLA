/**
 * ฝั่ง worker ของตัวบันทึกขั้นตอน — รับเหตุการณ์จาก scripts/web-recorder.js ที่ฉีดไว้ในหน้าเว็บ
 *
 * exposeBinding ผูกได้ครั้งเดียวต่อ context จึงผูกตั้งแต่เปิด Chrome (install)
 * แล้วส่งต่อให้รอบบันทึกที่ทำอยู่ ตอนไม่ได้บันทึก หน้าเว็บจะไม่เห็นแถบเครื่องมือ
 * สถานะและรายการขั้นอยู่ที่นี่ ไม่หายเมื่อหน้าเว็บเปลี่ยน
 */
import { join } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { Step } from '../src/lib/web-template';

type RecMsg = { kind?: string; step?: Step; url?: string };
type Source = { frame: { url(): string }; page: { mainFrame(): unknown } };

export type Recording = { steps: Step[]; startUrl: string };

export class RecorderHub {
  private session: (Recording & { recording: boolean; done: () => void }) | null = null;

  constructor(private log: (...args: unknown[]) => void = () => {}) {}

  async install(context: BrowserContext) {
    await context.exposeBinding('__kolaRec', (source: Source, msg: RecMsg) => this.onMessage(source, msg));
    await context.addInitScript({ path: join(__dirname, 'web-recorder.js') });
  }

  /** เริ่มรอบบันทึก — คืน promise ที่จบเมื่อคนกด "จบและบันทึก" (หรือเรียก finish) */
  begin(startUrl: string): Promise<Recording> {
    return new Promise((resolve) => {
      const session = {
        steps: [] as Step[], startUrl, recording: false,
        done: () => {
          this.session = null;
          resolve({ steps: session.steps, startUrl: session.startUrl });
        },
      };
      this.session = session;
    });
  }

  finish() {
    this.session?.done();
  }

  private onMessage(source: Source, msg: RecMsg) {
    const r = this.session;
    if (!r) return { active: false };
    switch (msg?.kind) {
      case 'start':
        r.recording = true;
        // หน้าที่กดเริ่มคือหน้าแรกของ Template — ขั้นก่อนหน้านั้น (ล็อกอิน) ไม่เก็บ
        if (!r.steps.length && msg.url) r.startUrl = String(msg.url);
        this.log(`● เริ่มบันทึกที่ ${r.startUrl}`);
        break;
      case 'stop':
        r.recording = false;
        break;
      case 'undo':
        r.steps.pop();
        break;
      case 'finish':
        r.done();
        return { active: true, recording: false, count: r.steps.length };
      case 'step': {
        if (!r.recording || !msg.step || typeof msg.step !== 'object') break;
        const step = { ...msg.step } as Step;
        // ช่องใน iframe — จำต้นของ URL ของ frame ไว้ให้ตัวเล่นหาถูก frame
        if ('target' in step && source.frame !== source.page.mainFrame()) {
          try {
            const u = new URL(source.frame.url());
            step.target = { ...step.target, frame: `${u.origin}${u.pathname}` };
          } catch { /* frame ไม่มี URL */ }
        }
        // พิมพ์ช่องเดิมซ้ำติดกัน เก็บแค่ค่าสุดท้าย
        const last = r.steps[r.steps.length - 1];
        if (last && last.type === 'fill' && step.type === 'fill'
          && JSON.stringify(last.target) === JSON.stringify(step.target)) {
          r.steps[r.steps.length - 1] = step;
        } else {
          r.steps.push(step);
        }
        this.log(`  + ${step.type} ${JSON.stringify('target' in step ? step.target : step).slice(0, 140)}`);
        break;
      }
    }
    return { active: true, recording: r.recording, count: r.steps.length };
  }
}
