'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Stage, Track } from '@/lib/track';

/**
 * ปุ่ม "เช็คสถานะ BL" — พิมพ์ BL / Job / เลขตู้ แล้วเห็นงานเป็นหลอดแบ่งช่องตามขั้น
 *
 * ตอบคำถามที่พนักงานถามกันบ่อยที่สุด ("BL นี้ถึงไหนแล้ว / ค้างที่ใคร") โดยไม่ต้องเปิดหลายหน้า
 * ไม่ใช้ AI — อ่านจากฐานข้อมูลตรง ๆ ผ่าน /api/track จึงเร็วและไม่มีค่าใช้จ่าย
 * วางเหนือปุ่มผู้ช่วย KOLA ใช้ได้ทุกคนที่ล็อกอิน
 */

const STORE = 'kola-tracker';
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Bangkok' }) : '');
const fmtEta = (d: string | null) => (d ? d.split('-').reverse().join('/') : '-');

export function JobTracker({ stacked }: { stacked: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ total: number; jobs: Track[] } | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null');
      if (saved?.q) setQ(saved.q);
      if (saved?.open) setOpen(true);
    } catch { /* ไม่มีที่เก็บก็เริ่มใหม่ */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ q, open })); } catch { /* ไม่เป็นไร */ }
  }, [q, open]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  // ค้นเองตอนหยุดพิมพ์ — ไม่ต้องกดปุ่ม
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 3) { setResult(null); setError(''); return; }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/track?q=${encodeURIComponent(text)}`, { cache: 'no-store' });
        const body = await res.json();
        if (id !== seq.current) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setResult(body);
        setError('');
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, open]);

  if (!open) {
    return (
      <button type="button" className={`trk-fab${stacked ? ' stacked' : ''}`} onClick={() => setOpen(true)} aria-label="เช็คสถานะ BL">
        <span aria-hidden>🔎</span> เช็คสถานะ BL
      </button>
    );
  }

  return (
    <section className="trk-panel" aria-label="เช็คสถานะ BL">
      <header>
        <div>
          <b>🔎 เช็คสถานะ BL</b>
          <small>พิมพ์ BL · Job No. · เลขตู้ — ดูว่างานอยู่ขั้นไหน ค้างที่ใคร</small>
        </div>
        <button type="button" className="ai-close" onClick={() => setOpen(false)} aria-label="ปิด">×</button>
      </header>

      <div className="trk-search">
        <input
          ref={box}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="เช่น AMP0561328B หรือ KOLA-2026-0431"
          autoComplete="off"
          spellCheck={false}
        />
        {busy ? <span className="ai-dot" /> : null}
      </div>

      <div className="trk-body">
        {error ? <p className="cgi-error">⚠️ {error}</p> : null}
        {!result && !error ? (
          <div className="trk-empty">
            <div className="trk-demo" aria-hidden>
              {['📥', '✅', '🧾', '📝', '🏛️', '📂', '🚚', '🔄', '🚛'].map((icon, i) => (
                <span key={icon} className={i < 3 ? 'done' : i === 3 ? 'now' : ''}>{icon}</span>
              ))}
            </div>
            <p>พิมพ์อย่างน้อย 3 ตัวอักษร ระบบค้นให้ทันที</p>
          </div>
        ) : null}
        {result && !result.jobs.length ? <p className="trk-none">ไม่พบงานที่ตรงกับ “{q.trim()}”</p> : null}
        {result && result.total > result.jobs.length ? (
          <p className="trk-more">เจอ {result.total} งาน แสดง {result.jobs.length} งานล่าสุด — พิมพ์ให้ชัดขึ้นเพื่อแคบลง</p>
        ) : null}
        {result?.jobs.map((j) => <TrackCard key={j.id} job={j} />)}
      </div>
    </section>
  );
}

function TrackCard({ job }: { job: Track }) {
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
  const allDone = !job.current;
  return (
    <article className={`trk-card${allDone ? ' complete' : ''}`}>
      <div className="trk-card-head">
        <div>
          <Link className="trk-job" href={`/job/${job.id}`}>{job.jobNo}</Link>
          <b className="trk-bl">{job.blNo ?? '-'}</b>
        </div>
        <div className="trk-pct" style={{ '--pct': `${pct}%` } as React.CSSProperties}>
          <span>{pct}%</span>
        </div>
      </div>
      <p className="trk-meta">
        🚢 {job.vessel ?? '-'} · ETA {fmtEta(job.eta)} · {job.containers || '-'} ตู้
        {job.client ? ` · 👤 ${job.client}` : ''}{job.jobType ? ` · ${job.jobType}` : ''}
      </p>

      {/* ตอนนี้อยู่ตรงไหน — ประโยคเดียวที่คนอยากรู้ที่สุด */}
      {allDone ? (
        <p className="trk-now done">🎉 ผ่านครบทุกขั้นแล้ว</p>
      ) : (
        <p className="trk-now">
          <span className="trk-now-icon">{job.current!.icon}</span>
          <span>
            ตอนนี้อยู่ที่ <b>{job.current!.label}</b> · รอ <b>{job.current!.owner}</b>
            {job.current!.note ? <small> — {job.current!.note}</small> : null}
          </span>
          {job.waitingDays !== null ? (
            <span className={`trk-wait${job.waitingDays >= 7 ? ' long' : job.waitingDays >= 3 ? ' mid' : ''}`}>
              ⏱ {job.waitingDays === 0 ? 'วันนี้' : `${job.waitingDays} วัน`}
            </span>
          ) : null}
        </p>
      )}

      {/* หลอดหลัก — ช่องละขั้น */}
      <ol className="trk-tube" style={{ gridTemplateColumns: `repeat(${job.stages.length}, minmax(0, 1fr))` }}>
        {job.stages.map((s) => <Segment key={s.key} s={s} />)}
      </ol>
      <p className="trk-count">ผ่านแล้ว {job.progress.done} / {job.progress.total} ขั้น</p>

      {/* งานคู่ขนาน — ทำไปพร้อมกับหลอดหลัก ไม่ได้ขวางกัน */}
      <div className="trk-side">
        <span className="trk-side-title">งานคู่ขนาน</span>
        {job.side.map((t) => (
          <span key={t.key} className={`trk-chip${t.done ? ' done' : ''}`} title={`${t.owner}${t.at ? ` · ${fmt(t.at)}` : ''}${t.note ? ` · ${t.note}` : ''}`}>
            {t.icon} {t.label} {t.done ? '✓' : '⏳'}
          </span>
        ))}
      </div>
    </article>
  );
}

function Segment({ s }: { s: Stage }) {
  const title = [s.label, s.owner, s.at ? `เสร็จ ${fmt(s.at)}` : null, s.note].filter(Boolean).join(' · ');
  return (
    <li className={`trk-seg ${s.state}`} title={title}>
      <span className="trk-icon">{s.state === 'done' ? '✓' : s.icon}</span>
      {s.state === 'now' ? <span className="trk-ship" aria-hidden>🚢</span> : null}
      <span className="trk-bar" />
      <span className="trk-label">{s.label}</span>
      <span className="trk-date">{s.state === 'done' ? fmt(s.at) : s.state === 'now' ? 'ตอนนี้' : s.state === 'skip' ? 'ไม่ต้องทำ' : ''}</span>
    </li>
  );
}
