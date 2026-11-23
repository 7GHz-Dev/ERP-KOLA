'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CargoCar, CargoInvoice } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import type { DraftCsv } from '@/lib/cargo-invoice/draft-csv';
import { finalEngineText } from '@/lib/cargo-invoice/engine-format';
import { applyCarEdit, changedFields, EDIT_FIELDS, withProblems, type EditField } from '@/lib/cargo-invoice/edit';
import { checkChassis } from '@/lib/cargo-invoice/chassis-check';
import { CargoDocPane, type DocView } from './CargoDocPane';
import { CsvDrawer } from './CargoDocDrawers';
import { AddRule, call, type Tariff } from './CargoShared';

/**
 * Create FN Invoice แบบ JAN TRADING / AICHI — หน้าตาเดียวกับ NORMAL (เอกสารซ้าย/บน · ข้อมูลขวา/ล่าง · แถบปุ่มติดล่าง)
 *
 * การอ่านค่าเหมือนเดิมทุกอย่าง: ระบบอ่านไฟล์ Excel ของผู้ขาย (parse) แล้วจัดหน้า Final Invoice ให้ (preview / save)
 * แก้ได้ทุกช่องของรถ — ส่งค่าที่แก้ไปพร้อมไฟล์ เซิร์ฟเวอร์อ่านไฟล์ใหม่แล้วใส่ค่าที่แก้ทับ (lib/cargo-invoice/edit.ts)
 * จำนวนรถ ลำดับ และตู้ มาจากไฟล์เสมอ (เพิ่ม/ลบคันไม่ได้) · เลขเครื่อง 7 หลักออกตอนบันทึก
 */

export type InvoiceSuggest = { prefix: string; next: number | null; last: number | null };
type Saved = {
  jobId: string; jobNo: string; fileId: string; version: number; pdf: boolean; invoiceNo: string;
  engines: { issued: number; reused: number } | null;
};

const FUELS = ['GASOLINE', 'DIESEL', 'PETROL'];
const fmt = (n: number | null) => (n === null ? '-' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));
/** ค่าที่มีผลต่อพิกัด — เปลี่ยนแล้วต้องดึงพิกัดใหม่ */
const tariffKeyOf = (cars: CargoCar[]) => JSON.stringify(cars.map(({ brand, model, fuel, cc, weight }) => [brand, model, fuel, cc, weight]));
const editsOf = (cars: CargoCar[]) => cars.map((c) => Object.fromEntries(EDIT_FIELDS.map((f) => [f, c[f]])));

const COLS: Array<{ k: EditField; label: string; cls: string; num?: boolean; comma?: boolean }> = [
  { k: 'brand', label: 'BRAND', cls: 'w-brand' },
  { k: 'model', label: 'MODEL', cls: 'w-model' },
  { k: 'chassis', label: 'CHASSIS NO.', cls: 'w-chassis' },
  { k: 'engine', label: 'ENGINE NO.', cls: 'w-engine' },
  { k: 'weight', label: 'WEIGHT (KG)', cls: 'w-num w-weight', num: true, comma: true },
  { k: 'year', label: 'YEAR', cls: 'w-year', num: true },
  { k: 'cc', label: 'CC', cls: 'w-num w-cc', num: true },
];

export function CargoInvoiceLaidOut({
  file, inv, suggest, initialJobs, initialJobId, initialMatchedBy, onReset, side, onStep, rulesVersion, onRulesChanged,
}: {
  file: File;
  inv: CargoInvoice;
  /** AICHI: เลข INVOICE NO. รันของระบบ (แก้ได้) */
  suggest: InvoiceSuggest | null;
  initialJobs: JobMatch[];
  initialJobId: string;
  initialMatchedBy: 'bl' | 'containers' | 'search';
  onReset: () => void;
  /** popup Create FN Invoice — เอกสารซ้าย ข้อมูลขวา */
  side?: boolean;
  onStep?: (step: 1 | 2 | 3 | 4) => void;
  /** กฎพิกัดเปลี่ยน (เพิ่มพิกัด / แก้ที่ข้อมูลอ้างอิง) — ดึงพิกัดใหม่ถ้าดึงไว้แล้ว */
  rulesVersion: number;
  onRulesChanged: () => void;
}) {
  const router = useRouter();
  /** รถหลังแก้ในตาราง — inv.cars คือค่าที่อ่านได้จากไฟล์ (ใช้เทียบว่าช่องไหนแก้) */
  const [cars, setCars] = useState<CargoCar[]>(inv.cars);
  const [jobs, setJobs] = useState<JobMatch[]>(initialJobs);
  const [jobId, setJobId] = useState(initialJobId);
  const [matchedBy, setMatchedBy] = useState(initialMatchedBy);
  const [jobQuery, setJobQuery] = useState('');
  const [invoiceNum, setInvoiceNum] = useState(suggest?.next ? String(suggest.next) : '');
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null);
  const [tariffFor, setTariffFor] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState('');
  const [view, setView] = useState<DocView>('file');
  const [csv, setCsv] = useState<DraftCsv | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const job = jobs.find((j) => j.id === jobId) ?? null;
  const numberOk = !suggest || /^[1-9]\d{0,6}$/.test(invoiceNum.trim());
  const currency = inv.currency || 'JPY';
  const locked = Boolean(saved) || Boolean(busy);

  /* ---------- งาน: ค้นเองด้วย BL / Job No. ---------- */
  async function searchJobs() {
    const q = jobQuery.trim();
    if (!q) return;
    setBusy('กำลังค้นงาน…');
    setError('');
    try {
      const data = await call<{ jobs: JobMatch[] }>(`/api/cargo-invoice/jobs?q=${encodeURIComponent(q)}`, { method: 'GET' });
      if (!data.jobs.length) throw new Error(`ไม่พบงานที่ BL / Job No. "${q}"`);
      setJobs(data.jobs);
      setMatchedBy('search');
      setJobId(data.jobs.length === 1 ? data.jobs[0].id : '');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function fetchTariffs(list = cars) {
    setBusy('กำลังดึงพิกัด…');
    setError('');
    try {
      const data = await call<{ results: Tariff[] }>('/api/cargo-invoice/tariff', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cars: list.map(({ brand, model, fuel, cc, weight, chassis, engine }) => ({ brand, model, fuel, cc, weight, chassis, engine })) }),
      });
      setTariffs(data.results);
      setTariffFor(tariffKeyOf(list));
      // คงตัวที่เลือกไว้แล้วถ้ายังเป็นตัวเลือกที่ใช้ได้ ไม่งั้นใช้ตัวที่ตรงตัวเดียว
      setChosen((prev) => data.results.map((r, i) => (r.candidates.some((c) => c.code === prev[i]) ? prev[i] : r.code)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  // กฎพิกัดเปลี่ยนจากที่อื่น (ข้อมูลอ้างอิงด้านล่าง / เพิ่มพิกัด) — ดึงใหม่ถ้าดึงไว้แล้ว
  const firstRules = useRef(rulesVersion);
  useEffect(() => {
    if (rulesVersion === firstRules.current) return;
    firstRules.current = rulesVersion;
    if (tariffs) void fetchTariffs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesVersion]);

  /** แก้ช่องหนึ่งของรถคันหนึ่ง — ตรวจปัญหาใหม่ทั้งชุด (เลขตัวถังซ้ำข้ามคันได้) */
  const editCar = (i: number, field: EditField, value: string) =>
    setCars((prev) => withProblems(prev.map((c, k) => (k === i ? applyCarEdit(c, { [field]: value }) : c))));
  const revertCar = (i: number) => setCars((prev) => withProblems(prev.map((c, k) => (k === i ? inv.cars[i] : c))));

  /** ข้อมูลที่ส่งไปประกอบใบ — ใช้ทั้ง Preview · CSV · บันทึก */
  const formOf = (extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set('file', file);
    if (job) fd.set('jobId', job.id);
    fd.set('tariffs', JSON.stringify(chosen));
    fd.set('edits', JSON.stringify(editsOf(cars)));
    if (suggest && numberOk) fd.set('invoiceNo', invoiceNum.trim());
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };
  const previewKey = JSON.stringify([jobId, chosen, editsOf(cars), invoiceNum]);
  const previewStale = Boolean(preview && previewFor !== previewKey);

  /** Preview FN Invoice — เซิร์ฟเวอร์ประกอบไฟล์ทางเดียวกับตอนบันทึก แล้วส่ง PDF กลับ (ไม่บันทึก ไม่ออกเลขเครื่อง) */
  async function showPreview() {
    setBusy('กำลังสร้าง Preview FN Invoice…');
    setError('');
    try {
      const res = await fetch('/api/cargo-invoice/preview', { method: 'POST', body: formOf() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
      setPreviewFor(previewKey);
      setView((v) => (v === 'both' ? v : 'fn'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  /** CSV สำหรับ Draft ใบขน — ก่อนบันทึก: ประกอบแบบ Preview (เลขเครื่อง 0000000) · หลังบันทึก: จากไฟล์ที่บันทึก (เลขจริง) */
  async function showCsv() {
    setBusy('กำลังสร้าง CSV…');
    setError('');
    try {
      if (saved) setCsv(await call<DraftCsv>(`/api/cargo-invoice/csv?jobId=${encodeURIComponent(saved.jobId)}`, { method: 'GET' }));
      else setCsv(await call<DraftCsv>('/api/cargo-invoice/preview', { method: 'POST', body: formOf({ output: 'csv' }) }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function save() {
    if (!job) return;
    setBusy('กำลังบันทึก Final Invoice…');
    setError('');
    try {
      const fd = formOf();
      if (suggest) fd.set('invoiceNo', invoiceNum.trim());
      setSaved(await call<Saved>('/api/cargo-invoice/save', { method: 'POST', body: fd }));
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  /* ---------- ตรวจความถูกต้อง (เหมือนเดิม) ---------- */
  const sum = (k: 'weight' | 'price') => cars.reduce((s, c) => s + (c[k] ?? 0), 0);
  const checks = useMemo(() => {
    const out: Array<{ ok: boolean; text: string }> = [];
    const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
    out.push(inv.stated.units === null
      ? { ok: true, text: `รถ ${cars.length} คัน (ใบไม่ได้ระบุจำนวนคันรวม)` }
      : { ok: inv.stated.units === cars.length, text: `รถ ${cars.length} คัน · แถว TOTAL ${inv.stated.units} UNITS` });
    if (inv.stated.weight !== null) out.push({ ok: close(inv.stated.weight, sum('weight')), text: `น้ำหนักรวม ${fmt(sum('weight'))} KG · แถว TOTAL ${fmt(inv.stated.weight)}` });
    else out.push({ ok: true, text: `น้ำหนักรวม ${fmt(sum('weight'))} KG` });
    // ค่าใช้จ่ายอื่นที่บวกอยู่ในยอด TOTAL (เช่น Forwarding ของ JAN TRADING) — ราคารถ + ค่านี้ ต้องเท่ายอด TOTAL
    const extra = inv.charges.filter((c) => c.inTotal).reduce((s, c) => s + c.amount, 0);
    const priceText = `ราคารถรวม ${fmt(sum('price'))}${extra ? ` + ค่าใช้จ่ายอื่น ${fmt(extra)}` : ''}`;
    if (inv.stated.amount !== null) out.push({ ok: close(inv.stated.amount, sum('price') + extra), text: `${priceText} · แถว TOTAL ${fmt(inv.stated.amount)}` });
    else out.push({ ok: true, text: priceText });
    const edited = cars.filter((c, i) => changedFields(inv.cars[i], c).length).length;
    if (edited) {
      out.push({ ok: true, text: `แก้แล้ว ${edited} คัน — ค่าที่แก้จะเขียนลงใบตอนบันทึก (ช่องสีเหลือง)` });
      if (inv.pattern !== 'JAN TRADING' && (sum('price') !== inv.cars.reduce((s, c) => s + (c.price ?? 0), 0)
        || sum('weight') !== inv.cars.reduce((s, c) => s + (c.weight ?? 0), 0))) {
        out.push({ ok: false, text: 'แก้ราคา/น้ำหนักแล้ว — ยอดในแถว TOTAL ของใบไม่ได้คำนวณใหม่ ตรวจใน Preview ก่อนบันทึก' });
      }
    }
    const bad = cars.filter((c) => c.problems.length).length;
    out.push({ ok: bad === 0, text: bad ? `รถ ${bad} คันข้อมูลไม่ครบ (แถวสีแดงด้านล่าง)` : 'ข้อมูลรถครบทุกคัน · ไม่มีเลขตัวถังซ้ำ' });
    if (job) {
      const missing = inv.containers.filter((c) => !job.containers.includes(c));
      const extraBox = job.containers.filter((c) => !inv.containers.includes(c));
      out.push(job.containers.length === 0
        ? { ok: false, text: `งาน ${job.jobNo} ยังไม่มีรายการตู้ในระบบ — เทียบเลขตู้ไม่ได้` }
        : { ok: !missing.length && !extraBox.length, text: missing.length || extraBox.length
          ? `เลขตู้ไม่ตรงกับงาน ${job.jobNo}${missing.length ? ` · ใน Invoice แต่ไม่มีในงาน: ${missing.join(', ')}` : ''}${extraBox.length ? ` · ในงานแต่ไม่มีใน Invoice: ${extraBox.join(', ')}` : ''}`
          : `เลขตู้ ${inv.containers.length} ตู้ ตรงกับงาน ${job.jobNo}` });
    }
    const odd = (tariffs ?? []).filter((t) => t.mismatch?.length).length;
    if (tariffs) {
      out.push(odd
        ? { ok: false, text: `ยี่ห้อ / รุ่น / Chassis / เครื่อง ไม่สัมพันธ์กัน ${odd} คัน (แถวสีส้ม) — ตรวจก่อนบันทึก ยังบันทึกได้` }
        : { ok: true, text: 'ยี่ห้อ / รุ่น / Chassis / เครื่อง สัมพันธ์กันตามข้อมูลที่มี' });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv, cars, job, tariffs]);

  const chassisChecks = cars.map((c) => checkChassis(c.brand, c.model, c.chassis));
  const chassisWarn = chassisChecks.filter((c) => c?.level === 'warn').length;
  const tariffStale = Boolean(tariffs && tariffFor !== tariffKeyOf(cars));
  const tariffSummary = tariffs && !tariffStale ? {
    found: tariffs.filter((t) => t.status === 'found').length,
    pick: tariffs.filter((t, i) => t.status === 'ambiguous' && !chosen[i]).length,
    missing: tariffs.filter((t) => t.status === 'missing').length,
  } : null;
  const editedCount = cars.filter((c, i) => changedFields(inv.cars[i], c).length).length;
  const readyToSave = Boolean(!inv.errors.length && job && tariffs && !tariffStale && chosen.length === cars.length
    && chosen.every(Boolean) && cars.every((c) => !c.problems.length));
  const missing = [
    !job && 'เลือกงาน', !numberOk && 'INVOICE NO.', inv.errors.length > 0 && 'ไฟล์มีปัญหา',
    cars.some((c) => c.problems.length) && 'ข้อมูลรถไม่ครบ',
    (!tariffs || tariffStale) && 'ดึงพิกัด', tariffs && !tariffStale && chosen.some((c) => !c) && 'เลือกพิกัด',
  ].filter(Boolean) as string[];

  // แถบขั้นตอน: เลขเครื่องออกตอนบันทึก จึงข้ามขั้นสุ่ม Engine
  const step: 1 | 2 | 3 | 4 = saved ? 4 : tariffs && !tariffStale ? 3 : 1;
  useEffect(() => { onStep?.(step); }, [step, onStep]);

  const info: Array<[string, string, string?]> = [
    ['BL', job?.blNo ?? '', job ? (inv.blNo && job.blNo && inv.blNo !== job.blNo.replace(/\s/g, '').toUpperCase() ? `ในใบเขียน ${inv.blNo} — ใช้ BL ของงาน` : 'จากงาน · เขียนลงช่อง B/L NO ให้') : 'ใช้ BL ของงานที่เลือก'],
    ['VESSEL', inv.vessel], ['BOOKING', inv.bookingNo],
    ['ตู้', `${inv.containers.length} ตู้${inv.sheets.length > 1 ? ` · ${inv.sheets.length} ชีต (ตู้ละชีต)` : ''}`],
  ];

  return (
    <div className={`cgi-normal${side ? ' side' : ''}`}>
      <CargoDocPane file={file} badge={inv.pattern} view={view} onView={setView} preview={preview} previewStale={previewStale}
        disabled={Boolean(busy)} onPreview={() => void showPreview()} onReset={onReset}
        fnNote="ยังไม่บันทึก · เลขเครื่อง xxxxxxx" />

      <div className="cgi-normal-data">
        {inv.errors.length ? <div className="cgi-error">{inv.errors.map((e) => <p key={e}>⚠️ {e}</p>)}</div> : null}
        <p className="batch-note cgi-normal-note">
          อ่านจากไฟล์ ({inv.pattern}) ได้ {inv.cars.length} คัน — ระบบจัดหน้า Final Invoice ให้: ใส่ BL ของงาน{suggest ? ' · INVOICE NO. รันของระบบ' : ''} · ออกเลขเครื่อง
          {' · '}{inv.pattern === 'AICHI' ? 'ต่อทุกตู้เป็นชีตเดียว' : 'ตัดแถว COLOR และค่าใช้จ่ายอื่น'} · TOTAL เป็นยอดรวมทั้ง BL
        </p>

        <section className="cgi-normal-sec">
          <div className="cgi-normal-headgrid">
            <div className="extract-field">
              <div className="extract-label">งาน (BL · ตู้)</div>
              <div className="extract-control cgi-normal-job">
                {jobs.length > 1 ? (
                  <select value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={locked}>
                    <option value="">— เลือกงาน ({jobs.length}{matchedBy === 'containers' ? ' ที่มีตู้ตรงกัน' : matchedBy === 'bl' ? ' ที่ BL ใกล้เคียง' : ''}) —</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.jobNo} · {j.blNo ?? '-'}{matchedBy === 'containers' ? ` · ตู้ตรง ${j.sharedBoxes}/${inv.containers.length}` : ''}</option>
                    ))}
                  </select>
                ) : job ? <b><Link href={`/job/${job.id}`}>{job.jobNo}</Link></b>
                  : <span className="cgi-bad">{inv.blNo ? `ไม่พบงานที่ BL ${inv.blNo}` : 'ใบไม่มีเลข BL'} — ค้นงาน</span>}
                <form className="cgi-jobsearch" onSubmit={(e) => { e.preventDefault(); void searchJobs(); }}>
                  <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="ค้น BL / Job No." disabled={locked} />
                  <button type="submit" className="button tiny" disabled={locked || jobQuery.trim().length < 4}>ค้น</button>
                </form>
              </div>
            </div>
            <div className="extract-field">
              <div className="extract-label">SHIPPER</div>
              <div className="extract-control"><b className="cgi-ro">{inv.supplier || inv.pattern}</b></div>
            </div>
            <div className="extract-field">
              <div className="extract-label">CURRENCY</div>
              <div className="extract-control"><b className="cgi-ro">{currency}</b></div>
            </div>
            <div className="extract-field">
              <div className="extract-label">INVOICE DATE</div>
              <div className="extract-control"><b className="cgi-ro">{inv.invoiceDate || '-'}</b></div>
            </div>
            <div className="extract-field">
              <div className="extract-label">INVOICE NO.</div>
              <div className="extract-control">
                {suggest ? (
                  // AICHI: เลขรันของระบบ — แก้ได้ก่อนสร้าง Final Invoice
                  <label className="cgi-invno">
                    <b>{suggest.prefix}</b>
                    <input value={invoiceNum} inputMode="numeric" className={numberOk ? '' : 'is-dup'} disabled={locked}
                      onChange={(e) => setInvoiceNum(e.target.value.replace(/[^\d]/g, ''))} />
                  </label>
                ) : <b className="cgi-ro">{inv.invoiceNo || '-'}</b>}
              </div>
            </div>
          </div>
          {suggest ? (
            <p className="cgi-normal-addr">
              {suggest.last !== null ? `เลขล่าสุดที่ใช้ ${suggest.prefix} ${suggest.last}` : 'ยังไม่เคยออกเลขในระบบ — ตั้งต้นจากเลขในใบ'}
              {` · ในใบผู้ขาย ${inv.invoiceNo}`}
              {suggest.last !== null && Number(invoiceNum) > 0 && Number(invoiceNum) <= suggest.last ? ' · ⚠ เลขนี้อาจซ้ำกับใบที่ออกไปแล้ว' : ''}
            </p>
          ) : null}
          <dl className="cgi-normal-info">
            {info.map(([k, v, note]) => (
              <div key={k}><dt>{k}</dt><dd className={v || k !== 'BL' ? '' : 'cgi-warn'}>{v || (k === 'BL' ? (job ? 'งานยังไม่มี BL' : '-') : '-')}{note ? <small className="muted"> · {note}</small> : null}</dd></div>
            ))}
          </dl>
          {job?.finalInvoice ? (
            <p className={job.fnStatus === 'APPROVED' ? 'cgi-bad' : 'cgi-warn'}>
              มี Final Invoice อยู่แล้ว (v{job.finalInvoice.version}{job.fnStatus ? ` · FN ${job.fnStatus === 'APPROVED' ? 'อนุมัติแล้ว' : job.fnStatus === 'PENDING' ? 'รออนุมัติ' : 'ถูกตีกลับ'}` : ''}) — บันทึกครั้งนี้จะเป็น v{job.finalInvoice.version + 1}
            </p>
          ) : null}
          <ul className="cgi-checks">
            {checks.map((c) => <li key={c.text} className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '⚠'} {c.text}</li>)}
          </ul>
          {inv.charges.length ? (
            <div className="cgi-charges">
              <span className="filter-label">ยอดอื่นในใบ (ไม่ใช่ราคารถ) · Final Invoice ตัดแถวเหล่านี้ออก ยอด TOTAL เหลือราคารถรวม</span>
              <ul>
                {inv.charges.map((c) => (
                  <li key={`${c.sheet}-${c.row}`}>{c.label} · <b>{fmt(c.amount)}</b><small>{c.inTotal ? ' บวกอยู่ในยอด TOTAL' : ' แจ้งไว้เฉยๆ (รวมในราคา CIF แล้ว)'}</small></li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="cgi-normal-sec">
          <div className="section-title">
            รายการรถ {cars.length} คัน · น้ำหนักรวม {fmt(sum('weight'))} KG · ยอดรวม {fmt(sum('price'))} {currency}
            {editedCount ? <span className="cgi-edit-key"><i /> แก้จากค่าในไฟล์ ({editedCount} คัน)</span> : null}
            {chassisWarn ? <span className="cgi-chassis-chk warn">⚠ BRAND/MODEL ไม่ตรงกับ CHASSIS {chassisWarn} คัน</span> : null}
            {tariffSummary ? (
              <span className="cgi-tsum">
                <b className="ok">พบพิกัด {tariffSummary.found}</b>
                {tariffSummary.pick ? <b className="warn">ต้องเลือก {tariffSummary.pick}</b> : null}
                {tariffSummary.missing ? <b className="bad">ไม่พบ {tariffSummary.missing}</b> : null}
              </span>
            ) : null}
          </div>
          {tariffStale ? <p className="cgi-warn">แก้ยี่ห้อ / รุ่น / เชื้อเพลิง / CC / น้ำหนักแล้ว — กด “ดึงพิกัดใหม่” ก่อนบันทึก</p> : null}
          <div className="table-wrap cgi-normal-tablewrap">
            <table className="data cgi-normal-table">
              <thead>
                <tr>
                  <th className="w-no">#</th>
                  {COLS.map((c) => <th key={c.k} className={c.cls}>{c.label}</th>)}
                  <th className="w-fuel">FUEL</th>
                  <th className="w-num w-amount">AMOUNT ({currency})</th>
                  <th className="w-box">CONTAINER</th>
                  <th className="w-tariff">พิกัด</th>
                  <th className="w-act" />
                </tr>
              </thead>
              <tbody>
                {cars.map((c, i) => {
                  const orig = inv.cars[i];
                  const t = tariffs && !tariffStale ? tariffs[i] : null;
                  const chk = chassisChecks[i];
                  const changed = changedFields(orig, c).length > 0;
                  return [
                    <tr key={`r${i}`} className={c.problems.length ? 'bad' : ''}>
                      <td className="w-no">{c.no}</td>
                      {COLS.map((col) => (
                        <td key={col.k} className={col.cls}>
                          <EditInput car={c} original={orig} field={col.k} comma={col.comma} num={col.num} locked={locked} label={`คันที่ ${c.no} ${col.label}`}
                            onEdit={(v) => editCar(i, col.k, v)} />
                          {col.k === 'chassis' && chk ? (
                            <small className={`cgi-chassis-chk ${chk.level}`} title={chk.text}>
                              {chk.level === 'ok' ? `✓ ${chk.key}` : chk.level === 'warn' ? `⚠ ${chk.text}` : `? ${chk.text}`}
                            </small>
                          ) : null}
                          {col.k === 'engine' && c.engine ? (
                            <small className="cgi-engine-out" title="ENGINE NO. ที่จะพิมพ์ในใบ (เลข 7 หลักออกตอนบันทึก)">→ {finalEngineText(c)}</small>
                          ) : null}
                        </td>
                      ))}
                      <td className="w-fuel">
                        <select className={(orig.fuel ?? '') !== (c.fuel ?? '') ? 'edited' : ''} value={c.fuel} disabled={locked}
                          aria-label={`คันที่ ${c.no} FUEL`} onChange={(e) => editCar(i, 'fuel', e.target.value)}>
                          {[...new Set([...FUELS, c.fuel].filter(Boolean))].map((f) => <option key={f}>{f}</option>)}
                        </select>
                      </td>
                      <td className="w-num w-amount">
                        <EditInput car={c} original={orig} field="price" comma num locked={locked} label={`คันที่ ${c.no} AMOUNT`} onEdit={(v) => editCar(i, 'price', v)} />
                      </td>
                      <td className="w-box cgi-box-ro">
                        {c.container || <span className="cgi-warn">-</span>}
                        {job && c.container && job.containers.length && !job.containers.includes(c.container)
                          ? <small className="cgi-bad"> ⚠ ไม่มีในงาน</small> : null}
                      </td>
                      <td className="w-tariff cgi-tariff">
                        {!t ? <span className="muted">{tariffStale ? 'ดึงใหม่' : '-'}</span>
                          : t.status === 'found' ? <span className="badge approved" title={t.candidates[0]?.rules.join(', ')}>{t.code}</span>
                            : t.status === 'ambiguous' ? (
                              <select className={chosen[i] ? '' : 'pick'} value={chosen[i] ?? ''} disabled={locked}
                                onChange={(e) => setChosen((prev) => prev.map((p, k) => (k === i ? e.target.value : p)))}>
                                <option value="">เลือก ({t.candidates.length})</option>
                                {t.candidates.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.rules.join(', ')}</option>)}
                              </select>
                            ) : <button type="button" className="button tiny danger" onClick={() => setAdding(adding === i ? null : i)}>{adding === i ? 'ปิด' : '+ พิกัด'}</button>}
                      </td>
                      <td className="w-act">
                        {changed && !locked ? <button type="button" className="icon-button" title="คืนค่าตามไฟล์" onClick={() => revertCar(i)}>↺</button> : null}
                      </td>
                    </tr>,
                    t?.mismatch?.length ? (
                      <tr key={`m${i}`} className="cgi-oddrow"><td /><td colSpan={COLS.length + 5}>⚠ {t.mismatch.join(' · ')}</td></tr>
                    ) : null,
                    c.problems.length ? (
                      <tr key={`p${i}`} className="cgi-normal-problem"><td /><td colSpan={COLS.length + 5}>
                        ⚠ {c.problems.join(' · ')} <small>({inv.sheets.length > 1 ? `ชีต ${c.sheet} ` : ''}แถว {c.row} ในไฟล์)</small>
                      </td></tr>
                    ) : null,
                    adding === i && t ? (
                      <tr key={`a${i}`}><td /><td colSpan={COLS.length + 5}>
                        <AddRule car={c} tariff={t} onAdded={async () => { setAdding(null); onRulesChanged(); }} />
                      </td></tr>
                    ) : null,
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={4} />
                  <td className="w-num"><b>{fmt(sum('weight'))}</b></td>
                  <td colSpan={3} />
                  <td className="w-num w-amount"><b>{fmt(sum('price'))}</b></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {error ? <p className="cgi-error">⚠️ {error}</p> : null}
        {busy ? <p className="cgi-busy"><span className="ai-dot" />{busy}</p> : null}

        <div className="cgi-normal-actions">
          {saved ? (
            <div className="cgi-done">
              <b>✓ บันทึก Final Invoice แล้ว — งาน <Link href={`/job/${saved.jobId}`}>{saved.jobNo}</Link> (v{saved.version}){suggest ? ` · ${saved.invoiceNo}` : ''}</b>
              <span>{saved.pdf ? 'แปลงเป็น PDF สำหรับชุด E-Office ให้แล้ว' : 'แปลง PDF ไม่สำเร็จ — ตอนรวมชุด E-Office ระบบจะลองใหม่'}</span>
              {saved.engines ? <span>เลขเครื่อง: ออกใหม่ {saved.engines.issued} คัน{saved.engines.reused ? ` · ใช้เลขเดิม ${saved.engines.reused} คัน` : ''}</span> : null}
              <div>
                <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void showCsv()}>📄 CSV Draft ใบขน</button>
                <Link className="button primary" href="/pending?tab=fn">ไปส่งอนุมัติ Final Invoice →</Link>
                <button type="button" className="button" onClick={onReset}>ทำใบถัดไป</button>
              </div>
            </div>
          ) : (
            <>
              <small>
                {missing.length ? `ยังขาด: ${missing.join(' · ')}` : `พร้อมบันทึกเป็น Final Invoice ของงาน ${job?.jobNo}`}
                {chassisWarn ? ` · BRAND/MODEL ไม่ตรงกับ CHASSIS ${chassisWarn} คัน (ตรวจก่อนบันทึก)` : ''}
              </small>
              <div className="cgi-save-actions">
                <button type="button" className="button" disabled={Boolean(busy) || !cars.length} onClick={() => void fetchTariffs()}>
                  {tariffs ? '↻ ดึงพิกัดใหม่' : 'ดึงพิกัด'}
                </button>
                <button type="button" className="button" disabled={Boolean(busy) || inv.errors.length > 0} onClick={() => void showPreview()}>👁 Preview FN Invoice</button>
                <button type="button" className="button" disabled={Boolean(busy) || inv.errors.length > 0} onClick={() => void showCsv()}>📄 CSV Draft ใบขน</button>
                <span className="cgi-save-right">
                  <button type="button" className="button primary" disabled={!readyToSave || !numberOk || Boolean(busy)} onClick={() => void save()}>
                    บันทึก Final Invoice
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {csv ? (
        <CsvDrawer csv={csv} note={saved ? 'จาก Final Invoice ที่บันทึกแล้ว — เลขเครื่องจริง' : 'ยังไม่ได้บันทึก — เลขเครื่อง 0000000'}
          onClose={() => setCsv(null)} />
      ) : null}
    </div>
  );
}

/**
 * ช่องแก้ในตาราง — ใช้ค่าเมื่อออกจากช่อง (กด Enter ก็ได้) · WEIGHT / AMOUNT แสดงลูกน้ำ พิมพ์ลูกน้ำได้
 * สีเหลือง = แก้จากค่าในไฟล์ (ชี้ดูค่าเดิม) · ค่าที่แก้ระบบปรับรูปแบบเอง (ตัวพิมพ์ใหญ่ · ตัดลูกน้ำ)
 */
function EditInput({
  car, original, field, num, comma, locked, label, onEdit,
}: {
  car: CargoCar; original: CargoCar; field: EditField; num?: boolean; comma?: boolean; locked: boolean; label: string;
  onEdit: (v: string) => void;
}) {
  const value = car[field];
  const text = value === null || value === undefined ? ''
    : comma && typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value);
  const edited = (original[field] ?? '') !== (value ?? '');
  return (
    <input key={text} className={edited ? 'edited' : ''} defaultValue={text} disabled={locked} aria-label={label}
      inputMode={num ? 'decimal' : undefined} title={edited ? `ในไฟล์: ${original[field] ?? '-'}` : undefined}
      onBlur={(e) => { if (e.target.value !== text) onEdit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
  );
}
