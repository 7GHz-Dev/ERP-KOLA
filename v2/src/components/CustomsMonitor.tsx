'use client';

import { useEffect, useRef, useState } from 'react';
import { submitCustomsTask } from '@/lib/actions/automation';
import { ConfirmSubmit } from '@/components/Interactions';
import type { OnlineWorker } from '@/lib/worker-status';

/**
 * ตัว monitor ใบขน — เช็กสถานะใบขนใน NETBAY จน ACCEPT แล้วดึงเลขใบขน + PDF ให้เอง
 *
 * FAH กด SEND TO CUSTOMS ใน NETBAY เองก่อน แล้วกด "สร้างใบขนแล้ว" ที่นี่
 * เครื่องที่กดเป็นตัว monitor: จำไว้ในแท็บนี้ว่าเพิ่งกด พอหน้าโหลดใหม่ (งานเข้าคิวแล้ว)
 * จึงเปิดลิงก์ kola-worker://customs ให้ตัวเปิดในเครื่องรัน npm run worker:customs
 * ต้องรอให้งานเข้าคิวก่อน — ถ้าเปิดตอนกด ตัว monitor อาจเห็นคิวว่างแล้วปิดตัวทันที
 */
const FLAG = 'kola-customs-monitor';
export const MONITOR_LINK = 'kola-worker://customs';

export function SubmitCustomsDone({ jobId }: { jobId: string }) {
  return (
    <form
      action={submitCustomsTask}
      className="inline-form"
      onSubmit={() => {
        try { sessionStorage.setItem(FLAG, String(Date.now())); } catch { /* ใช้ปุ่มเปิดที่คิว Automation แทน */ }
      }}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <ConfirmSubmit
        label="สร้างใบขนแล้ว"
        tone="primary"
        confirm="กด SEND TO CUSTOMS ใน NETBAY แล้วใช่ไหม"
        detail="เครื่องนี้จะเปิดตัว monitor เช็กสถานะใน NETBAY ทุก 5 นาที เมื่อ ACCEPT จะดึงเลขใบขน + PDF ให้ และงานไปที่ 4. เตรียมเอกสารเดิน E เอง (ต้องติดตั้งตัวเปิดของ ERP-KOLA บนเครื่องนี้แล้ว)"
      />
    </form>
  );
}

/**
 * วางไว้ในหน้าที่ปุ่ม "สร้างใบขนแล้ว" อยู่ — เปิดตัว monitor หลังงานเข้าคิว เฉพาะแท็บที่เพิ่งกด
 *
 * กดปุ่มแล้ว Next รีเฟรชข้อมูลของหน้าเดิม ไม่ได้โหลดใหม่ทั้งหน้า component นี้จึงไม่ถูกสร้างใหม่
 * ต้องส่ง latestTaskId (งานสร้างใบขนล่าสุดในคิว) มาเป็นตัวกระตุ้น — เปลี่ยนเมื่องานใหม่เข้าคิวแล้วจริง
 */
export function CustomsMonitorAutoLaunch({ latestTaskId }: { latestTaskId: string | null }) {
  useEffect(() => {
    let at = 0;
    try { at = Number(sessionStorage.getItem(FLAG) ?? 0); } catch { /* ไม่มีที่เก็บ */ }
    if (!at) return;
    try { sessionStorage.removeItem(FLAG); } catch { /* ไม่เป็นไร */ }
    if (Date.now() - at < 3 * 60_000) window.location.href = MONITOR_LINK;
  }, [latestTaskId]);
  return null;
}

/**
 * แถบสถานะบนคิว Automation > รอสร้างใบขน — ออนไลน์อยู่เครื่องไหน · ทำอะไรอยู่ · ดูการทำงาน
 * ปิดอยู่แต่ยังมีรายการค้าง (เช่นปิดเครื่องไปก่อน ACCEPT ครบ) กดเปิดบนเครื่องนี้ต่อได้
 */
export function CustomsMonitorBar({ initial, pending }: { initial: OnlineWorker[]; pending: number }) {
  const [workers, setWorkers] = useState(initial);
  const [watching, setWatching] = useState(false);
  const [launchedAt, setLaunchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLPreElement>(null);
  const waiting = launchedAt > 0 && now - launchedAt < 60_000;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/worker-status?mode=customs', { cache: 'no-store' });
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
      <span className="filter-label">ตัว monitor ใบขน</span>
      {worker ? (
        <span className="badge approved" title={worker.name}>
          ● ออนไลน์ที่ {worker.name.replace(/^customs@/, '')} · {worker.busy ?? 'รอรอบถัดไป'}
        </span>
      ) : pending > 0 ? (
        <>
          <span className="badge pending">● ปิดอยู่ — มี {pending} รายการรอเช็ก</span>
          <a className="button tiny primary" href={MONITOR_LINK}
            onClick={() => { setLaunchedAt(Date.now()); setNow(Date.now()); }}>
            เปิดตัว monitor บนเครื่องนี้
          </a>
        </>
      ) : (
        <span className="badge neutral">● ปิดอยู่ — ไม่มีรายการค้าง</span>
      )}
      {worker ? (
        <button type="button" className="button tiny" onClick={() => setWatching((w) => !w)}>
          {watching ? 'ซ่อนการทำงาน' : 'ดูการทำงาน'}
        </button>
      ) : null}
      {!worker && waiting ? (
        <small className="worker-launcher-note">
          กำลังเปิด… ถ้าผ่านไปครึ่งนาทียังไม่ขึ้นว่าออนไลน์ แปลว่าเครื่องนี้ยังไม่ได้ติดตั้งตัวเปิดรุ่นที่มีตัว monitor
          (รันตัวติดตั้งซ้ำหนึ่งครั้ง)
        </small>
      ) : null}
      {worker && !watching && worker.log.length ? (
        <small className="worker-launcher-note muted">{worker.log[worker.log.length - 1]}</small>
      ) : null}

      {watching && worker ? (
        <div className="worker-watch">
          <div className="worker-watch-head">
            <b>{worker.busy ?? 'รอรอบถัดไป'}</b>
            <small>เบื้องหลัง · {worker.name}</small>
          </div>
          {worker.shotAt && worker.busy ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="worker-watch-shot" alt="ภาพหน้าจอล่าสุดของ NETBAY"
              src={`/api/worker-status/shot?worker=${encodeURIComponent(worker.name)}&t=${encodeURIComponent(worker.shotAt)}`} />
          ) : (
            <p className="worker-watch-empty">ภาพหน้าจอ NETBAY ขึ้นระหว่างที่กำลังเช็ก</p>
          )}
          <pre ref={logRef} className="worker-watch-log">{worker.log.length ? worker.log.join('\n') : 'ยังไม่มี log'}</pre>
        </div>
      ) : null}
    </div>
  );
}
