'use client';

import { useEffect, useRef, useState } from 'react';
import type { OnlineWorker } from '@/lib/worker-status';
import { StopWorkerButton } from '@/components/StopWorkerButton';

/**
 * แผงสถานะ worker สร้าง Draft ใบขนบนแท็บ 3. Draft ใบขน — สถานะ · เปิด · ดูการทำงาน (log + ภาพหน้าจอสด)
 *
 * worker ต้องรันบนเครื่องในออฟฟิศที่เปิด NETBAY ได้ ปุ่มเปิดจึงเป็นลิงก์ kola-worker://draft
 * ซึ่งตัวเปิดที่ติดตั้งไว้ในเครื่อง (scripts/install/) รับไปรัน npm run worker:draft แบบไม่มีหน้าต่าง Terminal
 * แยกจาก worker แลก DO (mode=draft) — ปุ่มโหมดและปุ่มปิดของหน้าแลก DO ไม่มีผลกับตัวนี้
 */
export function DraftWorkerBar({ initial }: { initial: OnlineWorker[] }) {
  const [workers, setWorkers] = useState(initial);
  const [launchedAt, setLaunchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [watching, setWatching] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const waiting = launchedAt > 0 && now - launchedAt < 60_000;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/worker-status?mode=draft', { cache: 'no-store' });
        const data = (await res.json()) as { ok: boolean; workers?: OnlineWorker[] };
        if (alive && data.ok) setWorkers(data.workers ?? []);
      } catch { /* เน็ตสะดุด รอบหน้าค่อยถามใหม่ */ }
      if (alive) setNow(Date.now());
    };
    const timer = setInterval(poll, watching || waiting ? 3_000 : 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, [watching, waiting]);

  const worker = workers[0] ?? null;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [worker?.log.length, watching]);

  return (
    <div className="worker-launcher">
      <span className="filter-label">สร้าง Draft อัตโนมัติ</span>
      {worker ? (
        <span className="badge approved" title={worker.name}>
          ● worker ออนไลน์ · {worker.busy ? `กำลังทำ ${worker.busy}` : 'ว่าง'}
        </span>
      ) : (
        <>
          <span className="badge pending">● worker ปิดอยู่ — งานที่กด &quot;สร้าง Draft&quot; จะรอในคิว</span>
          <a className="button tiny primary" href="kola-worker://draft"
            onClick={() => { setLaunchedAt(Date.now()); setNow(Date.now()); }}>
            เปิด worker
          </a>
        </>
      )}
      {worker ? (
        <button type="button" className="button tiny" onClick={() => setWatching((w) => !w)}>
          {watching ? 'ซ่อนการทำงาน' : 'ดูการทำงาน'}
        </button>
      ) : null}
      {worker ? (
        <StopWorkerButton mode="draft" label="ปิด worker"
          confirmText="ปิด worker สร้าง Draft? (ปิดหลังจบงานที่ทำอยู่ · งานที่กดสร้าง Draft หลังจากนี้จะรอในคิวจนกว่าจะเปิดใหม่)" />
      ) : null}
      {!worker && waiting ? (
        <small className="worker-launcher-note">
          กำลังเปิด… ถ้าผ่านไปครึ่งนาทียังไม่ขึ้นว่าออนไลน์ แปลว่าเครื่องนี้ยังไม่ได้ติดตั้งตัวเปิด
        </small>
      ) : null}
      {worker && !watching && worker.log.length ? (
        <small className="worker-launcher-note muted">{worker.log[worker.log.length - 1]}</small>
      ) : null}

      {watching && worker ? (
        <div className="worker-watch">
          <div className="worker-watch-head">
            <b>{worker.busy ? `กำลังทำ ${worker.busy}` : 'ว่าง — รองาน'}</b>
            <small>{worker.headless ? 'เบื้องหลัง' : 'แสดงหน้าต่าง'} · {worker.name}</small>
          </div>
          {worker.shotAt && worker.busy ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="worker-watch-shot" alt="ภาพหน้าจอล่าสุดของ NETBAY"
              src={`/api/worker-status/shot?worker=${encodeURIComponent(worker.name)}&t=${encodeURIComponent(worker.shotAt)}`} />
          ) : (
            <p className="worker-watch-empty">ภาพหน้าจอ NETBAY ขึ้นระหว่างที่ worker กำลังทำงาน</p>
          )}
          <pre ref={logRef} className="worker-watch-log">{worker.log.length ? worker.log.join('\n') : 'ยังไม่มี log'}</pre>
        </div>
      ) : null}

      {/* แสดงเสมอ — "สร้าง Draft" ทำบนเครื่องที่กด เครื่องใหม่ทุกเครื่องต้องติดตั้งก่อน */}
      <details className="worker-launcher-help">
        <summary>ติดตั้งบนเครื่องนี้</summary>
        <div>
          <p>ติดตั้งครั้งเดียวบนเครื่องในออฟฟิศที่เปิด NETBAY ได้ — เครื่องนั้นกด &quot;สร้าง Draft&quot; แล้วทำเองได้ และกดเลข Ref No. เปิดใบขนได้</p>
          <p><b>Windows 10/11 (คลิกเดียว):</b> <a href="/api/install/windows" download>ดาวน์โหลด windows-setup.cmd</a>
            แล้วดับเบิลคลิก — ติดตั้ง Git / Node.js / Chrome ที่ยังไม่มี ดึงโค้ด ใส่คีย์ และจองบัญชี NETBAY ประจำเครื่องให้เอง
            ไม่ต้องกรอกอะไร (ถ้า Windows ขึ้นว่า &quot;ป้องกันพีซีของคุณ&quot; กด ข้อมูลเพิ่มเติม → เรียกใช้)
            · ไฟล์นี้มีคีย์ของระบบ อย่าส่งต่อให้คนนอก</p>
          <p><b>Mac:</b> มีโค้ด ERP-KOLA กับ Node.js แล้ว ใส่ <code>WORKER_API_KEY</code> ใน <code>v2/.env.local</code>
            แล้วรัน <code>bash scripts/install/mac-worker-launcher.sh</code> ในโฟลเดอร์ v2 (จองบัญชี NETBAY ให้เอง)</p>
        </div>
      </details>
    </div>
  );
}
