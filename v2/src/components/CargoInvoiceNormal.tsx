'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { CargoCar } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import type { DraftCsv } from '@/lib/cargo-invoice/draft-csv';
import { cleanEdit, fieldProblems } from '@/lib/cargo-invoice/edit';
import { enginePrefix, existingEngineNumber } from '@/lib/cargo-invoice/engine-format';
import { SearchSelect } from '@/components/SearchSelect';
import { QuickAddMaster } from '@/components/QuickAddMaster';
import { CsvDrawer, PdfDrawer } from './CargoDocDrawers';
import { AddRule, call, type Tariff } from './CargoShared';

/**
 * Create Cargo Invoice แบบ NORMAL — ผู้ขายที่ไม่ใช่ JAN TRADING / AICHI
 *
 * หน้าตาแบบแผงแก้ข้อมูล BL (1. ใส่ข้อมูล BL > แก้ไข): ฟอร์มอยู่ซ้าย ไฟล์ของผู้ขายอยู่ขวา (รูป · PDF · Excel แปลงเป็น PDF)
 * คนคีย์ Shipper · Invoice Date / No. · Currency (ใช้ทั้งชุด) และรถทีละคัน
 * ข้อมูลเรือ (VESSEL … CARRIER) BL และตู้ มาจากงานในตารางหลัก — แก้ที่งาน ไม่แก้ที่นี่
 * ไฟล์ Excel ที่ระบบอ่านได้ (MSFZ · JTC · HUAYO) เติมรายการรถให้ก่อน
 */

export type ShipperChoice = { id: string; code: string | null; name: string; address: string | null };
type FormCar = {
  brand: string; model: string; chassis: string; weight: string; year: string; engine: string;
  cc: string; fuel: string; amount: string; container: string;
};
type Saved = { jobId: string; jobNo: string; version: number; pdf: boolean; invoiceNo: string; engines: { issued: number; reused: number } | null };

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
/** ค่าที่ระบบใช้จริงของรถคันหนึ่ง (ตัวพิมพ์ใหญ่ · ตัวเลข) — แบบเดียวกับที่เซิร์ฟเวอร์ทำ */
const valueOf = (c: FormCar) => ({
  brand: String(cleanEdit('brand', c.brand) ?? ''), model: String(cleanEdit('model', c.model) ?? ''),
  chassis: String(cleanEdit('chassis', c.chassis) ?? ''), engine: String(cleanEdit('engine', c.engine) ?? ''),
  fuel: String(cleanEdit('fuel', c.fuel) ?? ''), cc: cleanEdit('cc', c.cc) as number | null,
  year: cleanEdit('year', c.year) as number | null, weight: cleanEdit('weight', c.weight) as number | null,
  price: cleanEdit('price', c.amount) as number | null,
});

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
  const [shipperId, setShipperId] = useState(() =>
    allShippers.find((s) => prefill.supplier && norm(s.name) === norm(prefill.supplier))?.id ?? '');
  const [currency, setCurrency] = useState('USD');
  const [invoiceDate, setInvoiceDate] = useState(dmyToYmd(prefill.invoiceDate) || today());
  const [invoiceNo, setInvoiceNo] = useState(prefill.invoiceNo);
  const [cars, setCars] = useState<FormCar[]>(() => (prefill.cars.length ? prefill.cars.map((c) => ({
    brand: c.brand, model: c.model, chassis: c.chassis, weight: c.weight === null ? '' : String(c.weight),
    year: c.year === null ? '' : String(c.year), engine: c.engine, cc: c.cc === null ? '' : String(c.cc), fuel: c.fuel || 'GASOLINE',
    amount: c.price === null ? '' : String(c.price), container: c.container,
  })) : [blank()]));
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null);
  const [tariffFor, setTariffFor] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [csv, setCsv] = useState<DraftCsv | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  /* ---------- ไฟล์ผู้ขายฝั่งขวา: รูป / PDF เปิดตรง · Excel แปลงเป็น PDF ที่เซิร์ฟเวอร์ ---------- */
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

  const setCar = (i: number, patch: Partial<FormCar>) => setCars((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const payload = (mode: string) => JSON.stringify({
    mode, jobId, shipperId, currency, invoiceDate, invoiceNo, cars, tariffs: chosen,
  });

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
    try {
      const res = await fetch('/api/cargo-invoice/normal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload(mode) });
      const isPdf = res.headers.get('content-type')?.includes('pdf');
      if (!res.ok || !isPdf && mode === 'preview') {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (mode === 'preview') {
        const url = URL.createObjectURL(await res.blob());
        setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
        return;
      }
      const body = await res.json();
      if (body.error) throw new Error(body.error);
      if (mode === 'csv') setCsv(body as DraftCsv);
      else { setSaved(body as Saved); router.refresh(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  async function savedCsv() {
    if (!saved) return;
    setBusy('กำลังสร้าง CSV…');
    try { setCsv(await call<DraftCsv>(`/api/cargo-invoice/csv?jobId=${encodeURIComponent(saved.jobId)}`, { method: 'GET' })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  const locked = Boolean(saved) || Boolean(busy);
  const info: Array<[string, string]> = job ? [
    ['VESSEL', job.ship.vessel], ['VOYAGE', job.ship.voyage], ['PORT OF LOADING', job.ship.portOfLoading],
    ['PORT OF DESTINATION', job.ship.portOfDestination], ['DATE OF SHIP (ETD)', job.ship.etd], ['BL', job.blNo ?? ''],
    ['CARRIER', job.ship.carrier],
  ] : [];

  return (
    <div className="cgi-normal">
      <div className="cgi-normal-form">
        <div className="cgi-normal-head">
          <span className="badge neutral">NORMAL</span>
          <b>{file.name}</b>
          <button type="button" className="button tiny" onClick={onReset} disabled={Boolean(busy)}>เริ่มใหม่</button>
        </div>
        {prefill.note ? <p className="batch-note">{prefill.note}</p> : null}

        {/* ---------- งาน: ข้อมูลเรือมาจาก AN/BL ในตารางหลัก ---------- */}
        <section className="cgi-normal-sec">
          <div className="section-title">งาน (ข้อมูลเรือจาก AN/BL ในตารางหลัก)</div>
          <div className="cgi-normal-job">
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
          {job ? (
            <dl className="cgi-normal-info">
              {info.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd className={v ? '' : 'cgi-warn'}>{v || 'ยังไม่มีในงาน'}</dd></div>
              ))}
              <div><dt>ตู้</dt><dd className={job.containers.length ? '' : 'cgi-warn'}>{job.containers.join(', ') || 'ยังไม่มีในงาน'}</dd></div>
            </dl>
          ) : <p className="batch-note">เลือกงานก่อน — VESSEL · VOYAGE · PORT · DATE OF SHIP · BL · CARRIER และตู้ ใช้ของงาน</p>}
        </section>

        {/* ---------- Shipper + ค่าทั้งชุด ---------- */}
        <section className="cgi-normal-sec">
          <div className="section-title">Shipper และ Invoice (ใช้ทั้งชุด)</div>
          <div className="extract-grid">
            <div className="extract-field wide">
              <div className="extract-label">SHIPPER</div>
              <div className="extract-control bl-edit-shipper">
                <SearchSelect choices={allShippers} value={shipperId} placeholder="พิมพ์ค้นหา Shipper" onChange={setShipperId} />
                <QuickAddMaster type="shippers" onAdded={(s) => { setAdded((list) => [...list, { ...s, address: null }]); setShipperId(s.id); }} />
              </div>
              {shipper ? (
                shipper.address
                  ? <pre className="cgi-normal-addr">{shipper.address}</pre>
                  : <small className="cgi-warn">Shipper นี้ยังไม่มีที่อยู่ — ตั้งที่ Master Data &gt; Shipper (ผู้ดูแลระบบ) หัวใบจะมีแต่ชื่อ</small>
              ) : null}
            </div>
            <div className="extract-field">
              <div className="extract-label">CURRENCY</div>
              <div className="extract-control">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="extract-field">
              <div className="extract-label">INVOICE DATE</div>
              <div className="extract-control"><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={locked} /></div>
            </div>
            <div className="extract-field wide">
              <div className="extract-label">INVOICE NO.</div>
              <div className="extract-control"><input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value.toUpperCase())} disabled={locked} /></div>
            </div>
          </div>
        </section>

        {/* ---------- รถทีละคัน ---------- */}
        <section className="cgi-normal-sec">
          <div className="section-title">
            รายการรถ {cars.length} คัน · น้ำหนักรวม {fmt(sum('weight'))} KG · ยอดรวม {fmt(sum('price'))} {currency}
          </div>
          {cars.map((c, i) => {
            const t = tariffs && !tariffStale ? tariffs[i] : null;
            const v = values[i];
            const field = (k: keyof FormCar, label: string, opts: { num?: boolean } = {}) => (
              <div className="extract-field">
                <div className="extract-label">{label}</div>
                <div className="extract-control">
                  <input value={c[k]} inputMode={opts.num ? 'decimal' : undefined} disabled={locked}
                    onChange={(e) => setCar(i, { [k]: opts.num ? e.target.value : e.target.value.toUpperCase() })} />
                </div>
              </div>
            );
            return (
              <div key={i} className={`cgi-normal-car${problems[i].length ? ' bad' : ''}`}>
                <div className="cgi-normal-car-head">
                  <b>คันที่ {i + 1}</b>
                  {v.engine ? <small>ENGINE NO. ในใบ: <b>{enginePrefix(v.engine)}-{existingEngineNumber(v.engine) ?? 'xxxxxxx'}</b></small> : null}
                  {!locked ? (
                    <span>
                      <button type="button" className="button tiny" title="เพิ่มคันใหม่ค่าเหมือนคันนี้"
                        onClick={() => setCars((prev) => [...prev.slice(0, i + 1), { ...c, chassis: '' }, ...prev.slice(i + 1)])}>⧉ คัดลอก</button>
                      {cars.length > 1 ? (
                        <button type="button" className="icon-button" title="ลบคันนี้" onClick={() => setCars((prev) => prev.filter((_, k) => k !== i))}>×</button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                <div className="extract-grid">
                  {field('brand', 'BRAND')}
                  {field('model', 'MODEL')}
                  {field('chassis', 'CHASSIS NO.')}
                  {field('engine', 'ENGINE NO.')}
                  {field('weight', 'WEIGHT (KG)', { num: true })}
                  {field('year', 'YEAR', { num: true })}
                  {field('cc', 'CC', { num: true })}
                  <div className="extract-field">
                    <div className="extract-label">FUEL</div>
                    <div className="extract-control">
                      <select value={c.fuel} onChange={(e) => setCar(i, { fuel: e.target.value })} disabled={locked}>
                        {[...new Set([...FUELS, c.fuel].filter(Boolean))].map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  {field('amount', `AMOUNT (${currency})`, { num: true })}
                  <div className="extract-field">
                    <div className="extract-label">CONTAINER</div>
                    <div className="extract-control">
                      {job?.containers.length ? (
                        <select value={c.container} onChange={(e) => setCar(i, { container: e.target.value })} disabled={locked}>
                          <option value="">— เลือกตู้ —</option>
                          {job.containers.map((b) => <option key={b}>{b}</option>)}
                        </select>
                      ) : (
                        <input value={c.container} onChange={(e) => setCar(i, { container: e.target.value.toUpperCase() })} disabled={locked} placeholder="เลขตู้" />
                      )}
                    </div>
                  </div>
                  <div className="extract-field wide">
                    <div className="extract-label">พิกัด</div>
                    <div className="extract-control cgi-tariff">
                      {!t ? <span className="muted">{tariffStale ? 'ข้อมูลเปลี่ยน — ดึงพิกัดใหม่' : 'กด "ดึงพิกัด"'}</span>
                        : t.status === 'found' ? <span className="badge approved">{t.code}</span>
                          : t.status === 'ambiguous' ? (
                            <select className={chosen[i] ? '' : 'pick'} value={chosen[i] ?? ''} disabled={locked}
                              onChange={(e) => setChosen((prev) => prev.map((p, k) => (k === i ? e.target.value : p)))}>
                              <option value="">เลือกพิกัด ({t.candidates.length})</option>
                              {t.candidates.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.rules.join(', ')}</option>)}
                            </select>
                          ) : <button type="button" className="button tiny danger" onClick={() => setAdding(adding === i ? null : i)}>{adding === i ? 'ปิด' : '+ เพิ่มพิกัด'}</button>}
                    </div>
                  </div>
                </div>
                {adding === i && t ? (
                  <AddRule car={{ brand: v.brand, model: v.model, fuel: v.fuel, cc: v.cc }} tariff={t}
                    onAdded={async () => { setAdding(null); await fetchTariffs(); }} />
                ) : null}
                {problems[i].length ? <p className="cgi-bad">⚠ {problems[i].join(' · ')}</p> : null}
              </div>
            );
          })}
          {!locked ? (
            <button type="button" className="button tiny"
              onClick={() => setCars((prev) => [...prev, blank(job?.containers.length === 1 ? job.containers[0] : '')])}>+ เพิ่มคัน</button>
          ) : null}
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
              <small>{missing.length ? `ยังขาด: ${missing.join(' · ')}` : `พร้อมบันทึกเป็น Final Invoice ของงาน ${job?.jobNo}`}</small>
              <div className="cgi-save-actions">
                <button type="button" className="button" disabled={Boolean(busy) || !cars.length} onClick={() => void fetchTariffs()}>
                  {tariffs ? '↻ ดึงพิกัดใหม่' : 'ดึงพิกัด'}
                </button>
                <button type="button" className="button" disabled={Boolean(busy) || !job} onClick={() => void post('preview')}>👁 Preview FN Invoice</button>
                <button type="button" className="button" disabled={Boolean(busy) || !job} onClick={() => void post('csv')}>📄 CSV Draft ใบขน</button>
                <button type="button" className="button primary" disabled={Boolean(busy) || missing.length > 0} onClick={() => void post('save')}>บันทึก Final Invoice</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="cgi-normal-view">
        {fileView?.kind === 'img' ? <img className="bl-edit-file" src={fileView.url} alt={file.name} />
          : fileView ? <object className="bl-edit-file" data={fileView.url} type="application/pdf"><p>{file.name}</p></object>
            : <p className="batch-note">{fileNote}</p>}
      </div>

      {preview ? (
        <PdfDrawer url={preview} title={`Preview FN Invoice${invoiceNo ? ` · ${invoiceNo}` : ''}`}
          note="ยังไม่ได้บันทึก · เลขเครื่องออกจริงตอนบันทึก (แสดงเป็น xxxxxxx)"
          onClose={() => setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; })} />
      ) : null}
      {csv ? (
        <CsvDrawer csv={csv} note={saved ? 'จาก Final Invoice ที่บันทึกแล้ว — เลขเครื่องจริง' : 'ยังไม่ได้บันทึก — เลขเครื่อง 0000000'}
          onClose={() => setCsv(null)} />
      ) : null}
    </div>
  );
}
