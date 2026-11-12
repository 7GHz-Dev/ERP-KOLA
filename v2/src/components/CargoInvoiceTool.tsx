'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useMemo, useRef, useState } from 'react';
import type { CargoCar, CargoInvoice } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import type { TariffResult, TariffRule } from '@/lib/cargo-invoice/tariff';
import { CargoReference } from './CargoReference';

/**
 * Create Cargo Invoice — อัปโหลด Invoice Excel → ระบบจัดเรียงให้ตรวจ → ดึงพิกัด (เพิ่มรุ่นใหม่ได้) → บันทึก Final Invoice
 *
 * ไฟล์อยู่ในเบราว์เซอร์ตลอด ส่งขึ้นเซิร์ฟเวอร์สองครั้ง: ตอนอ่าน (ไม่เก็บ) กับตอนบันทึก (เซิร์ฟเวอร์อ่านซ้ำแล้วตรวจพิกัดอีกรอบ)
 */

type Tariff = TariffResult & { similar: TariffRule[]; suggest: { ccMin: number; ccMax: number } | null };
type Saved = { jobId: string; jobNo: string; fileId: string; version: number; pdf: boolean };

const fmt = (n: number | null) => (n === null ? '-' : n.toLocaleString('en-US'));
const STEPS = ['อัปโหลด Invoice', 'ตรวจข้อมูล', 'ดึงพิกัด (Tariff)', 'บันทึก Final Invoice'];

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function CargoInvoiceTool() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inv, setInv] = useState<CargoInvoice | null>(null);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [jobId, setJobId] = useState('');
  const [matchedBy, setMatchedBy] = useState<'bl' | 'containers' | 'search'>('bl');
  const [jobQuery, setJobQuery] = useState('');
  const [tariffs, setTariffs] = useState<Tariff[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rulesVersion, setRulesVersion] = useState(0);

  const job = jobs.find((j) => j.id === jobId) ?? null;

  const reset = () => {
    setFile(null); setInv(null); setJobs([]); setJobId(''); setMatchedBy('bl'); setJobQuery(''); setTariffs(null); setChosen([]);
    setAdding(null); setSaved(null); setError('');
    if (input.current) input.current.value = '';
  };

  async function read(f: File) {
    reset();
    setFile(f);
    setBusy('กำลังอ่านไฟล์…');
    try {
      const fd = new FormData();
      fd.set('file', f);
      const data = await call<{ invoice: CargoInvoice; jobs: JobMatch[]; matchedBy: 'bl' | 'containers' }>('/api/cargo-invoice/parse', { method: 'POST', body: fd });
      setInv(data.invoice);
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

  async function fetchTariffs(cars = inv?.cars ?? []) {
    setBusy('กำลังดึงพิกัด…');
    setError('');
    try {
      const data = await call<{ results: Tariff[] }>('/api/cargo-invoice/tariff', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cars: cars.map(({ brand, model, fuel, cc, weight }) => ({ brand, model, fuel, cc, weight })) }),
      });
      setTariffs(data.results);
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
      setSaved(await call<Saved>('/api/cargo-invoice/save', { method: 'POST', body: fd }));
      router.refresh();
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
    const sum = (k: 'weight' | 'price') => inv.cars.reduce((s, c) => s + (c[k] ?? 0), 0);
    const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
    out.push(inv.stated.units === null
      ? { ok: true, text: `รถ ${inv.cars.length} คัน (ใบไม่ได้ระบุจำนวนคันรวม)` }
      : { ok: inv.stated.units === inv.cars.length, text: `รถ ${inv.cars.length} คัน · แถว TOTAL ${inv.stated.units} UNITS` });
    if (inv.stated.weight !== null) out.push({ ok: close(inv.stated.weight, sum('weight')), text: `น้ำหนักรวม ${fmt(sum('weight'))} KG · แถว TOTAL ${fmt(inv.stated.weight)}` });
    else out.push({ ok: true, text: `น้ำหนักรวม ${fmt(sum('weight'))} KG` });
    // ค่าใช้จ่ายอื่นที่บวกอยู่ในยอด TOTAL (เช่น Forwarding ของ JAN TRADING) — ราคารถ + ค่านี้ ต้องเท่ายอด TOTAL
    const extra = inv.charges.filter((c) => c.inTotal).reduce((s, c) => s + c.amount, 0);
    const priceText = `ราคารถรวม ${fmt(sum('price'))}${extra ? ` + ค่าใช้จ่ายอื่น ${fmt(extra)}` : ''}`;
    if (inv.stated.amount !== null) out.push({ ok: close(inv.stated.amount, sum('price') + extra), text: `${priceText} · แถว TOTAL ${fmt(inv.stated.amount)}` });
    else out.push({ ok: true, text: priceText });
    const bad = inv.cars.filter((c) => c.problems.length).length;
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
    return out;
  }, [inv, job]);

  const tariffSummary = tariffs ? {
    found: tariffs.filter((t) => t.status === 'found').length,
    pick: tariffs.filter((t, i) => t.status === 'ambiguous' && !chosen[i]).length,
    missing: tariffs.filter((t) => t.status === 'missing').length,
  } : null;
  const readyToSave = Boolean(inv && !inv.errors.length && job && tariffs && chosen.length === inv.cars.length
    && chosen.every(Boolean) && inv.cars.every((c) => !c.problems.length));
  const step = saved ? 4 : tariffs ? 3 : inv ? 2 : 1;

  // จัดกลุ่มรถตามตู้ตามลำดับที่ปรากฏในใบ
  const groups = useMemo(() => {
    if (!inv) return [];
    const order = [...inv.containers, ...inv.cars.map((c) => c.container).filter((c) => !inv.containers.includes(c))];
    return [...new Set(order)].map((box) => ({ box, cars: inv.cars.map((c, i) => ({ c, i })).filter(({ c }) => c.container === box) }));
  }, [inv]);

  return (
    <div className="cgi">
      <ol className="cgi-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}><b>{i + 1}</b>{s}</li>
        ))}
      </ol>

      {/* ---------- 1. อัปโหลด ---------- */}
      <section className="cgi-card">
        <div className="cgi-upload">
          <label className="cgi-drop">
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }}
            />
            <b>{file ? file.name : 'เลือกไฟล์ Invoice (.xlsx)'}</b>
            <small>{file ? `${(file.size / 1024).toFixed(0)} KB · กดเพื่อเลือกไฟล์ใหม่` : 'รองรับ MSFZ · AICHI (ตู้ละชีตก็ได้) · JAN TRADING (และ JTC · HUAYO) — ไฟล์ดิบจากผู้ขายหรือไฟล์ imp3_ ที่ผูกสูตรแล้วก็ได้'}</small>
          </label>
          {inv ? <button type="button" className="button" onClick={reset} disabled={Boolean(busy)}>เริ่มใหม่</button> : null}
        </div>
        {busy ? <p className="cgi-busy"><span className="ai-dot" />{busy}</p> : null}
        {error ? <p className="cgi-error">⚠️ {error}</p> : null}
      </section>

      {inv ? (
        <>
          {/* ---------- 2. หัวใบ + งาน + ตรวจ ---------- */}
          <section className="cgi-card">
            {inv.errors.length ? (
              <div className="cgi-error">{inv.errors.map((e) => <p key={e}>⚠️ {e}</p>)}</div>
            ) : null}
            <div className="cgi-head">
              <div><span>รูปแบบ</span><b><span className="badge neutral">{inv.pattern || '?'}</span></b><small>{inv.supplier}</small></div>
              <div><span>Invoice No.</span><b>{inv.invoiceNo || '-'}</b></div>
              <div><span>วันที่ Invoice</span><b>{inv.invoiceDate || '-'}</b></div>
              <div>
                <span>BL No.</span>
                {inv.blNo ? <b>{inv.blNo}</b> : <b className="cgi-warn">ใบไม่ได้กรอก</b>}
                {inv.blNo ? null : <small>{job?.blNo ? `ใช้ BL ของงาน: ${job.blNo}` : 'จะใช้ BL ของงานที่เลือก'}</small>}
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
                <span className="filter-label">ยอดอื่นในใบ (ไม่ใช่ราคารถ — ไม่เขียนลงตารางสรุป)</span>
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
              <h2>รายการรถ {inv.cars.length} คัน</h2>
              {tariffSummary ? (
                <span className="cgi-tsum">
                  <b className="ok">พบพิกัด {tariffSummary.found}</b>
                  {tariffSummary.pick ? <b className="warn">ต้องเลือก {tariffSummary.pick}</b> : null}
                  {tariffSummary.missing ? <b className="bad">ไม่พบ {tariffSummary.missing} — กด + เพิ่มพิกัด</b> : null}
                </span>
              ) : null}
              <button type="button" className="button primary" disabled={Boolean(busy) || !inv.cars.length} onClick={() => void fetchTariffs()}>
                {tariffs ? '↻ ดึงพิกัดใหม่' : '③ ดึงพิกัด (Tariff)'}
              </button>
            </div>

            <div className="table-wrap">
              <table className="data cgi-table">
                <thead>
                  <tr>
                    <th>#</th><th>ยี่ห้อ</th><th>รุ่น</th><th>เลขตัวถัง</th><th>เลขเครื่อง</th><th>เชื้อเพลิง</th>
                    <th className="num">CC</th><th className="num">ปี</th><th className="num">น้ำหนัก</th><th className="num">ราคา</th><th>พิกัด</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ box, cars }) => (
                    <Fragment key={box || 'none'}>
                      <tr className="cgi-box">
                        <td colSpan={11}>
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
                          multiSheet={inv.sheets.length > 1}
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
                <b>✓ บันทึก Final Invoice แล้ว — งาน <Link href={`/job/${saved.jobId}`}>{saved.jobNo}</Link> (v{saved.version})</b>
                <span>{saved.pdf ? 'แปลงเป็น PDF สำหรับชุด E-Office ให้แล้ว' : 'แปลง PDF ไม่สำเร็จ — ตอนรวมชุด E-Office ระบบจะลองใหม่'}</span>
                <div>
                  <Link className="button primary" href="/pending?tab=fn">ไปส่งอนุมัติ Final Invoice →</Link>
                  <button type="button" className="button" onClick={reset}>ทำใบถัดไป</button>
                </div>
              </div>
            ) : (
              <>
                <p>
                  {!job ? 'เลือกงานที่จะบันทึกก่อน'
                    : !tariffs ? 'กด "ดึงพิกัด" ก่อนบันทึก'
                      : !readyToSave ? 'ยังบันทึกไม่ได้ — ต้องมีพิกัดครบทุกคันและข้อมูลรถครบ'
                        : `พร้อมบันทึกเป็น Final Invoice ของงาน ${job.jobNo} · ระบบเขียนตารางสรุปและพิกัดลงไฟล์ให้ worker สร้าง Draft ใบขนใช้ต่อ`}
                </p>
                <button type="button" className="button primary" disabled={!readyToSave || Boolean(busy)} onClick={() => void save()}>
                  ④ บันทึก Final Invoice
                </button>
              </>
            )}
          </section>
        </>
      ) : null}

      {/* ---------- ข้อมูลอ้างอิง: Datatariff + เลขเครื่องที่ระบบออก ---------- */}
      <CargoReference version={rulesVersion} onChanged={() => { if (tariffs) void fetchTariffs(); }} />
    </div>
  );
}

function CarRow({
  car, multiSheet, tariff, code, onPick, adding, onAdd, onAdded,
}: {
  car: CargoCar; multiSheet: boolean; tariff: Tariff | null; code: string; onPick: (code: string) => void;
  adding: boolean; onAdd: () => void; onAdded: () => Promise<void>;
}) {
  const bad = car.problems.length > 0;
  return (
    <>
      <tr className={bad ? 'cgi-badrow' : undefined}>
        <td>{car.no}</td>
        <td>{car.brand}</td>
        <td>{car.model}</td>
        <td><b>{car.chassis || '-'}</b></td>
        <td>{car.engine || '-'}</td>
        <td>{car.fuel || '-'}</td>
        <td className="num">{fmt(car.cc)}</td>
        <td className="num">{car.year ?? '-'}</td>
        <td className="num">{fmt(car.weight)}</td>
        <td className="num">{fmt(car.price)}</td>
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
      </tr>
      {bad ? (
        <tr className="cgi-badrow"><td /><td colSpan={10}>⚠ {car.problems.join(' · ')} <small>({multiSheet ? `ชีต ${car.sheet} ` : ''}แถว {car.row} ในไฟล์)</small></td></tr>
      ) : null}
      {adding && tariff ? <tr><td /><td colSpan={10}><AddRule car={car} tariff={tariff} onAdded={onAdded} /></td></tr> : null}
    </>
  );
}

/** ฟอร์มเพิ่มกฎพิกัดของรถรุ่นใหม่ — ค่าตั้งต้นจากรถคันนี้ ช่วง CC ตามช่วงที่ตารางใช้บ่อย */
function AddRule({ car, tariff, onAdded }: { car: CargoCar; tariff: Tariff; onAdded: () => Promise<void> }) {
  const [v, setV] = useState({
    code: '', brand: car.brand, model: car.model, fuel: car.fuel,
    ccMin: String(tariff.suggest?.ccMin ?? car.cc ?? 0), ccMax: String(tariff.suggest?.ccMax ?? car.cc ?? 99999),
    wMin: '0', wMax: '99999',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await call('/api/cargo-invoice/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cgi-add">
      <p>เพิ่มพิกัดให้รถรุ่นนี้ — บันทึกแล้วใช้ได้ทันทีทั้งระบบ คันอื่นรุ่นเดียวกันในช่วง CC / น้ำหนักนี้จะหาเจอเอง</p>
      <div className="cgi-add-grid">
        <label>พิกัด (8 หลัก)<input value={v.code} onChange={set('code')} placeholder="เช่น 87032290" inputMode="numeric" autoFocus /></label>
        <label>ยี่ห้อ<input value={v.brand} onChange={set('brand')} /></label>
        <label>รุ่น<input value={v.model} onChange={set('model')} /></label>
        <label>เชื้อเพลิง<input value={v.fuel} onChange={set('fuel')} /></label>
        <label>CC ตั้งแต่<input value={v.ccMin} onChange={set('ccMin')} inputMode="numeric" /></label>
        <label>CC ถึง<input value={v.ccMax} onChange={set('ccMax')} inputMode="numeric" /></label>
        <label>น้ำหนัก (KG) ตั้งแต่<input value={v.wMin} onChange={set('wMin')} inputMode="numeric" /></label>
        <label>น้ำหนัก (KG) ถึง<input value={v.wMax} onChange={set('wMax')} inputMode="numeric" /></label>
      </div>
      {tariff.similar.length ? (
        <div className="cgi-similar">
          <span>รุ่นเดียวกันในตาราง (คนละเชื้อเพลิงหรือช่วง CC) — กดเพื่อใช้พิกัดเดียวกัน:</span>
          {tariff.similar.map((r) => (
            <button key={r.id} type="button" className="chip-toggle small" onClick={() => setV({ ...v, code: r.code })}>
              {r.code} · {r.fuel} · CC {r.ccMin}-{r.ccMax}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <p className="cgi-error">⚠️ {err}</p> : null}
      <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังบันทึก…' : 'บันทึกพิกัด'}</button>
    </div>
  );
}
