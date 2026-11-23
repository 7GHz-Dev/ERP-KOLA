'use client';

import { useEffect, useRef, useState } from 'react';
import type { CargoInvoice } from '@/lib/cargo-invoice/parse';
import type { JobMatch } from '@/lib/cargo-invoice/jobs';
import type { FnDraftInfo } from '@/lib/cargo-invoice/fn-draft';
import { CargoReference } from './CargoReference';
import { call } from './CargoShared';
import { CargoInvoiceNormal, type ShipperChoice } from './CargoInvoiceNormal';
import { CargoInvoiceLaidOut, type InvoiceSuggest } from './CargoInvoiceLaidOut';
import { ZoomImage } from './ZoomImage';

/**
 * Create Cargo Invoice / Create FN Invoice — อ่านไฟล์แล้วส่งต่อให้ฟอร์มตามรูปแบบ
 *
 *   JAN TRADING · AICHI (Excel)   ระบบอ่านไฟล์และจัดหน้า Final Invoice ให้ → CargoInvoiceLaidOut
 *   ผู้ขายรายอื่น (Excel · PDF · รูป) คีย์/ตรวจข้างไฟล์ ระบบอ่านหรือ AI อ่านแล้วเติมให้ → CargoInvoiceNormal
 * สองแบบหน้าตาเดียวกัน (เอกสารซ้าย/บน · ข้อมูลขวา/ล่าง · แถบปุ่มติดล่าง) ต่างกันที่ที่มาของค่า
 *
 * ไฟล์อยู่ในเบราว์เซอร์ตลอด ส่งขึ้นเซิร์ฟเวอร์ตอนอ่าน · Preview · บันทึก (ไม่เก็บจนกว่าจะบันทึก)
 */

/** ขั้นตอนหลัก (ทีมขอ) — หน้าที่อัปไฟล์เองมีขั้น "อัปโหลด Invoice" นำหน้า · JAN / AICHI ออกเลขเครื่องตอนบันทึก จึงข้ามขั้นสุ่ม Engine */
const STEPS = ['ตรวจข้อมูล', 'สุ่มEngine', 'ดึงพิกัด (Tariff)', 'บันทึก Final Invoice'];
/** รูปแบบที่ระบบอ่านไฟล์แล้วจัดหน้า Final Invoice ให้เอง — ที่เหลือเป็น NORMAL (คีย์เองข้างไฟล์) */
const LAID_OUT = ['JAN TRADING', 'AICHI'];
type NormalPrefill = React.ComponentProps<typeof CargoInvoiceNormal>['prefill'];
type LaidOut = { inv: CargoInvoice; suggest: InvoiceSuggest | null; jobs: JobMatch[]; jobId: string; matchedBy: 'bl' | 'containers' | 'search' };

/**
 * presetJob — เปิดจาก Pending jobs > 2. Final Invoice > Create FN Invoice (popup ของงานนั้น)
 * ใช้งานนี้เสมอ ไม่ต้องหางานจาก BL / เลขตู้ · บันทึกแล้วเป็น FINAL_INVOICE ของงานนี้
 */
export function CargoInvoiceTool({ shippers, presetJob, presetFile }: {
  shippers: ShipperChoice[]; presetJob?: JobMatch | null;
  /** Invoice สินค้า (INVOICE_GOODS) ของงาน — popup Create FN Invoice ใช้ไฟล์นี้เลย ข้ามขั้นอัปโหลด */
  presetFile?: { id: string; fileName: string } | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  /** JAN TRADING / AICHI — ผลการอ่านไฟล์ */
  const [laidOut, setLaidOut] = useState<LaidOut | null>(null);
  /** NORMAL — ผู้ขายรายอื่น: ฟอร์มคีย์เองข้างไฟล์ (รูป · PDF · Excel) */
  const [normal, setNormal] = useState<NormalPrefill | null>(null);
  /** ขั้นของแถบขั้นตอนที่ฟอร์มรายงานมา */
  const [formStep, setFormStep] = useState<1 | 2 | 3 | 4>(1);
  const [rulesVersion, setRulesVersion] = useState(0);

  const reset = () => {
    setFile(null); setLaidOut(null); setNormal(null); setError(''); setFormStep(1);
    if (input.current) input.current.value = '';
  };

  async function read(f: File) {
    reset();
    setFile(f);
    /*
     * งานนี้มี Draft FN Invoice ที่บันทึกไว้ — กรอกจาก Draft เลย ไม่ต้องอ่านไฟล์ / ให้ AI อ่านใหม่
     * (Draft มีแต่แบบ NORMAL · โหลดไม่ได้ก็อ่านไฟล์ตามปกติ)
     */
    if (presetJob) {
      const saved = await call<{ draft: FnDraftInfo | null }>(`/api/cargo-invoice/draft?jobId=${encodeURIComponent(presetJob.id)}`, { method: 'GET' })
        .catch(() => ({ draft: null }));
      if (saved.draft) {
        setNormal({ cars: [], invoiceNo: '', invoiceDate: '', supplier: '', jobs: [presetJob], note: '', draft: saved.draft });
        return;
      }
    }
    // รูป / PDF — ไปฟอร์ม NORMAL เลย (ฟอร์มให้ AI อ่านแล้วเติมให้)
    if (!/\.xlsx$/i.test(f.name)) {
      setNormal({ cars: [], invoiceNo: '', invoiceDate: '', supplier: '', jobs: presetJob ? [presetJob] : [], note: '' });
      return;
    }
    setBusy('กำลังอ่านไฟล์…');
    try {
      const fd = new FormData();
      fd.set('file', f);
      const data = await call<{ invoice: CargoInvoice; jobs: JobMatch[]; matchedBy: 'bl' | 'containers'; invoiceSuggest: InvoiceSuggest | null }>('/api/cargo-invoice/parse', { method: 'POST', body: fd });
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
      if (presetJob) {
        setLaidOut({ inv: data.invoice, suggest: data.invoiceSuggest, jobs: [presetJob], jobId: presetJob.id, matchedBy: 'bl' });
        return;
      }
      // หาด้วยเลขตู้แล้วเจอหลายงาน: เลือกให้เฉพาะเมื่องานแรกตู้ตรงครบทุกตู้และมากกว่างานอื่น
      const [top, second] = data.jobs;
      const sure = data.jobs.length === 1 || (data.matchedBy === 'containers' && top
        && top.sharedBoxes === data.invoice.containers.length && (second?.sharedBoxes ?? 0) < (top.sharedBoxes ?? 0));
      setLaidOut({ inv: data.invoice, suggest: data.invoiceSuggest, jobs: data.jobs, jobId: sure ? top.id : '', matchedBy: data.matchedBy });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  // popup Create FN Invoice: โหลด Invoice สินค้าของงานแล้วอ่านเลย
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

  // ขั้นหลัก 1–4 (0 = ยังไม่มีไฟล์) — ฟอร์มบอกขั้นมาเอง
  const core = normal || laidOut ? formStep : 0;
  // ใช้ Invoice สินค้าของงาน: ไม่มีขั้นอัปโหลด ขั้นเริ่มที่ "ตรวจข้อมูล"
  const steps = presetFile ? STEPS : ['อัปโหลด Invoice', ...STEPS];
  const stepNow = presetFile ? Math.max(1, core) : core + 1;
  const formKey = file ? `${file.name}-${file.lastModified}` : '';

  const tool = (
    <div className="cgi">
      <ol className="cgi-steps">
        {steps.map((s, i) => (
          <li key={s} className={i + 1 < stepNow ? 'done' : i + 1 === stepNow ? 'now' : ''}><b>{i + 1}</b>{s}</li>
        ))}
      </ol>

      {/* ---------- อัปโหลด (popup Create FN Invoice ใช้ Invoice สินค้าของงานแทน) ---------- */}
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
        </div>
        {busy ? <p className="cgi-busy"><span className="ai-dot" />{busy}</p> : null}
        {error ? <p className="cgi-error">⚠️ {error}</p> : null}
      </section>

      {normal && file ? (
        <CargoInvoiceNormal key={formKey} file={file} shippers={shippers} prefill={normal} onReset={reset}
          side={Boolean(presetFile)} onStep={setFormStep} />
      ) : null}
      {laidOut && file ? (
        <CargoInvoiceLaidOut key={formKey} file={file} inv={laidOut.inv} suggest={laidOut.suggest}
          initialJobs={laidOut.jobs} initialJobId={laidOut.jobId} initialMatchedBy={laidOut.matchedBy}
          onReset={reset} side={Boolean(presetFile)} onStep={setFormStep}
          rulesVersion={rulesVersion} onRulesChanged={() => setRulesVersion((n) => n + 1)} />
      ) : null}

      {/* ---------- ข้อมูลอ้างอิง: Datatariff + เลขเครื่องที่ระบบออก ---------- */}
      <CargoReference version={rulesVersion} onChanged={() => setRulesVersion((n) => n + 1)} />
    </div>
  );

  // ฟอร์มจัดเอกสารซ้าย / ข้อมูลขวาเอง (แท็บ OG Invoice · FN Invoice · ดูคู่กัน)
  if (!presetFile || normal || laidOut) return tool;

  // popup ระหว่างโหลด / อ่านไฟล์ไม่ได้ — ไฟล์ซ้าย ข้อความขวา
  return (
    <div className="fn-split">
      <div className="fn-split-view">
        <OgPreview presetFile={presetFile} file={file} />
      </div>
      <div className="fn-split-form">{tool}</div>
    </div>
  );
}

/** OG Invoice ก่อนฟอร์มพร้อม — PDF / รูป เปิดตรง · Excel แปลงเป็น PDF (ห้ามส่ง xlsx ให้ <object> ตรง ๆ เบราว์เซอร์จะดาวน์โหลดแทน) */
function OgPreview({ presetFile, file }: { presetFile: { id: string; fileName: string }; file: File | null }) {
  const [og, setOg] = useState<{ url: string; note: string; img?: boolean }>({ url: '', note: '' });
  useEffect(() => {
    const name = presetFile.fileName;
    if (/\.(pdf|png|jpe?g|gif|webp)$/i.test(name)) { setOg({ url: `/files/${presetFile.id}`, note: '', img: !/\.pdf$/i.test(name) }); return; }
    if (!/\.xlsx$/i.test(name)) { setOg({ url: '', note: 'ไฟล์ชนิดนี้แสดงในหน้าไม่ได้' }); return; }
    if (!file) { setOg({ url: '', note: 'กำลังโหลด OG Invoice…' }); return; }
    let url = '';
    let gone = false;
    setOg({ url: '', note: 'กำลังแปลง Excel เป็น PDF…' });
    const fd = new FormData();
    fd.set('file', file);
    void fetch('/api/cargo-invoice/file-preview', { method: 'POST', body: fd }).then(async (res) => {
      if (gone) return;
      if (!res.ok) { setOg({ url: '', note: (await res.json().catch(() => ({}))).error ?? 'แปลงไฟล์ไม่ได้' }); return; }
      url = URL.createObjectURL(await res.blob());
      setOg({ url, note: '' });
    }).catch(() => { if (!gone) setOg({ url: '', note: 'แปลงไฟล์ไม่ได้' }); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [presetFile.id, presetFile.fileName, file]);

  if (og.url && og.img) return <ZoomImage className="fn-split-file" src={og.url} alt={presetFile.fileName} />;
  if (og.url) {
    return (
      <object className="fn-split-file" data={og.url} type="application/pdf">
        <p className="drawer-note warn">เบราว์เซอร์นี้แสดงไฟล์ในหน้าไม่ได้ · <a href={og.url} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a></p>
      </object>
    );
  }
  return <div className="fn-split-file fn-split-empty"><p className="batch-note">{og.note || 'กำลังโหลด…'}</p></div>;
}
