'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CargoCar, CargoInvoice } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import { finalEngineText } from '@/lib/cargo-invoice/engine-format';
import { applyCarEdit, changedFields, EDIT_FIELDS, withProblems, type EditField } from '@/lib/cargo-invoice/edit';
import { CargoReference } from './CargoReference';
import { AddRule, call, type Tariff } from './CargoShared';
import { CargoInvoiceNormal, type ShipperChoice } from './CargoInvoiceNormal';
import { CsvDrawer, PdfDrawer } from './CargoDocDrawers';
import type { DraftCsv } from '@/lib/cargo-invoice/draft-csv';

/**
 * Create Cargo Invoice — อัปโหลด Invoice Excel → ระบบจัดเรียงให้ตรวจ → ดึงพิกัด (เพิ่มรุ่นใหม่ได้) → บันทึก Final Invoice
 *
 * ไฟล์อยู่ในเบราว์เซอร์ตลอด ส่งขึ้นเซิร์ฟเวอร์ตอนอ่าน · Preview · บันทึก (ไม่เก็บจนกว่าจะบันทึก)
 * ทุกช่องในตารางรถแก้ได้ — ส่งค่าที่แก้ไปพร้อมไฟล์ เซิร์ฟเวอร์อ่านไฟล์ใหม่แล้วใส่ค่าที่แก้ทับ (lib/cargo-invoice/edit.ts)
 */

type Suggest = { prefix: string; next: number | null; last: number | null };
type Saved = {
  jobId: string; jobNo: string; fileId: string; version: number; pdf: boolean; invoiceNo: string;
  /** JAN TRADING: เลขเครื่องที่ออกใหม่ / ใช้เลขเดิม */
  engines: { issued: number; reused: number } | null;
};

const fmt = (n: number | null) => (n === null ? '-' : n.toLocaleString('en-US'));
/** ค่าที่มีผลต่อพิกัด — เปลี่ยนแล้วต้องดึงพิกัดใหม่ */
const tariffKey = (cars: CargoCar[]) => JSON.stringify(cars.map(({ brand, model, fuel, cc, weight }) => [brand, model, fuel, cc, weight]));
const editsOf = (cars: CargoCar[]) => cars.map((c) => Object.fromEntries(EDIT_FIELDS.map((f) => [f, c[f]])));
const STEPS = ['อัปโหลด Invoice', 'ตรวจข้อมูล', 'ดึงพิกัด (Tariff)', 'บันทึก Final Invoice'];


/** รูปแบบที่ระบบอ่านไฟล์แล้วจัดหน้า Final Invoice ให้เอง — ที่เหลือเป็น NORMAL (คีย์เองข้างไฟล์) */
const LAID_OUT = ['JAN TRADING', 'AICHI'];
type NormalPrefill = React.ComponentProps<typeof CargoInvoiceNormal>['prefill'];

/**
 * presetJob — เปิดจาก Pending jobs > 2. Final Invoice > Create FN Invoice (popup ของงานนั้น)
 * ใช้งานนี้เสมอ ไม่ต้องหางานจาก BL / เลขตู้ · บันทึกแล้วเป็น FINAL_INVOICE ของงานนี้
 */
export function CargoInvoiceTool({ shippers, presetJob, presetFile }: {
  shippers: ShipperChoice[]; presetJob?: JobMatch | null;
  /** Invoice สินค้า (INVOICE_GOODS) ของงาน — popup Create FN Invoice ใช้ไฟล์นี้เลย ข้ามขั้นอัปโหลด */
  presetFile?: { id: string; fileName: string } | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inv, setInv] = useState<CargoInvoice | null>(null);
  /** รถหลังแก้ในตาราง — inv.cars คือค่าที่อ่านได้จากไฟล์ (ใช้เทียบว่าช่องไหนแก้) */
  const [cars, setCars] = useState<CargoCar[]>([]);
  const [tariffFor, setTariffFor] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  /** popup Create FN Invoice: แผงซ้ายแสดงไฟล์ไหน — Invoice สินค้าของงาน หรือ Preview FN Invoice */
  const [leftView, setLeftView] = useState<'goods' | 'preview'>('goods');
  /** AICHI: เลข INVOICE NO. รันของระบบ (แก้ได้) */
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [invoiceNum, setInvoiceNum] = useState('');
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [jobId, setJobId] = useState('');
  const [matchedBy, setMatchedBy] = useState<'bl' | 'containers' | 'search'>('bl');
  const [jobQuery, setJobQuery] = useState('');
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rulesVersion, setRulesVersion] = useState(0);
  /** NORMAL — ผู้ขายรายอื่น: ฟอร์มคีย์เองข้างไฟล์ (รูป · PDF · Excel) */
  const [normal, setNormal] = useState<NormalPrefill | null>(null);
  const [csv, setCsv] = useState<DraftCsv | null>(null);

  const job = jobs.find((j) => j.id === jobId) ?? null;
  /** JAN TRADING · AICHI — ระบบจัดหน้า Final Invoice ให้ (BL ของงาน · เลขเครื่อง · ตัด/ต่อแถว · ยอดรวมทั้ง BL) */
  const jan = inv?.pattern === 'JAN TRADING' || inv?.pattern === 'AICHI';
  const numberOk = !suggest || /^[1-9]\d{0,6}$/.test(invoiceNum.trim());

  const reset = () => {
    setFile(null); setInv(null); setCars([]); setTariffFor(''); setSuggest(null); setInvoiceNum(''); setJobs([]); setJobId(''); setMatchedBy('bl'); setJobQuery(''); setTariffs(null); setChosen([]);
    setAdding(null); setSaved(null); setError(''); setNormal(null); setCsv(null);
    if (input.current) input.current.value = '';
  };

  async function read(f: File) {
    reset();
    setFile(f);
    // รูป / PDF — ไปฟอร์ม NORMAL เลย (ฟอร์มให้ AI อ่านแล้วเติมให้)
    if (!/\.xlsx$/i.test(f.name)) {
      setNormal({ cars: [], invoiceNo: '', invoiceDate: '', supplier: '', jobs: presetJob ? [presetJob] : [], note: '' });
      return;
    }
    setBusy('กำลังอ่านไฟล์…');
    try {
      const fd = new FormData();
      fd.set('file', f);
      const data = await call<{ invoice: CargoInvoice; jobs: JobMatch[]; matchedBy: 'bl' | 'containers'; invoiceSuggest: Suggest | null }>('/api/cargo-invoice/parse', { method: 'POST', body: fd });
      // ผู้ขายที่ไม่ใช่ JAN TRADING / AICHI → NORMAL เติมเท่าที่อ่านได้
      if (!LAID_OUT.includes(data.invoice.pattern)) {
        const ok = !data.invoice.errors.length && data.invoice.cars.length > 0;
        setNormal({
          cars: ok ? data.invoice.cars : [], invoiceNo: data.invoice.invoiceNo, invoiceDate: data.invoice.invoiceDate,
          supplier: data.invoice.supplier, jobs: presetJob ? [presetJob] : data.jobs,
          note: ok ? `อ่านรายการรถจากไฟล์ (${data.invoice.pattern}) ได้ ${data.invoice.cars.length} คัน — ตรวจทุกช่องก่อนบันทึก`
            : 'ไฟล์นี้ระบบอ่านรายการรถเองไม่ได้',
        });
        return;
      }
      setInv(data.invoice);
      setSuggest(data.invoiceSuggest);
      setInvoiceNum(data.invoiceSuggest?.next ? String(data.invoiceSuggest.next) : '');
      setCars(data.invoice.cars);
      if (presetJob) {
        setJobs([presetJob]);
        setJobId(presetJob.id);
        return;
      }
      setJobs(data.jobs);
      setMatchedBy(data.matchedBy);
      // หาด้วยเลขตู้แล้วเจอหลายงาน: เลือกให้เฉพาะเมื่องานแรกตู้ตรงครบทุกตู้และมากกว่างานอื่น
      const [top, second] = data.jobs;
      const sure = data.jobs.length === 1 || (data.matchedBy === 'containers' && top
        && top.sharedBoxes === data.invoice.containers.length && (second?.sharedBoxes ?? 0) < (top.sharedBoxes ?? 0));
      setJobId(sure ? top.id : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  /** ค้นงานเองด้วย BL / Job No. */
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
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
      setTariffFor(tariffKey(list));
      // คงตัวที่เลือกไว้แล้วถ้ายังเป็นตัวเลือกที่ใช้ได้ ไม่งั้นใช้ตัวที่ตรงตัวเดียว
      setChosen((prev) => data.results.map((r, i) => (r.candidates.some((c) => c.code === prev[i]) ? prev[i] : r.code)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function save() {
    if (!file || !inv || !job) return;
    setBusy('กำลังบันทึก Final Invoice…');
    setError('');
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('jobId', job.id);
      fd.set('tariffs', JSON.stringify(chosen));
      fd.set('edits', JSON.stringify(editsOf(cars)));
      if (suggest) fd.set('invoiceNo', invoiceNum.trim());
      setSaved(await call<Saved>('/api/cargo-invoice/save', { method: 'POST', body: fd }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  /** แก้ช่องหนึ่งของรถคันหนึ่ง — ตรวจปัญหาใหม่ทั้งชุด (เลขตัวถังซ้ำข้ามคันได้) */
  function editCar(i: number, field: EditField, value: string) {
    setCars((prev) => withProblems(prev.map((c, k) => (k === i ? applyCarEdit(c, { [field]: value }) : c))));
  }
  function revertCar(i: number) {
    if (!inv) return;
    setCars((prev) => withProblems(prev.map((c, k) => (k === i ? inv.cars[i] : c))));
  }

  /** Preview FN Invoice — เซิร์ฟเวอร์ประกอบไฟล์ทางเดียวกับตอนบันทึก แล้วส่ง PDF กลับ (ไม่บันทึก ไม่ออกเลขเครื่อง) */
  async function showPreview() {
    if (!file) return;
    setBusy('กำลังสร้าง Preview FN Invoice…');
    setError('');
    try {
      const fd = new FormData();
      fd.set('file', file);
      if (job) fd.set('jobId', job.id);
      fd.set('tariffs', JSON.stringify(chosen));
      fd.set('edits', JSON.stringify(editsOf(cars)));
      if (suggest && numberOk) fd.set('invoiceNo', invoiceNum.trim());
      const res = await fetch('/api/cargo-invoice/preview', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
      setLeftView('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  const closePreview = () => { setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; }); setLeftView('goods'); };

  /** CSV สำหรับ Draft ใบขน — ก่อนบันทึก: ประกอบไฟล์แบบ Preview (เลขเครื่อง 0000000) · หลังบันทึก: จากไฟล์ที่บันทึก (เลขจริง) */
  async function showCsv() {
    if (!file) return;
    setBusy('กำลังสร้าง CSV…');
    setError('');
    try {
      if (saved) {
        setCsv(await call<DraftCsv>(`/api/cargo-invoice/csv?jobId=${encodeURIComponent(saved.jobId)}`, { method: 'GET' }));
        return;
      }
      const fd = new FormData();
      fd.set('file', file);
      if (job) fd.set('jobId', job.id);
      fd.set('tariffs', JSON.stringify(chosen));
      fd.set('edits', JSON.stringify(editsOf(cars)));
      if (suggest && numberOk) fd.set('invoiceNo', invoiceNum.trim());
      fd.set('output', 'csv');
      setCsv(await call<DraftCsv>('/api/cargo-invoice/preview', { method: 'POST', body: fd }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  /* ---------- ตรวจความถูกต้อง ---------- */
  const checks = useMemo(() => {
    if (!inv) return [];
    const out: Array<{ ok: boolean; text: string }> = [];
    const sum = (k: 'weight' | 'price') => cars.reduce((s, c) => s + (c[k] ?? 0), 0);
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
    const bad = cars.filter((c) => c.problems.length).length;
    const edited = cars.filter((c, i) => changedFields(inv.cars[i], c).length).length;
    if (edited) {
      out.push({ ok: true, text: `แก้ในตารางแล้ว ${edited} คัน — ค่าที่แก้จะเขียนลงใบตอนบันทึก (ช่องสีเหลือง)` });
      // ยอดในแถว TOTAL ของผู้ขายไม่คำนวณใหม่ (ยกเว้น JAN TRADING ที่จัดหน้าใหม่)
      if (inv.pattern !== 'JAN TRADING' && (sum('price') !== inv.cars.reduce((s, c) => s + (c.price ?? 0), 0)
        || sum('weight') !== inv.cars.reduce((s, c) => s + (c.weight ?? 0), 0))) {
        out.push({ ok: false, text: 'แก้ราคา/น้ำหนักแล้ว — ยอดในแถว TOTAL ของใบไม่ได้คำนวณใหม่ ตรวจใน Preview ก่อนบันทึก' });
      }
    }
    out.push({ ok: bad === 0, text: bad ? `รถ ${bad} คันข้อมูลไม่ครบ (แถวสีแดงด้านล่าง)` : 'ข้อมูลรถครบทุกคัน · ไม่มีเลขตัวถังซ้ำ' });
    if (job) {
      const missing = inv.containers.filter((c) => !job.containers.includes(c));
      const extra = job.containers.filter((c) => !inv.containers.includes(c));
      out.push(job.containers.length === 0
        ? { ok: false, text: `งาน ${job.jobNo} ยังไม่มีรายการตู้ในระบบ — เทียบเลขตู้ไม่ได้` }
        : { ok: !missing.length && !extra.length, text: missing.length || extra.length
          ? `เลขตู้ไม่ตรงกับงาน ${job.jobNo}${missing.length ? ` · ใน Invoice แต่ไม่มีในงาน: ${missing.join(', ')}` : ''}${extra.length ? ` · ในงานแต่ไม่มีใน Invoice: ${extra.join(', ')}` : ''}`
          : `เลขตู้ ${inv.containers.length} ตู้ ตรงกับงาน ${job.jobNo}` });
    }
    // ยี่ห้อ · รุ่น · Chassis · เครื่อง ไม่สัมพันธ์กัน (ได้มาตอนดึงพิกัด) — เตือนอย่างเดียว บันทึกได้
    const odd = (tariffs ?? []).filter((t) => t.mismatch?.length).length;
    if (tariffs) {
      out.push(odd
        ? { ok: false, text: `ยี่ห้อ / รุ่น / Chassis / เครื่อง ไม่สัมพันธ์กัน ${odd} คัน (แถวสีส้มด้านล่าง) — ตรวจก่อนบันทึก ยังบันทึกได้` }
        : { ok: true, text: 'ยี่ห้อ / รุ่น / Chassis / เครื่อง สัมพันธ์กันตามข้อมูลที่มี' });
    }
    return out;
  }, [inv, cars, job, tariffs]);

  const tariffSummary = tariffs ? {
    found: tariffs.filter((t) => t.status === 'found').length,
    pick: tariffs.filter((t, i) => t.status === 'ambiguous' && !chosen[i]).length,
    missing: tariffs.filter((t) => t.status === 'missing').length,
  } : null;
  const tariffStale = Boolean(tariffs && tariffFor !== tariffKey(cars));
  const readyToSave = Boolean(inv && !inv.errors.length && job && tariffs && !tariffStale && chosen.length === cars.length
    && chosen.every(Boolean) && cars.every((c) => !c.problems.length));
  const step = saved ? 4 : tariffs ? 3 : inv ? 2 : 1;
  // ใช้ Invoice สินค้าของงาน: ไม่มีขั้นอัปโหลด ขั้นเริ่มที่ "ตรวจข้อมูล"
  const steps = presetFile ? STEPS.slice(1) : STEPS;
  const stepNow = presetFile ? Math.max(1, step - 1) : step;
  const loaded = useRef(false);
  useEffect(() => {
    if (!presetFile || loaded.current) return;
    loaded.current = true;
    setBusy('กำลังโหลด Invoice สินค้าของงาน…');
    void fetch(`/files/${presetFile.id}`).then(async (res) => {
      if (!res.ok) throw new Error('โหลด Invoice สินค้าไม่สำเร็จ');
      const blob = await res.blob();
      await read(new File([blob], presetFile.fileName, { type: blob.type }));
    }).catch((e) => { setBusy(''); setError(e instanceof Error ? e.message : String(e)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // จัดกลุ่มรถตามตู้ตามลำดับที่ปรากฏในใบ
  const groups = useMemo(() => {
    if (!inv) return [];
    const order = [...inv.containers, ...cars.map((c) => c.container).filter((c) => !inv.containers.includes(c))];
    return [...new Set(order)].map((box) => ({ box, cars: cars.map((c, i) => ({ c, i })).filter(({ c }) => c.container === box) }));
  }, [inv, cars]);

  const tool = (
    <div className="cgi">
      <ol className="cgi-steps">
        {steps.map((s, i) => (
          <li key={s} className={i + 1 < stepNow ? 'done' : i + 1 === stepNow ? 'now' : ''}><b>{i + 1}</b>{s}</li>
        ))}
      </ol>

      {/* ---------- 1. อัปโหลด (popup Create FN Invoice ใช้ Invoice สินค้าของงานแทน) ---------- */}
      <section className="cgi-card">
        {presetFile ? (
          <p className="batch-note">ใช้ Invoice สินค้าของงานนี้: <b>{presetFile.fileName}</b></p>
        ) : null}
        <div className="cgi-upload" hidden={Boolean(presetFile)}>
          <label className="cgi-drop">
            <input
              ref={input}
              type="file"
              accept=".xlsx,.pdf,image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            />
            <b>{file ? file.name : 'เลือกไฟล์ Invoice (Excel · PDF · รูป)'}</b>
            <small>{file ? `${(file.size / 1024).toFixed(0)} KB · กดเพื่อเลือกไฟล์ใหม่` : 'JAN TRADING · AICHI (Excel) ระบบอ่านและจัดหน้าให้ · ผู้ขายรายอื่น (Excel · PDF · รูป) เปิดฟอร์ม NORMAL ระบบอ่านแล้วเติมให้ตรวจ'}</small>
          </label>
          {inv ? <button type="button" className="button" onClick={reset} disabled={Boolean(busy)}>เริ่มใหม่</button> : null}
        </div>
        {busy ? <p className="cgi-busy"><span className="ai-dot" />{busy}</p> : null}
        {error ? <p className="cgi-error">⚠️ {error}</p> : null}
      </section>

      {normal && file ? <CargoInvoiceNormal key={`${file.name}-${file.lastModified}`} file={file} shippers={shippers} prefill={normal} onReset={reset} /> : null}

      {inv ? (
        <>
          {/* ---------- 2. หัวใบ + งาน + ตรวจ ---------- */}
          <section className="cgi-card">
            {inv.errors.length ? (
              <div className="cgi-error">{inv.errors.map((e) => <p key={e}>⚠️ {e}</p>)}</div>
            ) : null}
            <div className="cgi-head">
              <div><span>รูปแบบ</span><b><span className="badge neutral">{inv.pattern || '?'}</span></b><small>{inv.supplier}</small></div>
              <div>
                <span>Invoice No.</span>
                {suggest ? (
                  // AICHI: เลขรันของระบบ — แก้ได้ก่อนสร้าง Final Invoice
                  <label className="cgi-invno">
                    <b>{suggest.prefix}</b>
                    <input
                      value={invoiceNum}
                      inputMode="numeric"
                      className={numberOk ? '' : 'is-dup'}
                      disabled={Boolean(saved)}
                      onChange={(e) => setInvoiceNum(e.target.value.replace(/[^\d]/g, ''))}
                    />
                  </label>
                ) : <b>{inv.invoiceNo || '-'}</b>}
                {suggest ? (
                  <small>
                    {suggest.last !== null ? `เลขล่าสุดที่ใช้ ${suggest.prefix} ${suggest.last}` : 'ยังไม่เคยออกเลขในระบบ — ตั้งต้นจากเลขในใบ'}
                    {` · ในใบผู้ขาย ${inv.invoiceNo}`}
                    {suggest.last !== null && Number(invoiceNum) > 0 && Number(invoiceNum) <= suggest.last ? ' · ⚠ เลขนี้อาจซ้ำกับใบที่ออกไปแล้ว' : ''}
                  </small>
                ) : null}
              </div>
              <div><span>วันที่ Invoice</span><b>{inv.invoiceDate || '-'}</b></div>
              <div>
                <span>BL No.</span>
                {jan ? (
                  // JAN TRADING ใช้ BL ของงานเสมอ — เขียนลงช่อง B/L NO ของใบให้
                  job?.blNo ? <b>{job.blNo}</b> : <b className="cgi-warn">{job ? 'งานยังไม่มี BL' : 'ใช้ BL ของงานที่เลือก'}</b>
                ) : inv.blNo ? <b>{inv.blNo}</b> : <b className="cgi-warn">ใบไม่ได้กรอก</b>}
                {jan ? <small>{inv.blNo && job?.blNo && inv.blNo !== job.blNo.replace(/\s/g, '').toUpperCase() ? `ในใบเขียน ${inv.blNo} — ใช้ BL ของงานแทน` : 'จากแถวงาน · เขียนลงช่อง B/L NO ให้'}</small>
                  : inv.blNo ? null : <small>{job?.blNo ? `ใช้ BL ของงาน: ${job.blNo}` : 'จะใช้ BL ของงานที่เลือก'}</small>}
                {inv.bookingNo ? <small>Booking {inv.bookingNo}</small> : null}
              </div>
              <div><span>เรือ</span><b>{inv.vessel || '-'}</b></div>
              <div><span>ตู้</span><b>{inv.containers.length}</b>{inv.sheets.length > 1 ? <small>{inv.sheets.length} ชีต (ตู้ละชีต)</small> : null}</div>
            </div>

            <div className="cgi-job">
              <span className="filter-label">บันทึกเข้างาน</span>
              {jobs.length === 0 ? (
                <span className="cgi-bad">
                  {inv.blNo ? `ไม่พบงานที่ BL ${inv.blNo}` : 'ใบไม่มีเลข BL'} และไม่พบงานที่มีตู้ตรงกับใบนี้ — ค้นงานด้วย BL / Job No. ด้านขวา หรือสร้างงานจาก Arrival Notice ก่อน
                </span>
              ) : jobs.length === 1 ? (
                <b><Link href={`/job/${jobs[0].id}`}>{jobs[0].jobNo}</Link> <small>{jobs[0].blNo}</small></b>
              ) : (
                <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">— เลือกงาน ({jobs.length} งาน{matchedBy === 'containers' ? 'ที่มีตู้ตรงกัน' : matchedBy === 'bl' ? 'ที่ BL ใกล้เคียง' : ''}) —</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.jobNo} · {j.blNo ?? '-'}{matchedBy === 'containers' ? ` · ตู้ตรง ${j.sharedBoxes}/${inv.containers.length}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {jobs.length > 0 && matchedBy === 'containers' ? <small className="muted">หาจากเลขตู้ในใบ (ใบไม่มีเลข BL)</small> : null}
              <form className="cgi-jobsearch" onSubmit={(e) => { e.preventDefault(); void searchJobs(); }}>
                <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="ไม่ใช่งานนี้? ค้น BL / Job No." />
                <button type="submit" className="button tiny" disabled={Boolean(busy) || jobQuery.trim().length < 4}>ค้น</button>
              </form>
              {job?.finalInvoice ? (
                <span className={job.fnStatus === 'APPROVED' ? 'cgi-bad' : 'cgi-warn'}>
                  มี Final Invoice อยู่แล้ว (v{job.finalInvoice.version}{job.fnStatus ? ` · FN ${job.fnStatus === 'APPROVED' ? 'อนุมัติแล้ว' : job.fnStatus === 'PENDING' ? 'รออนุมัติ' : 'ถูกตีกลับ'}` : ''}) — บันทึกครั้งนี้จะเป็น v{job.finalInvoice.version + 1}
                </span>
              ) : null}
            </div>

            <ul className="cgi-checks">
              {checks.map((c) => <li key={c.text} className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '⚠'} {c.text}</li>)}
            </ul>
            {inv.charges.length ? (
              <div className="cgi-charges">
                <span className="filter-label">
                  ยอดอื่นในใบ (ไม่ใช่ราคารถ — ไม่เขียนลงตารางสรุป)
                  {jan ? ' · Final Invoice ตัดแถวเหล่านี้ออก ยอด TOTAL เหลือราคารถรวม' : ''}
                </span>
                <ul>
                  {inv.charges.map((c) => (
                    <li key={`${c.sheet}-${c.row}`}>
                      {c.label} · <b>{fmt(c.amount)}</b>
                      <small>{c.inTotal ? ' บวกอยู่ในยอด TOTAL' : ' แจ้งไว้เฉยๆ (รวมในราคา CIF แล้ว)'}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* ---------- 3. ตารางรถ + พิกัด ---------- */}
          <section className="cgi-card">
            <div className="cgi-bar">
              <h2>รายการรถ {cars.length} คัน <small className="muted">· กดช่องเพื่อแก้</small></h2>
              {tariffSummary ? (
                <span className="cgi-tsum">
                  <b className="ok">พบพิกัด {tariffSummary.found}</b>
                  {tariffSummary.pick ? <b className="warn">ต้องเลือก {tariffSummary.pick}</b> : null}
                  {tariffSummary.missing ? <b className="bad">ไม่พบ {tariffSummary.missing} — กด + เพิ่มพิกัด</b> : null}
                </span>
              ) : null}
              <button type="button" className="button" disabled={Boolean(busy) || !cars.length || inv.errors.length > 0} onClick={() => void showPreview()}>
                👁 Preview FN Invoice
              </button>
              <button type="button" className="button primary" disabled={Boolean(busy) || !cars.length} onClick={() => void fetchTariffs()}>
                {tariffs ? '↻ ดึงพิกัดใหม่' : '③ ดึงพิกัด (Tariff)'}
              </button>
            </div>
            {tariffStale ? <p className="cgi-warn">แก้ยี่ห้อ / รุ่น / เชื้อเพลิง / CC / น้ำหนักแล้ว — กด “ดึงพิกัดใหม่” ก่อนบันทึก</p> : null}

            <div className="table-wrap">
              <table className="data cgi-table">
                <thead>
                  <tr>
                    <th>#</th><th>ยี่ห้อ</th><th>รุ่น</th><th>เลขตัวถัง</th><th>เลขเครื่อง</th><th>เชื้อเพลิง</th>
                    <th className="num">CC</th><th className="num">ปี</th><th className="num">น้ำหนัก</th><th className="num">ราคา</th><th>พิกัด</th><th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ box, cars }) => (
                    <Fragment key={box || 'none'}>
                      <tr className="cgi-box">
                        <td colSpan={12}>
                          📦 <b>{box || 'ไม่ระบุตู้'}</b> · {cars.length} คัน
                          {job && box ? (job.containers.includes(box)
                            ? <span className="cgi-ok"> ✓ ตรงกับงาน</span>
                            : <span className="cgi-bad"> ⚠ ไม่มีในงาน {job.jobNo}</span>) : null}
                        </td>
                      </tr>
                      {cars.map(({ c, i }) => (
                        <CarRow
                          key={`${c.no}-${c.chassis}`}
                          car={c}
                          original={inv.cars[i]}
                          onEdit={(f, v) => editCar(i, f, v)}
                          onRevert={() => revertCar(i)}
                          locked={Boolean(saved) || Boolean(busy)}
                          multiSheet={inv.sheets.length > 1}
                          jan={jan}
                          tariff={tariffs?.[i] ?? null}
                          code={chosen[i] ?? ''}
                          onPick={(code) => setChosen((prev) => prev.map((p, k) => (k === i ? code : p)))}
                          adding={adding === i}
                          onAdd={() => setAdding(adding === i ? null : i)}
                          onAdded={async () => { setAdding(null); setRulesVersion((n) => n + 1); await fetchTariffs(); }}
                        />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------- 4. บันทึก ---------- */}
          <section className="cgi-card cgi-save">
            {saved ? (
              <div className="cgi-done">
                <b>✓ บันทึก Final Invoice แล้ว — งาน <Link href={`/job/${saved.jobId}`}>{saved.jobNo}</Link> (v{saved.version}){suggest ? ` · ${saved.invoiceNo}` : ''}</b>
                <span>{saved.pdf ? 'แปลงเป็น PDF สำหรับชุด E-Office ให้แล้ว' : 'แปลง PDF ไม่สำเร็จ — ตอนรวมชุด E-Office ระบบจะลองใหม่'}</span>
                {saved.engines ? (
                  <span>เลขเครื่อง: ออกใหม่ {saved.engines.issued} คัน{saved.engines.reused ? ` · ใช้เลขเดิม ${saved.engines.reused} คัน` : ''} — ดูได้ที่ตารางเลขเครื่องด้านล่าง</span>
                ) : null}
                <div>
                  <button type="button" className="button" disabled={Boolean(busy)} onClick={() => void showCsv()}>📄 CSV Draft ใบขน</button>
                  <Link className="button primary" href="/pending?tab=fn">ไปส่งอนุมัติ Final Invoice →</Link>
                  <button type="button" className="button" onClick={reset}>ทำใบถัดไป</button>
                </div>
              </div>
            ) : (
              <>
                <p>
                  {!job ? 'เลือกงานที่จะบันทึกก่อน'
                    : !numberOk ? 'ใส่เลข INVOICE NO. ก่อนบันทึก'
                    : !tariffs ? 'กด "ดึงพิกัด" ก่อนบันทึก'
                      : tariffStale ? 'แก้ข้อมูลรถแล้ว — กด "ดึงพิกัดใหม่" ก่อนบันทึก'
                      : !readyToSave ? 'ยังบันทึกไม่ได้ — ต้องมีพิกัดครบทุกคันและข้อมูลรถครบ'
                        : jan
                          ? `พร้อมบันทึกเป็น Final Invoice ของงาน ${job.jobNo} · ระบบจัดหน้าแบบ ${inv.pattern}: ใส่ BL ของงาน${suggest ? ` · INVOICE NO. ${suggest.prefix} ${invoiceNum}` : ''} · ออกเลขเครื่อง · ${inv.pattern === 'AICHI' ? 'ต่อทุกตู้เป็นชีตเดียว' : 'ตัดแถว COLOR และค่าใช้จ่ายอื่น'} · TOTAL เป็นยอดรวมทั้ง BL แล้วแปลง PDF พร้อมพิมพ์`
                          : `พร้อมบันทึกเป็น Final Invoice ของงาน ${job.jobNo} · ระบบเขียนตารางสรุปและพิกัดลงไฟล์ให้ worker สร้าง Draft ใบขนใช้ต่อ`}
                </p>
                <div className="cgi-save-actions">
                  <button type="button" className="button" disabled={Boolean(busy) || inv.errors.length > 0} onClick={() => void showPreview()}>
                    👁 Preview FN Invoice
                  </button>
                  <button type="button" className="button" disabled={Boolean(busy) || inv.errors.length > 0} onClick={() => void showCsv()}>
                    📄 CSV Draft ใบขน
                  </button>
                  <button type="button" className="button primary" disabled={!readyToSave || !numberOk || Boolean(busy)} onClick={() => void save()}>
                    ④ บันทึก Final Invoice
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      ) : null}

      {/* ---------- Preview FN Invoice — PDF ที่ประกอบแบบเดียวกับตอนบันทึก ---------- */}
      {/* popup Create FN Invoice แสดง Preview ที่แผงซ้ายแทน ไม่เปิดแผงทับฟอร์ม */}
      {preview && !presetFile ? (
        <PdfDrawer url={preview} title={`Preview FN Invoice${inv?.invoiceNo ? ` · ${inv.invoiceNo}` : ''}`}
          note={`ยังไม่ได้บันทึก${jan ? ' · เลขเครื่องออกจริงตอนบันทึก (แสดงเป็น xxxxxxx)' : ''}`} onClose={closePreview} />
      ) : null}
      {csv ? (
        <CsvDrawer csv={csv} note={saved ? 'จาก Final Invoice ที่บันทึกแล้ว — เลขเครื่องจริง' : 'ยังไม่ได้บันทึก — เลขเครื่อง 0000000'}
          onClose={() => setCsv(null)} />
      ) : null}

      {/* ---------- ข้อมูลอ้างอิง: Datatariff + เลขเครื่องที่ระบบออก ---------- */}
      <CargoReference version={rulesVersion} onChanged={() => { if (tariffs) void fetchTariffs(); }} />
    </div>
  );

  if (!presetFile) return tool;

  /*
   * popup Create FN Invoice — ไฟล์ซ้าย กรอกข้อมูลขวา (ทีมขอ) ดูใบไปแก้ไปได้โดยไม่ต้องเปิดแผงทับ
   * แผงซ้ายสลับได้ระหว่าง Invoice สินค้าของงาน กับ Preview FN Invoice (กด Preview แล้วสลับให้เอง)
   */
  const showing = leftView === 'preview' && preview ? preview : `/files/${presetFile.id}`;
  return (
    <div className="fn-split">
      <div className="fn-split-view">
        <div className="fn-split-tabs">
          <button type="button" className={`button tiny${leftView === 'goods' || !preview ? ' primary' : ''}`} onClick={() => setLeftView('goods')}>
            Invoice สินค้า
          </button>
          <button type="button" className={`button tiny${leftView === 'preview' && preview ? ' primary' : ''}`} disabled={!preview} onClick={() => setLeftView('preview')}
            title={preview ? undefined : 'กด Preview FN Invoice ทางขวาก่อน'}>
            Preview FN Invoice
          </button>
          {leftView === 'preview' && preview ? (
            <small className="muted">ยังไม่ได้บันทึก{jan ? ' · เลขเครื่องแสดงเป็น xxxxxxx' : ''}</small>
          ) : null}
          <a className="button tiny fn-split-open" href={showing} target="_blank" rel="noreferrer" title="เปิดแท็บใหม่">⤢</a>
        </div>
        <object key={showing} className="fn-split-file" data={showing} type="application/pdf">
          <p className="drawer-note warn">
            เบราว์เซอร์นี้แสดงไฟล์ในหน้าไม่ได้ · <a href={showing} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
          </p>
        </object>
      </div>
      <div className="fn-split-form">{tool}</div>
    </div>
  );
}

/** ช่องแก้ในตาราง — พิมพ์แล้วใช้ค่าเมื่อออกจากช่อง (กด Enter ก็ได้) ตัวเลขพิมพ์ลูกน้ำได้ */
function Cell({
  car, original, field, onEdit, locked, num, wide,
}: {
  car: CargoCar; original: CargoCar; field: EditField; onEdit: (f: EditField, v: string) => void;
  locked: boolean; num?: boolean; wide?: boolean;
}) {
  const value = car[field];
  const text = value === null || value === undefined ? '' : num && typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  const edited = (original[field] ?? '') !== (value ?? '');
  if (locked) return <td className={`${num ? 'num' : ''}${edited ? ' cgi-edited' : ''}`}>{text || '-'}</td>;
  return (
    <td className={`cgi-edit${num ? ' num' : ''}${edited ? ' cgi-edited' : ''}`}
      title={edited ? `ในไฟล์: ${original[field] ?? '-'}` : undefined}>
      <input
        key={text}
        className={`cgi-cell${wide ? ' wide' : ''}`}
        defaultValue={text}
        inputMode={num ? 'decimal' : undefined}
        onBlur={(e) => { if (e.target.value !== text) onEdit(field, e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </td>
  );
}

function CarRow({
  car, original, onEdit, onRevert, locked, multiSheet, jan, tariff, code, onPick, adding, onAdd, onAdded,
}: {
  car: CargoCar; original: CargoCar; onEdit: (f: EditField, v: string) => void; onRevert: () => void; locked: boolean;
  multiSheet: boolean; jan: boolean; tariff: Tariff | null; code: string; onPick: (code: string) => void;
  adding: boolean; onAdd: () => void; onAdded: () => Promise<void>;
}) {
  const bad = car.problems.length > 0;
  const changed = changedFields(original, car).length > 0;
  const cell = (field: EditField, opts: { num?: boolean; wide?: boolean } = {}) =>
    <Cell car={car} original={original} field={field} onEdit={onEdit} locked={locked} {...opts} />;
  return (
    <>
      <tr className={bad ? 'cgi-badrow' : undefined}>
        <td>{car.no}</td>
        {cell('brand')}
        {cell('model', { wide: true })}
        {cell('chassis', { wide: true })}
        {cell('engine')}
        {cell('fuel')}
        {cell('cc', { num: true })}
        {cell('year', { num: true })}
        {cell('weight', { num: true })}
        {cell('price', { num: true })}
        <td className="cgi-tariff">
          {!tariff ? <span className="muted">-</span>
            : tariff.status === 'found' ? <span className="badge approved" title={tariff.candidates[0]?.rules.join(', ')}>{tariff.code}</span>
              : tariff.status === 'ambiguous' ? (
                <select className={code ? '' : 'pick'} value={code} onChange={(e) => onPick(e.target.value)}>
                  <option value="">เลือกพิกัด ({tariff.candidates.length})</option>
                  {tariff.candidates.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.rules.join(', ')}</option>)}
                </select>
              ) : (
                <button type="button" className="button tiny danger" onClick={onAdd}>{adding ? 'ปิด' : '+ เพิ่มพิกัด'}</button>
              )}
        </td>
        <td>
          {changed && !locked ? (
            <button type="button" className="icon-button" title="คืนค่าตามไฟล์" onClick={onRevert}>↺</button>
          ) : null}
        </td>
      </tr>
      {jan && car.engine ? (
        // เลข 7 หลักออกตอนบันทึก — แสดงรูปแบบที่จะเขียนลงใบ
        <tr className="cgi-subrow"><td /><td colSpan={11}>ENGINE NO. ในใบ: <b>{finalEngineText(car)}</b></td></tr>
      ) : null}
      {tariff?.mismatch?.length ? (
        <tr className="cgi-oddrow"><td /><td colSpan={11}>⚠ {tariff.mismatch.join(' · ')}</td></tr>
      ) : null}
      {bad ? (
        <tr className="cgi-badrow"><td /><td colSpan={11}>⚠ {car.problems.join(' · ')} <small>({multiSheet ? `ชีต ${car.sheet} ` : ''}แถว {car.row} ในไฟล์)</small></td></tr>
      ) : null}
      {adding && tariff ? <tr><td /><td colSpan={11}><AddRule car={car} tariff={tariff} onAdded={onAdded} /></td></tr> : null}
    </>
  );
}
