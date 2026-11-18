'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CargoCar } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import type { DraftCsv } from '@/lib/cargo-invoice/draft-csv';
import type { AiInvoice } from '@/lib/cargo-invoice/ai-read';
import { cleanEdit, fieldProblems } from '@/lib/cargo-invoice/edit';
import { enginePrefix, existingEngineNumber } from '@/lib/cargo-invoice/engine-format';
import { SearchSelect } from '@/components/SearchSelect';
import { QuickAddMaster } from '@/components/QuickAddMaster';
import { CsvDrawer } from './CargoDocDrawers';
import { AddRule, call, type Tariff } from './CargoShared';

/**
 * Create Cargo Invoice แบบ NORMAL — ผู้ขายที่ไม่ใช่ JAN TRADING / AICHI
 *
 * บน: แผงดูเอกสารกลางจอ สลับ ไฟล์ผู้ขาย (รูป · PDF · Excel แปลงเป็น PDF) / Preview FN Invoice / ดูคู่กัน
 * ล่าง: งาน · Shipper · Currency · Invoice Date / No. (ใช้ทั้งชุด) แล้วตารางรถ แถวละ 1 คัน
 *
 * ระบบเติมให้ก่อนเท่าที่อ่านได้ — Excel ที่รู้จักรูปแบบ (MSFZ · JTC · HUAYO) อ่านเอง ที่เหลือ (PDF · รูป · Excel อื่น) ให้ AI อ่าน
 * ช่องที่ระบบเติมทำสีฟ้าไว้จนกว่าคนจะแก้ = ยังไม่ได้ตรวจ · คนตรวจ/แก้ได้ทุกช่องก่อนบันทึก
 * Preview FN Invoice กดได้ตลอด (ยังไม่เลือกงาน หัวใบช่องเรือ/BL ว่าง)
 * ข้อมูลเรือ (VESSEL … CARRIER) BL และตู้ มาจากงานในตารางหลัก — แก้ที่งาน ไม่แก้ที่นี่
 */

export type ShipperChoice = { id: string; code: string | null; name: string; address: string | null };
type FormCar = {
  brand: string; model: string; chassis: string; weight: string; year: string; engine: string;
  cc: string; fuel: string; amount: string; container: string;
};
type CarKey = keyof FormCar;
type Saved = { jobId: string; jobNo: string; version: number; pdf: boolean; invoiceNo: string; engines: { issued: number; reused: number } | null };
type View = 'file' | 'fn' | 'both';

const CURRENCIES = ['USD', 'JPY', 'EUR', 'GBP', 'CNY', 'AED', 'SGD', 'HKD', 'AUD', 'KRW', 'THB'];
const FUELS = ['GASOLINE', 'DIESEL', 'PETROL'];
const blank = (container = ''): FormCar => ({ brand: '', model: '', chassis: '', weight: '', year: '', engine: '', cc: '', fuel: 'GASOLINE', amount: '', container });
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
/** dd/mm/yyyy → yyyy-mm-dd (ช่องวันที่ของเบราว์เซอร์) */
const dmyToYmd = (s: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
};
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const text = (v: string | number | null) => (v === null || v === undefined ? '' : String(v));
/** ค่าที่ระบบใช้จริงของรถคันหนึ่ง (ตัวพิมพ์ใหญ่ · ตัวเลข) — แบบเดียวกับที่เซิร์ฟเวอร์ทำ */
const valueOf = (c: FormCar) => ({
  brand: String(cleanEdit('brand', c.brand) ?? ''), model: String(cleanEdit('model', c.model) ?? ''),
  chassis: String(cleanEdit('chassis', c.chassis) ?? ''), engine: String(cleanEdit('engine', c.engine) ?? ''),
  fuel: String(cleanEdit('fuel', c.fuel) ?? ''), cc: cleanEdit('cc', c.cc) as number | null,
  year: cleanEdit('year', c.year) as number | null, weight: cleanEdit('weight', c.weight) as number | null,
  price: cleanEdit('price', c.amount) as number | null,
});
const fromParsed = (c: Pick<CargoCar, 'brand' | 'model' | 'chassis' | 'engine' | 'fuel' | 'cc' | 'year' | 'weight' | 'price' | 'container'>): FormCar => ({
  brand: c.brand, model: c.model, chassis: c.chassis, weight: text(c.weight), year: text(c.year), engine: c.engine,
  cc: text(c.cc), fuel: c.fuel || 'GASOLINE', amount: text(c.price), container: c.container,
});
/** ช่องที่ระบบเติมให้ (มีค่า) — ทำสีไว้ให้คนตรวจ */
const filledKeys = (list: FormCar[]) => new Set(list.flatMap((c, i) =>
  (Object.keys(c) as CarKey[]).filter((k) => c[k] && !(k === 'fuel' && c[k] === 'GASOLINE' && !c.brand)).map((k) => `${i}:${k}`)));

const COLS: Array<{ k: CarKey; label: string; num?: boolean; cls?: string }> = [
  { k: 'brand', label: 'BRAND', cls: 'w-brand' },
  { k: 'model', label: 'MODEL', cls: 'w-model' },
  { k: 'chassis', label: 'CHASSIS NO.', cls: 'w-chassis' },
  { k: 'engine', label: 'ENGINE NO.', cls: 'w-engine' },
  { k: 'weight', label: 'WEIGHT (KG)', num: true, cls: 'w-num' },
  { k: 'year', label: 'YEAR', num: true, cls: 'w-year' },
  { k: 'cc', label: 'CC', num: true, cls: 'w-num' },
];

export function CargoInvoiceNormal({
  file, shippers, prefill, onReset,
}: {
  file: File;
  shippers: ShipperChoice[];
  prefill: { cars: CargoCar[]; invoiceNo: string; invoiceDate: string; supplier: string; jobs: JobMatch[]; note: string };
  onReset: () => void;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobMatch[]>(prefill.jobs);
  const [jobId, setJobId] = useState(prefill.jobs.length === 1 ? prefill.jobs[0].id : '');
  const [jobQuery, setJobQuery] = useState('');
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const [added, setAdded] = useState<ShipperChoice[]>([]);
  const allShippers = useMemo(() => [...shippers, ...added], [shippers, added]);
  const matchShipper = (name: string) => allShippers.find((s) => name && norm(s.name) === norm(name))?.id ?? '';
  const [shipperId, setShipperId] = useState(() => matchShipper(prefill.supplier));
  const [currency, setCurrency] = useState('USD');
  const [invoiceDate, setInvoiceDate] = useState(dmyToYmd(prefill.invoiceDate) || today());
  const [invoiceNo, setInvoiceNo] = useState(prefill.invoiceNo);
  const [cars, setCars] = useState<FormCar[]>(() => (prefill.cars.length ? prefill.cars.map(fromParsed) : [blank()]));
  /** ช่องที่ระบบเติม ยังไม่มีคนแก้ ("แถว:ช่อง") */
  const [auto, setAuto] = useState<Set<string>>(() => (prefill.cars.length ? filledKeys(prefill.cars.map(fromParsed)) : new Set()));
  const [note, setNote] = useState(prefill.note);
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null);
  const [tariffFor, setTariffFor] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState('');
  const [view, setView] = useState<View>('file');
  const [csv, setCsv] = useState<DraftCsv | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  /* ---------- ไฟล์ผู้ขาย: รูป / PDF เปิดตรง · Excel แปลงเป็น PDF ที่เซิร์ฟเวอร์ ---------- */
  const [fileView, setFileView] = useState<{ url: string; kind: 'img' | 'pdf' } | null>(null);
  const [fileNote, setFileNote] = useState('');
  useEffect(() => {
    let url = '';
    let gone = false;
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isImage || isPdf) {
      url = URL.createObjectURL(file);
      setFileView({ url, kind: isImage ? 'img' : 'pdf' });
    } else if (/\.xlsx$/i.test(file.name)) {
      setFileNote('กำลังแปลง Excel เป็น PDF…');
      const fd = new FormData();
      fd.set('file', file);
      void fetch('/api/cargo-invoice/file-preview', { method: 'POST', body: fd }).then(async (res) => {
        if (gone) return;
        if (!res.ok) { setFileNote((await res.json().catch(() => ({}))).error ?? 'แปลงไฟล์ไม่ได้'); return; }
        url = URL.createObjectURL(await res.blob());
        setFileView({ url, kind: 'pdf' });
        setFileNote('');
      });
    } else {
      setFileNote('ไฟล์ชนิดนี้แสดงในหน้าไม่ได้ — เปิดดูจากเครื่องแทน');
    }
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  /* ---------- ระบบอ่านไฟล์ไม่ได้เอง → ให้ AI อ่านแล้วเติมฟอร์ม (ครั้งเดียวตอนเปิด · กดอ่านซ้ำได้) ---------- */
  async function aiRead() {
    setReading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('file', file);
      const data = await call<{ invoice: AiInvoice; jobs: JobMatch[]; baht: number }>('/api/cargo-invoice/ai-read', { method: 'POST', body: fd });
      const inv = data.invoice;
      if (!inv.cars.length) {
        setNote('AI อ่านรายการรถจากไฟล์นี้ไม่ได้ — คีย์จากไฟล์ด้านบน');
        return;
      }
      const list = inv.cars.map((c) => fromParsed({ ...c }));
      setCars(list);
      setAuto(filledKeys(list));
      setTariffs(null);
      setChosen([]);
      if (inv.invoiceNo) setInvoiceNo(inv.invoiceNo);
      if (dmyToYmd(inv.invoiceDate)) setInvoiceDate(dmyToYmd(inv.invoiceDate));
      if (inv.currency) setCurrency(inv.currency);
      const sid = matchShipper(inv.supplier);
      if (sid) setShipperId(sid);
      if (data.jobs.length && !jobId) {
        setJobs(data.jobs);
        if (data.jobs.length === 1) setJobId(data.jobs[0].id);
      }
      setNote(`AI อ่านได้ ${inv.cars.length} คัน${inv.supplier ? ` · ผู้ขาย ${inv.supplier}${sid ? '' : ' (ไม่พบใน Master Data — เลือก/เพิ่ม Shipper เอง)'}` : ''}`
        + ` — ช่องสีฟ้าคือค่าที่ระบบเติม ตรวจกับไฟล์ด้านบนทุกช่องก่อนบันทึก (~${data.baht.toFixed(2)} บาท)`);
    } catch (e) {
      setNote(`ระบบอ่านไฟล์นี้ไม่ได้ — คีย์จากไฟล์ด้านบน (${e instanceof Error ? e.message : String(e)})`);
    } finally { setReading(false); }
  }
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || prefill.cars.length) return;
    tried.current = true;
    void aiRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // เลือกงานแล้ว: Shipper ของงาน (ถ้ายังไม่ได้เลือก) · ตู้เดียวเติมให้ทุกคัน
  useEffect(() => {
    if (!job) return;
    if (!shipperId && job.ship.shipperId && allShippers.some((s) => s.id === job.ship.shipperId)) setShipperId(job.ship.shipperId);
    setCars((prev) => prev.map((c) => (job.containers.includes(c.container) ? c
      : { ...c, container: job.containers.length === 1 ? job.containers[0] : '' })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const shipper = allShippers.find((s) => s.id === shipperId) ?? null;
  const values = cars.map(valueOf);
  const problems = fieldProblems(values);
  const key = JSON.stringify(values.map((v) => [v.brand, v.model, v.fuel, v.cc, v.weight]));
  const tariffStale = Boolean(tariffs && tariffFor !== key);
  const sum = (k: 'weight' | 'price') => values.reduce((s, v) => s + (v[k] ?? 0), 0);
  const boxMissing = cars.some((c) => !c.container || (job?.containers.length && !job.containers.includes(c.container)));
  const missing = [
    !job && 'เลือกงาน', !shipper && 'Shipper', !invoiceNo.trim() && 'Invoice No.', !invoiceDate && 'Invoice Date',
    problems.some((p) => p.length) && 'ข้อมูลรถไม่ครบ', boxMissing && 'ตู้ของรถ',
    (!tariffs || tariffStale) && 'ดึงพิกัด', tariffs && !tariffStale && chosen.some((c) => !c) && 'เลือกพิกัด',
  ].filter(Boolean) as string[];

  const setCar = (i: number, patch: Partial<FormCar>) => {
    setCars((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
    setAuto((prev) => {
      const keys = Object.keys(patch).map((k) => `${i}:${k}`).filter((k) => prev.has(k));
      if (!keys.length) return prev;
      const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next;
    });
  };
  /** แทรกแถวหลังแถว at (by = 1) / ลบแถว at (by = -1) — เลื่อนป้าย "ระบบเติม" ตามแถว */
  const shiftAuto = (at: number, by: 1 | -1) => setAuto((prev) => new Set([...prev].flatMap((k) => {
    const [r, f] = k.split(':');
    const n = Number(r);
    if (by < 0 && n === at) return [];
    return [`${n > at ? n + by : n}:${f}`];
  })));
  const payloadOf = (mode: string) => JSON.stringify({ mode, jobId, shipperId, currency, invoiceDate, invoiceNo, cars, tariffs: chosen });
  const previewStale = Boolean(preview && previewFor !== payloadOf('preview'));

  async function searchJobs() {
    const q = jobQuery.trim();
    if (!q) return;
    setBusy('กำลังค้นงาน…');
    setError('');
    try {
      const data = await call<{ jobs: JobMatch[] }>(`/api/cargo-invoice/jobs?q=${encodeURIComponent(q)}`, { method: 'GET' });
      if (!data.jobs.length) throw new Error(`ไม่พบงานที่ BL / Job No. "${q}"`);
      setJobs(data.jobs);
      setJobId(data.jobs.length === 1 ? data.jobs[0].id : '');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function fetchTariffs() {
    setBusy('กำลังดึงพิกัด…');
    setError('');
    try {
      const data = await call<{ results: Tariff[] }>('/api/cargo-invoice/tariff', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cars: values.map(({ brand, model, fuel, cc, weight }) => ({ brand, model, fuel, cc, weight })) }),
      });
      setTariffs(data.results);
      setTariffFor(key);
      setChosen((prev) => data.results.map((r, i) => (r.candidates.some((c) => c.code === prev[i]) ? prev[i] : r.code)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function post(mode: 'preview' | 'csv' | 'save') {
    setBusy(mode === 'save' ? 'กำลังบันทึก Final Invoice…' : mode === 'csv' ? 'กำลังสร้าง CSV…' : 'กำลังสร้าง Preview FN Invoice…');
    setError('');
    const body = payloadOf(mode);
    try {
      const res = await fetch('/api/cargo-invoice/normal', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const isPdf = res.headers.get('content-type')?.includes('pdf');
      if (!res.ok || !isPdf && mode === 'preview') {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      if (mode === 'preview') {
        const url = URL.createObjectURL(await res.blob());
        setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
        setPreviewFor(payloadOf('preview'));
        setView((v) => (v === 'both' ? v : 'fn'));
        return;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (mode === 'csv') setCsv(data as DraftCsv);
      else { setSaved(data as Saved); router.refresh(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function savedCsv() {
    if (!saved) return;
    setBusy('กำลังสร้าง CSV…');
    try { setCsv(await call<DraftCsv>(`/api/cargo-invoice/csv?jobId=${encodeURIComponent(saved.jobId)}`, { method: 'GET' })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  const locked = Boolean(saved) || Boolean(busy) || reading;
  const info: Array<[string, string]> = job ? [
    ['VESSEL', job.ship.vessel], ['VOYAGE', job.ship.voyage], ['PORT OF LOADING', job.ship.portOfLoading],
    ['PORT OF DESTINATION', job.ship.portOfDestination], ['DATE OF SHIP (ETD)', job.ship.etd], ['BL', job.blNo ?? ''],
    ['CARRIER', job.ship.carrier], ['ตู้', job.containers.join(', ')],
  ] : [];

  const vendorPane = fileView?.kind === 'img' ? <img className="cgi-doc-file" src={fileView.url} alt={file.name} />
    : fileView ? <object className="cgi-doc-file" data={fileView.url} type="application/pdf"><p>{file.name}</p></object>
      : <p className="batch-note">{fileNote}</p>;
  const fnPane = preview
    ? <object className="cgi-doc-file" data={preview} type="application/pdf"><p><a href={preview} target="_blank" rel="noreferrer">เปิด Preview FN Invoice</a></p></object>
    : (
      <div className="cgi-doc-empty">
        <p>ยังไม่ได้สร้าง Preview FN Invoice</p>
        <button type="button" className="button primary" disabled={Boolean(busy) || reading} onClick={() => void post('preview')}>👁 Preview FN Invoice</button>
      </div>
    );
  const cellCls = (i: number, k: CarKey) => (auto.has(`${i}:${k}`) ? 'auto' : '');

  return (
    <div className="cgi-normal">
      {/* ---------- บน: เอกสาร ---------- */}
      <section className="cgi-doc">
        <div className="cgi-doc-bar">
          <span className="badge neutral">NORMAL</span>
          <b className="cgi-doc-name" title={file.name}>{file.name}</b>
          <div className="cgi-doc-tabs" role="tablist" aria-label="เอกสารที่แสดง">
            {([['file', 'ไฟล์ผู้ขาย'], ['fn', `FN Invoice${previewStale ? ' •' : ''}`], ['both', 'ดูคู่กัน']] as Array<[View, string]>).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
            ))}
          </div>
          <button type="button" className="button tiny" disabled={Boolean(busy) || reading} onClick={() => void post('preview')}>
            {preview ? '↻ Preview FN Invoice' : '👁 Preview FN Invoice'}
          </button>
          {preview ? <a className="button tiny" href={preview} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a> : null}
          <button type="button" className="button tiny" onClick={onReset} disabled={Boolean(busy)}>เริ่มใหม่</button>
        </div>
        {previewStale && view !== 'file' ? <p className="cgi-doc-stale">ข้อมูลด้านล่างเปลี่ยนหลัง Preview — กด ↻ Preview FN Invoice เพื่อดูฉบับล่าสุด</p> : null}
        <div className={`cgi-doc-body ${view}`}>
          {view !== 'fn' ? <div className="cgi-doc-pane">{view === 'both' ? <small>ไฟล์ผู้ขาย</small> : null}{vendorPane}</div> : null}
          {view !== 'file' ? <div className="cgi-doc-pane">{view === 'both' ? <small>FN Invoice{preview ? ' (ยังไม่บันทึก · เลขเครื่อง xxxxxxx)' : ''}</small> : null}{fnPane}</div> : null}
        </div>
      </section>

      {/* ---------- ล่าง: ข้อมูล ---------- */}
      {reading ? <p className="cgi-busy"><span className="ai-dot" />AI กำลังอ่านไฟล์และเติมข้อมูลให้… (ราว 10–40 วินาที)</p> : null}
      {note && !reading ? (
        <p className="batch-note cgi-normal-note">
          {note}
          {!saved && /\.(pdf|png|jpe?g|webp|gif|xlsx)$/i.test(file.name) ? (
            <button type="button" className="button tiny" disabled={locked} onClick={() => void aiRead()}>🤖 ให้ AI อ่านอีกครั้ง</button>
          ) : null}
        </p>
      ) : null}

      <section className="cgi-normal-sec">
        <div className="cgi-normal-headgrid">
          <div className="extract-field">
            <div className="extract-label">งาน (ข้อมูลเรือ · BL · ตู้)</div>
            <div className="extract-control cgi-normal-job">
              {jobs.length > 1 ? (
                <select value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={locked}>
                  <option value="">— เลือกงาน ({jobs.length}) —</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.jobNo} · {j.blNo ?? '-'}</option>)}
                </select>
              ) : job ? <b><Link href={`/job/${job.id}`}>{job.jobNo}</Link></b> : null}
              <form className="cgi-jobsearch" onSubmit={(e) => { e.preventDefault(); void searchJobs(); }}>
                <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="ค้น BL / Job No." disabled={locked} />
                <button type="submit" className="button tiny" disabled={locked || jobQuery.trim().length < 4}>ค้น</button>
              </form>
            </div>
          </div>
          <div className="extract-field cgi-normal-shipper">
            <div className="extract-label">SHIPPER</div>
            <div className="extract-control bl-edit-shipper">
              <SearchSelect choices={allShippers} value={shipperId} placeholder="พิมพ์ค้นหา Shipper" onChange={setShipperId} />
              <QuickAddMaster type="shippers" onAdded={(s) => { setAdded((list) => [...list, { ...s, address: null }]); setShipperId(s.id); }} />
            </div>
          </div>
          <div className="extract-field">
            <div className="extract-label">CURRENCY</div>
            <div className="extract-control">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked}>
                {[...new Set([...CURRENCIES, currency])].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="extract-field">
            <div className="extract-label">INVOICE DATE</div>
            <div className="extract-control"><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={locked} /></div>
          </div>
          <div className="extract-field">
            <div className="extract-label">INVOICE NO.</div>
            <div className="extract-control"><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value.toUpperCase())} disabled={locked} /></div>
          </div>
        </div>
        {shipper ? (
          shipper.address
            ? <p className="cgi-normal-addr"><b>{shipper.name}</b> · {shipper.address.split('\n').join(' · ')}</p>
            : <p className="cgi-warn">Shipper นี้ยังไม่มีที่อยู่ — ตั้งที่ Master Data &gt; Shipper (ผู้ดูแลระบบ) หัวใบจะมีแต่ชื่อ</p>
        ) : null}
        {job ? (
          <dl className="cgi-normal-info">
            {info.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd className={v ? '' : 'cgi-warn'}>{v || 'ยังไม่มีในงาน'}</dd></div>
            ))}
          </dl>
        ) : <p className="batch-note">ยังไม่ได้เลือกงาน — Preview ได้ แต่หัวใบช่อง VESSEL · VOYAGE · PORT · DATE OF SHIP · BL · CARRIER จะว่าง</p>}
      </section>

      <section className="cgi-normal-sec">
        <div className="section-title">
          รายการรถ {cars.length} คัน · น้ำหนักรวม {fmt(sum('weight'))} KG · ยอดรวม {fmt(sum('price'))} {currency}
          {auto.size ? <span className="cgi-auto-key"><i /> ระบบเติม — ยังไม่ได้ตรวจ ({auto.size} ช่อง)</span> : null}
        </div>
        <div className="table-wrap cgi-normal-tablewrap">
          <table className="data cgi-normal-table">
            <thead>
              <tr>
                <th className="w-no">#</th>
                {COLS.map((c) => <th key={c.k} className={c.cls}>{c.label}</th>)}
                <th className="w-fuel">FUEL</th>
                <th className="w-num">AMOUNT ({currency})</th>
                <th className="w-box">CONTAINER</th>
                <th className="w-tariff">พิกัด</th>
                <th className="w-act" />
              </tr>
            </thead>
            <tbody>
              {cars.map((c, i) => {
                const t = tariffs && !tariffStale ? tariffs[i] : null;
                const v = values[i];
                return [
                  <tr key={`r${i}`} className={problems[i].length ? 'bad' : ''}>
                    <td className="w-no">{i + 1}</td>
                    {COLS.map((col) => (
                      <td key={col.k} className={col.cls}>
                        <input className={cellCls(i, col.k)} value={c[col.k]} inputMode={col.num ? 'decimal' : undefined} disabled={locked}
                          aria-label={`คันที่ ${i + 1} ${col.label}`}
                          onChange={(e) => setCar(i, { [col.k]: col.num ? e.target.value : e.target.value.toUpperCase() })} />
                        {col.k === 'engine' && v.engine ? (
                          <small className="cgi-engine-out" title="ENGINE NO. ที่จะพิมพ์ในใบ (เลขจริงออกตอนบันทึก)">
                            → {enginePrefix(v.engine)}-{existingEngineNumber(v.engine) ?? 'xxxxxxx'}
                          </small>
                        ) : null}
                      </td>
                    ))}
                    <td className="w-fuel">
                      <select className={cellCls(i, 'fuel')} value={c.fuel} onChange={(e) => setCar(i, { fuel: e.target.value })} disabled={locked} aria-label={`คันที่ ${i + 1} FUEL`}>
                        {[...new Set([...FUELS, c.fuel].filter(Boolean))].map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </td>
                    <td className="w-num">
                      <input className={cellCls(i, 'amount')} value={c.amount} inputMode="decimal" disabled={locked} aria-label={`คันที่ ${i + 1} AMOUNT`}
                        onChange={(e) => setCar(i, { amount: e.target.value })} />
                    </td>
                    <td className="w-box">
                      {job?.containers.length ? (
                        <select className={cellCls(i, 'container')} value={c.container} onChange={(e) => setCar(i, { container: e.target.value })} disabled={locked} aria-label={`คันที่ ${i + 1} ตู้`}>
                          <option value="">— ตู้ —</option>
                          {job.containers.map((b) => <option key={b}>{b}</option>)}
                        </select>
                      ) : (
                        <input className={cellCls(i, 'container')} value={c.container} onChange={(e) => setCar(i, { container: e.target.value.toUpperCase() })} disabled={locked} placeholder="เลขตู้" aria-label={`คันที่ ${i + 1} ตู้`} />
                      )}
                    </td>
                    <td className="w-tariff cgi-tariff">
                      {!t ? <span className="muted">{tariffStale ? 'ดึงใหม่' : '-'}</span>
                        : t.status === 'found' ? <span className="badge approved">{t.code}</span>
                          : t.status === 'ambiguous' ? (
                            <select className={chosen[i] ? '' : 'pick'} value={chosen[i] ?? ''} disabled={locked}
                              onChange={(e) => setChosen((prev) => prev.map((p, k) => (k === i ? e.target.value : p)))}>
                              <option value="">เลือก ({t.candidates.length})</option>
                              {t.candidates.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.rules.join(', ')}</option>)}
                            </select>
                          ) : <button type="button" className="button tiny danger" onClick={() => setAdding(adding === i ? null : i)}>{adding === i ? 'ปิด' : '+ พิกัด'}</button>}
                    </td>
                    <td className="w-act">
                      {!locked ? (
                        <span className="cgi-row-act">
                          <button type="button" className="icon-button" title="เพิ่มคันใหม่ค่าเหมือนคันนี้ (ยกเว้น Chassis)"
                            onClick={() => { shiftAuto(i, 1); setCars((prev) => [...prev.slice(0, i + 1), { ...c, chassis: '' }, ...prev.slice(i + 1)]); }}>⧉</button>
                          {cars.length > 1 ? (
                            <button type="button" className="icon-button" title="ลบคันนี้"
                              onClick={() => { shiftAuto(i, -1); setCars((prev) => prev.filter((_, k) => k !== i)); }}>×</button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>,
                  problems[i].length ? (
                    <tr key={`p${i}`} className="cgi-normal-problem"><td /><td colSpan={COLS.length + 5}>⚠ {problems[i].join(' · ')}</td></tr>
                  ) : null,
                  adding === i && t ? (
                    <tr key={`a${i}`}><td /><td colSpan={COLS.length + 5}>
                      <AddRule car={{ brand: v.brand, model: v.model, fuel: v.fuel, cc: v.cc }} tariff={t}
                        onAdded={async () => { setAdding(null); await fetchTariffs(); }} />
                    </td></tr>
                  ) : null,
                ];
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td colSpan={4}>
                  {!locked ? (
                    <button type="button" className="button tiny"
                      onClick={() => setCars((prev) => [...prev, blank(job?.containers.length === 1 ? job.containers[0] : '')])}>+ เพิ่มคัน</button>
                  ) : null}
                </td>
                <td className="w-num"><b>{fmt(sum('weight'))}</b></td>
                <td colSpan={3} />
                <td className="w-num"><b>{fmt(sum('price'))}</b></td>
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
            <b>✓ บันทึก Final Invoice แล้ว — งาน <Link href={`/job/${saved.jobId}`}>{saved.jobNo}</Link> (v{saved.version}) · {saved.invoiceNo}</b>
            <span>{saved.pdf ? 'แปลงเป็น PDF สำหรับชุด E-Office ให้แล้ว' : 'แปลง PDF ไม่สำเร็จ — ตอนรวมชุด E-Office ระบบจะลองใหม่'}</span>
            {saved.engines ? <span>เลขเครื่อง: ออกใหม่ {saved.engines.issued} คัน{saved.engines.reused ? ` · ใช้เลขเดิม ${saved.engines.reused} คัน` : ''}</span> : null}
            <div>
              <button type="button" className="button" onClick={() => void savedCsv()} disabled={Boolean(busy)}>📄 CSV Draft ใบขน</button>
              <Link className="button primary" href="/pending?tab=fn">ไปส่งอนุมัติ Final Invoice →</Link>
              <button type="button" className="button" onClick={onReset}>ทำใบถัดไป</button>
            </div>
          </div>
        ) : (
          <>
            <small>{missing.length ? `ยังขาด: ${missing.join(' · ')}` : `พร้อมบันทึกเป็น Final Invoice ของงาน ${job?.jobNo}`}{auto.size ? ` · มีช่องที่ระบบเติมยังไม่ได้แก้ ${auto.size} ช่อง (ตรวจแล้วบันทึกได้เลย)` : ''}</small>
            <div className="cgi-save-actions">
              <button type="button" className="button" disabled={Boolean(busy) || reading || !cars.length} onClick={() => void fetchTariffs()}>
                {tariffs ? '↻ ดึงพิกัดใหม่' : 'ดึงพิกัด'}
              </button>
              <button type="button" className="button" disabled={Boolean(busy) || reading} onClick={() => void post('preview')}>👁 Preview FN Invoice</button>
              <button type="button" className="button" disabled={Boolean(busy) || reading} onClick={() => void post('csv')}>📄 CSV Draft ใบขน</button>
              <button type="button" className="button primary" disabled={Boolean(busy) || reading || missing.length > 0} onClick={() => void post('save')}>บันทึก Final Invoice</button>
            </div>
          </>
        )}
      </div>

      {csv ? (
        <CsvDrawer csv={csv} note={saved ? 'จาก Final Invoice ที่บันทึกแล้ว — เลขเครื่องจริง' : 'ยังไม่ได้บันทึก — เลขเครื่อง 0000000'}
          onClose={() => setCsv(null)} />
      ) : null}
    </div>
  );
}
