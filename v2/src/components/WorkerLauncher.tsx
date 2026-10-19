'use client';

import { useEffect, useRef, useState } from 'react';
import { setWorkerBackground, stopWorker } from '@/lib/actions/worker';
import type { OnlineWorker, WorkerSettings } from '@/lib/worker-status';

/**
 * แผงคุม worker กรอกเว็บบนหน้าแลก DO — สถานะ · เปิด · ปิด · โหมดแสดงหน้าต่าง/เบื้องหลัง · ดูการทำงาน
 *
 * หน้าเว็บสั่งรันโปรแกรมในเครื่องเองไม่ได้ ปุ่มเปิดจึงเป็นลิงก์ kola-worker://start
 * ซึ่งตัวเปิดที่ติดตั้งไว้ในเครื่อง (scripts/install/) รับไปเปิด worker แบบไม่มีหน้าต่าง Terminal
 * คำสั่งอื่น (โหมด · ปิด) เก็บเป็นค่าตั้งในระบบ worker อ่านกลับไปจากสัญญาณสถานะรอบถัดไป
 *
 * "ดูการทำงาน" แสดง log ล่าสุดกับภาพหน้าจอสดที่ worker ส่งขึ้นมาระหว่างทำงาน
 * ใช้ดูได้ทั้งสองโหมด แต่สำคัญตอนทำงานเบื้องหลังเพราะไม่มีหน้าต่างให้เห็นในเครื่อง
 */
export function WorkerLauncher({ initial, initialSettings }: { initial: OnlineWorker[]; initialSettings: WorkerSettings }) {
  const [workers, setWorkers] = useState(initial);
  const [settings, setSettings] = useState(initialSettings);
  const [launchedAt, setLaunchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [watching, setWatching] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const waiting = launchedAt > 0 && now - launchedAt < 60_000;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/worker-status', { cache: 'no-store' });
        const data = (await res.json()) as { ok: boolean; workers?: OnlineWorker[]; settings?: WorkerSettings };
        if (alive && data.ok) {
          setWorkers(data.workers ?? []);
          if (data.settings) setSettings(data.settings);
        }
      } catch { /* เน็ตสะดุด รอบหน้าค่อยถามใหม่ */ }
      if (alive) setNow(Date.now());
    };
    const timer = setInterval(poll, watching || waiting ? 3_000 : 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [watching, waiting]);

  const worker = workers[0] ?? null;
  const online = Boolean(worker);

  // log ใหม่ต่อท้าย — เลื่อนลงล่างสุดให้เห็นบรรทัดล่าสุดเสมอ
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [worker?.log.length, watching]);

  // เปลี่ยนโหมดขณะทำงาน มีผลหลังงานนั้นจบ
  const pendingMode = online && worker!.headless !== settings.background;
  const shotFresh = worker?.shotAt && worker.busy;

  return (
    <div className="worker-launcher">
      {online ? (
        <span className="badge approved" title={worker!.name}>
          ● worker ออนไลน์ · {worker!.busy ? `กำลังทำ ${worker!.busy}` : 'ว่าง'}
        </span>
      ) : (
        <>
          <span className="badge pending">● worker ปิดอยู่</span>
          <a className="button tiny primary" href="kola-worker://start" onClick={() => { setLaunchedAt(Date.now()); setNow(Date.now()); }}>
            เปิด worker
          </a>
        </>
      )}

      {/* โหมด — ตั้งไว้ก่อนเปิด worker ก็ได้ เปิดขึ้นมาจะใช้โหมดนี้ */}
      <div className="worker-mode" role="group" aria-label="โหมดการทำงาน">
        <form action={setWorkerBackground}>
          <input type="hidden" name="background" value="0" />
          <button type="submit" className={`button tiny ${settings.background ? '' : 'on'}`}
            onClick={() => setSettings((s) => ({ ...s, background: false }))}
            title="เห็นหน้าต่าง Chrome · รอคนตรวจแล้วกดปุ่มส่งเอง · ล็อกอินและขั้นที่ให้คนทำได้">
            แสดงหน้าต่าง
          </button>
        </form>
        <form action={setWorkerBackground}>
          <input type="hidden" name="background" value="1" />
          <button type="submit" className={`button tiny ${settings.background ? 'on' : ''}`}
            onClick={() => setSettings((s) => ({ ...s, background: true }))}
            title="ไม่มีหน้าต่าง · กดปุ่มส่งให้เอง · ขั้นที่ต้องให้คนทำ (ล็อกอิน/OTP) จะแจ้งให้สลับโหมด">
            ทำงานเบื้องหลัง
          </button>
        </form>
      </div>

      {online ? (
        <>
          <button type="button" className="button tiny" onClick={() => setWatching((w) => !w)}>
            {watching ? 'ซ่อนการทำงาน' : 'ดูการทำงาน'}
          </button>
          <form action={stopWorker} onSubmit={(e) => { if (!window.confirm('ปิด worker? (ปิดหลังจบงานที่ทำอยู่)')) e.preventDefault(); }}>
            <button type="submit" className="button tiny ghost">ปิด worker</button>
          </form>
        </>
      ) : null}

      {pendingMode ? (
        <small className="worker-launcher-note">เปลี่ยนโหมดแล้ว — มีผลเมื่อ worker ว่าง</small>
      ) : null}
      {settings.background && online ? (
        <small className="worker-launcher-note muted">เบื้องหลัง: กดปุ่มส่งของเว็บให้เอง · ต้องล็อกอินเว็บปลายทางไว้ก่อนในโหมดแสดงหน้าต่าง</small>
      ) : null}
      {!online && waiting ? (
        <small className="worker-launcher-note">
          กำลังเปิด… ถ้าผ่านไปครึ่งนาทียังไม่ขึ้นว่าออนไลน์ แปลว่าเครื่องนี้ยังไม่ได้ติดตั้งตัวเปิด
        </small>
      ) : null}

      {watching && online ? (
        <div className="worker-watch">
          <div className="worker-watch-head">
            <b>{worker!.busy ? `กำลังทำ ${worker!.busy}` : 'ว่าง — รองาน'}</b>
            <small>{worker!.headless ? 'เบื้องหลัง' : 'แสดงหน้าต่าง'} · {worker!.name}</small>
          </div>
          {shotFresh ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="worker-watch-shot" alt="ภาพหน้าจอล่าสุดของ worker"
              src={`/api/worker-status/shot?worker=${encodeURIComponent(worker!.name)}&t=${encodeURIComponent(worker!.shotAt!)}`} />
          ) : (
            <p className="worker-watch-empty">ภาพหน้าจอขึ้นระหว่างที่ worker กำลังทำงาน</p>
          )}
          <pre ref={logRef} className="worker-watch-log">{worker!.log.length ? worker!.log.join('\n') : 'ยังไม่มี log'}</pre>
        </div>
      ) : null}

      {!online ? (
        <details className="worker-launcher-help">
          <summary>ติดตั้งตัวเปิด</summary>
          <div>
            <p>ติดตั้งครั้งเดียวบนเครื่องที่ล็อกอินเว็บสายเรือไว้ (ต้องมี Node.js, Google Chrome และโค้ด ERP-KOLA ในเครื่อง)</p>
            <p><b>Mac:</b> เปิด Terminal ในโฟลเดอร์ v2 แล้วรัน <code>bash scripts/install/mac-worker-launcher.sh</code></p>
            <p><b>Windows:</b> ดับเบิลคลิก <code>v2\scripts\install\windows-worker-launcher.cmd</code></p>
            <p>ครั้งแรกที่กดปุ่ม เบราว์เซอร์จะถามว่าจะเปิดแอป KOLA Worker ไหม — ติ๊ก “อนุญาตเสมอ” แล้วกดเปิด</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
