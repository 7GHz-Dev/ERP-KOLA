'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CheckedRule } from '@/lib/cargo-invoice/tariff';

/**
 * ข้อมูลอ้างอิงใต้ Create Cargo Invoice — ให้ PAINT ตรวจว่ามีอะไรซ้ำหรือผิดไหม
 *   Datatariff   กฎพิกัดทั้งหมด (ตารางหลัก + ที่เพิ่มเอง) ระบบตรวจกฎซ้ำ / ขัดกันให้ · ปิดกฎที่เพิ่มผิดได้
 *   เลขเครื่อง   เลขเครื่องที่ระบบออกไปแล้ว ระบบตรวจเลขซ้ำต่างตัวถัง / ตัวถังที่ได้หลายเลข
 * หัวคอลัมน์ทุกช่องพิมพ์ค้นได้
 */

type EngineRow = {
  id: string; number: string; full: string; chassis: string; date: string; bl: string; invoice: string; file: string;
  jobId: string | null; numberUsedBy: number; chassisNumbers: number;
};

const SHOW_MAX = 500;
const has = (v: string, q: string) => v.toLowerCase().includes(q.trim().toLowerCase());

/** ช่องตัวเลข: พิมพ์ตัวเลข = กฎที่ช่วงครอบค่านั้น · พิมพ์อย่างอื่น = มีข้อความนั้นในช่วง */
function inRange(min: number, max: number, q: string) {
  const t = q.trim().replace(/,/g, '');
  if (!t) return true;
  return /^\d+$/.test(t) ? min <= Number(t) && Number(t) <= max : `${min}-${max}`.includes(t);
}

function Filter({ value, onChange, placeholder = 'ค้น…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="cgr-filter" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function CargoReference({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [tab, setTab] = useState<'tariff' | 'engine'>('tariff');
  return (
    <section className="cgi-card cgr">
      <div className="cgr-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'tariff'} className={tab === 'tariff' ? 'on' : ''} onClick={() => setTab('tariff')}>
          📋 Datatariff (พิกัด)
        </button>
        <button type="button" role="tab" aria-selected={tab === 'engine'} className={tab === 'engine' ? 'on' : ''} onClick={() => setTab('engine')}>
          🔢 เลขเครื่องที่ระบบออก
        </button>
      </div>
      {tab === 'tariff' ? <TariffTable version={version} onChanged={onChanged} /> : <EngineTable />}
    </section>
  );
}

/* ---------------- Datatariff ---------------- */

const T_EMPTY = { seq: '', code: '', brand: '', model: '', fuel: '', cc: '', weight: '', source: '', issue: '' };

function TariffTable({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [rules, setRules] = useState<CheckedRule[] | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState(T_EMPTY);
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const set = (k: keyof typeof T_EMPTY) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let alive = true;
    setError('');
    fetch('/api/cargo-invoice/reference?kind=tariff')
      .then(async (r) => { const b = await r.json(); if (!r.ok || b.error) throw new Error(b.error ?? `HTTP ${r.status}`); return b; })
      .then((b) => { if (alive) setRules(b.rules); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [version, reload]);

  const shown = useMemo(() => (rules ?? []).filter((r) =>
    has(r.seq, f.seq) && has(r.code, f.code) && has(r.brand, f.brand) && has(r.model, f.model) && has(r.fuel, f.fuel)
    && inRange(r.ccMin, r.ccMax, f.cc) && inRange(r.wMin, r.wMax, f.weight)
    && (!f.source || r.source === f.source)
    && (!f.issue || (f.issue === 'ok' ? !r.issues.length : f.issue === 'any' ? r.issues.length > 0 : r.issues.some((i) => i.kind === f.issue)))),
  [rules, f]);

  const count = useMemo(() => ({
    dup: (rules ?? []).filter((r) => r.issues.some((i) => i.kind === 'dup')).length,
    conflict: (rules ?? []).filter((r) => r.issues.some((i) => i.kind === 'conflict')).length,
  }), [rules]);

  async function remove(r: CheckedRule) {
    if (!window.confirm(`ปิดกฎพิกัด ${r.brand} ${r.model} ${r.fuel} → ${r.code}?`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/cargo-invoice/rules?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || b.error) throw new Error(b.error ?? `HTTP ${res.status}`);
      setReload((n) => n + 1);
      onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  if (error) return <p className="cgi-error">⚠️ โหลด Datatariff ไม่ได้: {error}</p>;
  if (!rules) return <p className="cgi-busy"><span className="ai-dot" />กำลังโหลด Datatariff…</p>;
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <div className="cgr-bar">
        <span>ทั้งหมด <b>{rules.length.toLocaleString()}</b> กฎ{filtered ? <> · ตรงที่ค้น <b>{shown.length.toLocaleString()}</b></> : null}</span>
        <button type="button" className={`chip-toggle small${f.issue === 'conflict' ? ' on' : ''}`} onClick={() => set('issue')(f.issue === 'conflict' ? '' : 'conflict')}>
          ⚠ ขัดกัน (คนละพิกัด) {count.conflict}
        </button>
        <button type="button" className={`chip-toggle small${f.issue === 'dup' ? ' on' : ''}`} onClick={() => set('issue')(f.issue === 'dup' ? '' : 'dup')}>
          ซ้ำ (พิกัดเดียวกัน) {count.dup}
        </button>
        {filtered ? <button type="button" className="button tiny" onClick={() => setF(T_EMPTY)}>ล้างตัวกรอง</button> : null}
        <small className="muted">ช่อง CC / น้ำหนัก พิมพ์ตัวเลข = กฎที่ครอบค่านั้น เช่น 1490</small>
      </div>
      <div className="table-wrap cgr-wrap">
        <table className="data cgi-table cgr-table">
          <thead>
            <tr>
              <th>ลำดับ</th><th>พิกัด</th><th>ยี่ห้อ</th><th>รุ่น</th><th>เชื้อเพลิง</th>
              <th className="num">CC</th><th className="num">น้ำหนัก (KG)</th><th>ที่มา</th><th>ตรวจ</th><th />
            </tr>
            <tr className="filters">
              <th><Filter value={f.seq} onChange={set('seq')} /></th>
              <th><Filter value={f.code} onChange={set('code')} placeholder="8703…" /></th>
              <th><Filter value={f.brand} onChange={set('brand')} /></th>
              <th><Filter value={f.model} onChange={set('model')} /></th>
              <th><Filter value={f.fuel} onChange={set('fuel')} /></th>
              <th><Filter value={f.cc} onChange={set('cc')} placeholder="เช่น 1490" /></th>
              <th><Filter value={f.weight} onChange={set('weight')} placeholder="เช่น 1200" /></th>
              <th>
                <select className="cgr-filter" value={f.source} onChange={(e) => set('source')(e.target.value)}>
                  <option value="">ทั้งหมด</option><option value="base">ตารางหลัก</option><option value="added">เพิ่มเอง</option>
                </select>
              </th>
              <th>
                <select className="cgr-filter" value={f.issue} onChange={(e) => set('issue')(e.target.value)}>
                  <option value="">ทั้งหมด</option><option value="any">มีปัญหา</option><option value="conflict">ขัดกัน</option>
                  <option value="dup">ซ้ำ</option><option value="ok">ปกติ</option>
                </select>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <tr><td className="empty" colSpan={10}>ไม่พบกฎที่ตรงกับที่ค้น</td></tr> : null}
            {shown.slice(0, SHOW_MAX).map((r) => (
              <tr key={r.id} className={r.issues.some((i) => i.kind === 'conflict') ? 'cgr-conflict' : r.issues.length ? 'cgr-dup' : undefined}>
                <td>{r.seq}</td>
                <td><b>{r.code}</b></td>
                <td>{r.brand}</td><td>{r.model}</td><td>{r.fuel}</td>
                <td className="num">{r.ccMin.toLocaleString()}-{r.ccMax.toLocaleString()}</td>
                <td className="num">{r.wMin.toLocaleString()}-{r.wMax.toLocaleString()}</td>
                <td>{r.source === 'added' ? <span className="badge pending">เพิ่มเอง</span> : <span className="muted">ตารางหลัก</span>}</td>
                <td className="cgr-issues">
                  {r.issues.length ? r.issues.map((i) => (
                    <span key={`${i.kind}-${i.with}`} className={`badge ${i.kind === 'conflict' ? 'rejected' : 'pending'}`}
                      title={i.kind === 'conflict' ? 'รถชื่อเดียวกัน ช่วง CC/น้ำหนักทับกัน แต่คนละพิกัด — ตอนดึงพิกัดต้องเลือกเอง' : 'กฎเหมือนกัน พิกัดเดียวกัน'}>
                      {i.kind === 'conflict' ? `ขัดกับ ${i.with} (${i.code})` : `ซ้ำกับ ${i.with}`}
                    </span>
                  )) : <span className="cgi-ok">✓</span>}
                </td>
                <td>{r.source === 'added' ? <button type="button" className="button tiny" disabled={busy === r.id} onClick={() => void remove(r)}>ปิดกฎ</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > SHOW_MAX ? <p className="muted small">แสดง {SHOW_MAX} แถวแรกจาก {shown.length.toLocaleString()} — พิมพ์ค้นที่หัวคอลัมน์เพื่อให้แคบลง</p> : null}
    </>
  );
}

/* ---------------- เลขเครื่อง ---------------- */

const E_EMPTY = { date: '', number: '', full: '', chassis: '', bl: '', invoice: '', file: '' };

function EngineTable() {
  const [f, setF] = useState(E_EMPTY);
  const [issues, setIssues] = useState(false);
  const [data, setData] = useState<{ rows: EngineRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof E_EMPTY) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  // ตารางใหญ่ — กรองที่เซิร์ฟเวอร์ รอพิมพ์เสร็จ 350ms ก่อนค้น
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ kind: 'engine', ...(issues ? { issues: '1' } : {}) });
      for (const [k, v] of Object.entries(f)) if (v.trim()) q.set(k, v.trim());
      setLoading(true);
      setError('');
      fetch(`/api/cargo-invoice/reference?${q}`, { signal: ctl.signal })
        .then(async (r) => { const b = await r.json(); if (!r.ok || b.error) throw new Error(b.error ?? `HTTP ${r.status}`); return b; })
        .then((b) => setData(b))
        .catch((e) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [f, issues]);

  const filtered = issues || Object.values(f).some(Boolean);
  const only = (k: keyof typeof E_EMPTY, v: string) => { setIssues(false); setF({ ...E_EMPTY, [k]: v }); };

  return (
    <>
      <div className="cgr-bar">
        <span>
          {data ? <>{filtered ? 'ตรงที่ค้น' : 'ทั้งหมด'} <b>{data.total.toLocaleString()}</b> แถว{data.total > data.rows.length ? ` · แสดงล่าสุด ${data.rows.length}` : ''}</> : 'กำลังโหลด…'}
          {loading && data ? <span className="ai-dot" /> : null}
        </span>
        <button type="button" className={`chip-toggle small${issues ? ' on' : ''}`} onClick={() => setIssues(!issues)}>
          ⚠ เฉพาะที่มีปัญหา (เลขซ้ำ / ตัวถังหลายเลข)
        </button>
        {filtered ? <button type="button" className="button tiny" onClick={() => { setF(E_EMPTY); setIssues(false); }}>ล้างตัวกรอง</button> : null}
        <small className="muted">เลขสุ่ม 7 หลักต้องไม่ซ้ำกันทั้งตาราง · ตัวถังเดิมปกติใช้เลขเดิม</small>
      </div>
      {error ? <p className="cgi-error">⚠️ โหลดเลขเครื่องไม่ได้: {error}</p> : null}
      <div className="table-wrap cgr-wrap">
        <table className="data cgi-table cgr-table">
          <thead>
            <tr>
              <th>วันที่ออก</th><th>เลขสุ่ม</th><th>เลขเครื่องเต็ม</th><th>เลขตัวถัง</th><th>BL</th><th>Invoice</th><th>ไฟล์</th><th>ตรวจ</th>
            </tr>
            <tr className="filters">
              <th><Filter value={f.date} onChange={set('date')} placeholder="2026-11" /></th>
              <th><Filter value={f.number} onChange={set('number')} /></th>
              <th><Filter value={f.full} onChange={set('full')} /></th>
              <th><Filter value={f.chassis} onChange={set('chassis')} /></th>
              <th><Filter value={f.bl} onChange={set('bl')} /></th>
              <th><Filter value={f.invoice} onChange={set('invoice')} /></th>
              <th><Filter value={f.file} onChange={set('file')} /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data && data.rows.length === 0 ? <tr><td className="empty" colSpan={8}>{filtered ? 'ไม่พบเลขเครื่องที่ตรงกับที่ค้น' : 'ยังไม่มีเลขเครื่องในระบบ'}</td></tr> : null}
            {data?.rows.map((r) => (
              <tr key={r.id} className={r.numberUsedBy > 1 ? 'cgr-conflict' : r.chassisNumbers > 1 ? 'cgr-dup' : undefined}>
                <td className="muted">{r.date || '-'}</td>
                <td><b>{r.number}</b></td>
                <td>{r.full || '-'}</td>
                <td>{r.chassis}</td>
                <td>{r.bl ? (r.jobId ? <Link className="cell-link" href={`/job/${r.jobId}`}>{r.bl}</Link> : r.bl) : '-'}</td>
                <td>{r.invoice || '-'}</td>
                <td className="muted cgr-file" title={r.file}>{r.file || '-'}</td>
                <td className="cgr-issues">
                  {r.numberUsedBy > 1 ? (
                    <button type="button" className="badge rejected" title="กดเพื่อดูทุกแถวของเลขนี้" onClick={() => only('number', r.number)}>
                      เลขซ้ำ {r.numberUsedBy} ตัวถัง
                    </button>
                  ) : null}
                  {r.chassisNumbers > 1 ? (
                    <button type="button" className="badge pending" title="กดเพื่อดูทุกเลขของตัวถังนี้" onClick={() => only('chassis', r.chassis)}>
                      ตัวถังนี้มี {r.chassisNumbers} เลข
                    </button>
                  ) : null}
                  {r.numberUsedBy <= 1 && r.chassisNumbers <= 1 ? <span className="cgi-ok">✓</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
