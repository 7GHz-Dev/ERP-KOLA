'use client';

import { useEffect, useState } from 'react';
import type { OnlineWorker } from '@/lib/worker-status';

/**
 * ป้ายสถานะ worker กรอกเว็บ กับปุ่มเปิด worker
 *
 * หน้าเว็บสั่งรันโปรแกรมในเครื่องเองไม่ได้ ปุ่มจึงเป็นลิงก์ kola-worker://start
 * ซึ่งตัวเปิดที่ติดตั้งไว้ในเครื่อง (scripts/install/) รับไปเปิด npm run worker:web ให้
 * เครื่องที่ยังไม่ได้ติดตั้ง กดแล้วจะไม่มีอะไรเกิดขึ้น — จึงบอกวิธีติดตั้งไว้ข้างปุ่ม
 *
 * สถานะมาจากสัญญาณที่ worker ส่งทุก 20 วินาที ถามซ้ำทุก 15 วินาที
 * หลังกดเปิดถามถี่ขึ้นช่วงหนึ่งนาที จะได้เห็นทันทีที่ขึ้น
 */
export function WorkerLauncher({ initial }: { initial: OnlineWorker[] }) {
  const [workers, setWorkers] = useState(initial);
  const [launchedAt, setLaunchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const waiting = launchedAt > 0 && now - launchedAt < 60_000;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/worker-status', { cache: 'no-store' });
        const data = (await res.json()) as { ok: boolean; workers?: OnlineWorker[] };
        if (alive && data.ok) setWorkers(data.workers ?? []);
      } catch { /* เน็ตสะดุด รอบหน้าค่อยถามใหม่ */ }
      if (alive) setNow(Date.now());
    };
    const timer = setInterval(poll, waiting ? 3_000 : 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [waiting]);

  const online = workers.length > 0;
  const busy = workers.find((w) => w.busy);

  return (
    <div className="worker-launcher">
      {online ? (
        <span className="badge approved" title={workers.map((w) => w.name).join(', ')}>
          ● worker ออนไลน์{busy ? ` · กำลังทำ ${busy.busy}` : ''}
        </span>
      ) : (
        <>
          <span className="badge pending">● worker ปิดอยู่</span>
          <a className="button tiny primary" href="kola-worker://start" onClick={() => { setLaunchedAt(Date.now()); setNow(Date.now()); }}>
            เปิด worker
          </a>
        </>
      )}
      {!online && waiting ? (
        <small className="worker-launcher-note">
          กำลังเปิด… ถ้าไม่มีหน้าต่างอะไรขึ้นมา แปลว่าเครื่องนี้ยังไม่ได้ติดตั้งตัวเปิด
        </small>
      ) : null}
      {!online ? (
        <details className="worker-launcher-help">
          <summary>ติดตั้งตัวเปิด</summary>
          <div>
            <p>ติดตั้งครั้งเดียวบนเครื่องที่ล็อกอินเว็บสายเรือไว้ (ต้องมี Node.js, Google Chrome และโค้ด ERP-KOLA ในเครื่อง)</p>
            <p><b>Mac:</b> เปิด Terminal ในโฟลเดอร์ v2 แล้วรัน <code>bash scripts/install/mac-worker-launcher.sh</code></p>
            <p>
              <b>Windows:</b> คลิกขวาไฟล์ <code>v2\scripts\install\windows-worker-launcher.ps1</code> →
              Run with PowerShell
            </p>
            <p>ครั้งแรกที่กดปุ่ม เบราว์เซอร์จะถามว่าจะเปิดแอป KOLA Worker ไหม — ติ๊ก “อนุญาตเสมอ” แล้วกดเปิด</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
