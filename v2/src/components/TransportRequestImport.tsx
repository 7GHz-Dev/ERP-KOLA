'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { previewTransport, pushTransport, readTransportImages } from '@/lib/actions/transport-request';
import { keyOf, parsePastedSheet, type TrPreviewRow, type TrRow } from '@/lib/transport-request/parse';

/**
 * MAY — ส่ง Transport Request เข้าตารางขนส่ง / แพลนงานของ ERP SHIPME (เมนูชั่วคราว)
 *
 * ขั้นตอน: รูปหรือข้อความ → แถว (แก้ได้) → "ตรวจกับ SHIPME" (จับคู่งาน KOLA + สถานะใหม่/อัปเดตใน SHIPME) → "ส่งให้ SHIPME"
 * แก้แถวหลังตรวจแล้ว ต้องกดตรวจใหม่ก่อนจึงส่งได้ — สิ่งที่ส่งต้องเป็นสิ่งที่เพิ่งเห็นในตัวอย่าง
 * วันที่ของงาน = TRANSPORT (วันลากตู้) ไม่ใช่ ETA
 */
type ShipmeLine = { line: number; status: 'new' | 'update' | 'error'; error: string; warning: string; shipping: string };
type Checked = {
  merged: Map<number, TrPreviewRow>;
  shipme: Map<number, ShipmeLine> | null;
  summary: { total: number; new: number; update: number; error: number; noShipping: number } | null;
  shipmeError: string;
  committed: boolean;
};
type Img = { key: string; file: File; url: string };

const SOURCES = ['MAESOT FREEZONE', 'TRANSIT'];
const STATUS: Record<ShipmeLine['status'], [string, string]> = {
  new: ['ใหม่', 'approved'], update: ['อัปเดต', 'pending'], error: ['ผิดพลาด', 'rejected'],
};
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const renumber = (rows: TrRow[]) => rows.map((r, i) => ({ ...r, line: i + 1 }));

export function TransportRequestImport({ shipmeReady, aiReady }: { shipmeReady: boolean; aiReady: boolean }) {
  const [source, setSource] = useState(SOURCES[0]);
  const [mode, setMode] = useState<'image' | 'paste'>(aiReady ? 'image' : 'paste');
  const [images, setImages] = useState<Img[]>([]);
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<TrRow[]>([]);
  /** คำเตือนจากการตรวจครั้งแรกหลังอ่าน (เช่น เลขตู้ในรูปไม่ตรง KOLA) — ตรวจซ้ำหลังแทนค่าด้วยของ KOLA แล้วคำเตือนนี้จะหาย จึงเก็บไว้ */
  const [readNotes, setReadNotes] = useState<Record<number, string[]>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState<'' | 'read' | 'check' | 'push'>('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  /** วันที่ TRANSPORT ที่จะตั้งให้หลายแถวทีเดียว */
  const [bulkDate, setBulkDate] = useState('');
  const confirmDialog = useRef<HTMLDialogElement>(null);

  // วางรูปด้วย Ctrl+V ได้ทั้งหน้า (ภาพหน้าจอจากชีตมักอยู่ในคลิปบอร์ด)
  useEffect(() => {
    if (mode !== 'image') return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); addImages(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addImages(files: File[]) {
    setImages((cur) => [...cur, ...files.filter((f) => f.type.startsWith('image/'))
      .map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) }))].slice(0, 5));
  }

  function load(next: TrRow[]) {
    setRows(renumber(next));
    setReadNotes({});
    setChecked(null);
    setMessage(next.length ? null : { tone: 'warn', text: 'ไม่พบแถวที่มีเลข BL' });
  }

  async function readImages() {
    if (!images.length) return;
    setBusy('read'); setMessage(null);
    const fd = new FormData();
    images.forEach((i) => fd.append('images', i.file));
    const res = await readTransportImages(fd).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'warn', text: res.detail }); return; }
    load(res.rows);
    setMessage({ tone: 'ok', text: `อ่านได้ ${res.rows.length} แถว · ค่า AI ประมาณ ฿${res.baht.toFixed(2)} — ตรวจค่าในตาราง แล้วกด "ตรวจกับ SHIPME"` });
  }

  function readPaste() {
    const parsed = parsePastedSheet(paste);
    load(parsed);
    if (parsed.length) setMessage({ tone: 'ok', text: `อ่านได้ ${parsed.length} แถว — ตรวจค่าในตาราง แล้วกด "ตรวจกับ SHIPME"` });
  }

  function edit(line: number, patch: Partial<TrRow>) {
    setRows((cur) => cur.map((r) => (r.line === line ? { ...r, ...patch } : r)));
    setChecked(null);
  }
  /** ตั้งวันที่ TRANSPORT ทีเดียว — ทุกแถว หรือเฉพาะแถวที่ยังไม่มีวันที่ · แก้แล้วต้องตรวจกับ SHIPME ใหม่ */
  function setAllDates(onlyEmpty: boolean) {
    if (!bulkDate) return;
    const n = rows.filter((r) => !onlyEmpty || !r.transportDate).length;
    setRows((cur) => cur.map((r) => (!onlyEmpty || !r.transportDate ? { ...r, transportDate: bulkDate } : r)));
    setChecked(null);
    setMessage({ tone: 'ok', text: `ตั้งวันที่ TRANSPORT ${dmy(bulkDate)} ให้ ${n} แถวแล้ว — กด "ตรวจกับ SHIPME" ใหม่ก่อนส่ง` });
  }
  function remove(line: number) {
    setRows((cur) => renumber(cur.filter((r) => r.line !== line)));
    setReadNotes((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => Number(k) < line)
      .concat(Object.entries(cur).filter(([k]) => Number(k) > line).map(([k, v]) => [String(Number(k) - 1), v]))));
    setChecked(null);
  }

  async function run(commit: boolean) {
    confirmDialog.current?.close();
    setBusy(commit ? 'push' : 'check'); setMessage(null);
    const res = await (commit ? pushTransport : previewTransport)(rows, source)
      .catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    setBusy('');
    if (!res.ok) { setMessage({ tone: 'warn', text: res.detail }); return; }
    const merged = new Map(res.rows.map((r) => [r.line, r]));
    // แถวที่จับคู่งาน KOLA ได้ แทนค่าด้วย BL / ตู้จาก KOLA ให้เห็นตรงกับที่ส่งจริง
    setRows(res.rows.map(({ jobId: _j, jobNo: _n, doExchanged: _d, warnings: _w, error: _e, ...r }) => r));
    setReadNotes((cur) => {
      const next = { ...cur };
      for (const r of res.rows) {
        const keep = r.warnings.filter((w) => w.startsWith('เลขตู้ในรูปไม่ตรง'));
        if (keep.length) next[r.line] = [...new Set([...(next[r.line] ?? []), ...keep])];
      }
      return next;
    });
    const shipme = res.shipme ? new Map(res.shipme.preview.map((p) => [p.line, p])) : null;
    setChecked({ merged, shipme, summary: res.shipme?.summary ?? null, shipmeError: res.shipmeError ?? '', committed: Boolean(res.shipme?.committed) });
    if (res.shipme?.committed) {
      const s = res.shipme.summary;
      setMessage({ tone: 'ok', text: `ส่งให้ SHIPME แล้ว · ใหม่ ${s.new} · อัปเดต ${s.update}${s.error ? ` · ผิดพลาด ${s.error} (ไม่ได้ส่ง)` : ''}` });
    } else if (res.shipmeError) setMessage({ tone: 'warn', text: res.shipmeError });
  }

  const totals = useMemo(() => ({
    bl: rows.length, boxes: rows.reduce((n, r) => n + (r.containers.length || r.quantity), 0),
  }), [rows]);
  const sendable = checked?.shipme ? [...checked.shipme.values()].filter((p) => p.status !== 'error').length : 0;
  const canPush = shipmeReady && !!checked?.shipme && !checked.committed && sendable > 0 && !busy;

  return (
    <div className="tr-import">
      {shipmeReady ? null : (
        <p className="drawer-note warn">ยังไม่ได้ตั้งค่าการเชื่อม SHIPME (SHIPME_API_URL / SHIPME_SYNC_TOKEN) — อ่านและตรวจกับงาน KOLA ได้ แต่ยังส่งไม่ได้</p>
      )}

      <div className="tr-toolbar">
        <label className="mini">
          <span>ไฟล์งาน (SHIPME)</span>
          <select value={source} onChange={(e) => { setSource(e.target.value); setChecked(null); }} disabled={!!busy}>
            {SOURCES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <div className="tr-modes" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'image'} className={`button tiny${mode === 'image' ? ' primary' : ''}`}
            onClick={() => setMode('image')} disabled={!aiReady}>รูปตาราง</button>
          <button type="button" role="tab" aria-selected={mode === 'paste'} className={`button tiny${mode === 'paste' ? ' primary' : ''}`}
            onClick={() => setMode('paste')}>วางข้อความจากชีต</button>
        </div>
      </div>

      {mode === 'image' ? (
        <div className="tr-input">
          <label className="drop-zone" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addImages([...e.dataTransfer.files]); }}>
            <b>วางรูป (Ctrl+V) · ลากมาวาง · หรือเลือกรูปตาราง Transport Request</b>
            <span className="tr-hint">ได้ครั้งละไม่เกิน 5 รูป · AI อ่านให้ ประมาณ ฿1–2 ต่อรูป · ต้องมีหัวตาราง TRANSPORT และ BILL OF LADING ในรูป</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!!busy}
              onChange={(e) => { addImages([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
          {images.length ? (
            <div className="tr-thumbs">
              {images.map((i) => (
                <figure key={i.key}>
                  <a href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt={i.file.name} /></a>
                  <button type="button" className="icon-button" aria-label={`เอา ${i.file.name} ออก`} disabled={!!busy}
                    onClick={() => { URL.revokeObjectURL(i.url); setImages((cur) => cur.filter((x) => x.key !== i.key)); }}>×</button>
                </figure>
              ))}
            </div>
          ) : null}
          <button type="button" className="button primary" disabled={!images.length || !!busy} onClick={() => void readImages()}>
            {busy === 'read' ? 'กำลังอ่านรูป…' : `อ่านรูป (${images.length})`}
          </button>
        </div>
      ) : (
        <div className="tr-input paste-import">
          <label htmlFor="tr-paste">Copy จาก Google Sheet / Excel รวมแถวหัวตาราง (TRANSPORT · SHIPPER · CON · BILL OF LADING · CONTAINER NO. · SHIPLINE · VESSEL · PORT)</label>
          <textarea id="tr-paste" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} disabled={!!busy} />
          <button type="button" className="button primary" disabled={!paste.trim() || !!busy} onClick={readPaste}>อ่านข้อความ</button>
        </div>
      )}

      {message ? <p className={`drawer-note${message.tone === 'warn' ? ' warn' : ''}`} role="status">{message.text}</p> : null}

      {rows.length ? (
        <>
          {/* ตั้งวันที่ TRANSPORT ได้ทีเดียว (ทีมขอ) — ยังแก้รายแถวในตารางได้ */}
          <div className="tr-toolbar tr-bulk-date">
            <label className="mini">
              <span>ตั้งวันที่ TRANSPORT ทีเดียว</span>
              <input type="date" value={bulkDate} disabled={!!busy} onChange={(e) => setBulkDate(e.target.value)} />
            </label>
            <button type="button" className="button primary" disabled={!bulkDate || !!busy} onClick={() => setAllDates(false)}>
              ใช้กับทุกแถว ({rows.length})
            </button>
            <button type="button" className="button" disabled={!bulkDate || !!busy || rows.every((r) => r.transportDate)} onClick={() => setAllDates(true)}>
              เฉพาะแถวที่ยังว่าง ({rows.filter((r) => !r.transportDate).length})
            </button>
          </div>
          <div className="tr-scroll">
            <table className="tr-preview">
              <thead>
                <tr>
                  <th className="tr-h-no">#</th>
                  <th className="tr-h-blue">TRANSPORT</th>
                  <th className="tr-h-blue">ชิปเปอร์</th>
                  <th className="tr-h-blue">VESSEL</th>
                  <th className="tr-h-blue">เลข BL</th>
                  <th className="tr-h-blue">CONTAINER NO.</th>
                  <th className="tr-h-yellow">จำนวนตู้</th>
                  <th className="tr-h-blue">ท่า</th>
                  <th>KOLA</th>
                  <th>DO</th>
                  <th>SHIPME</th>
                  <th>คำเตือน</th>
                  <th aria-label="ลบแถว" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = checked?.merged.get(r.line);
                  const s = checked?.shipme?.get(r.line);
                  const notes = [...new Set([...(readNotes[r.line] ?? []), ...(m?.warnings ?? []), ...(s?.warning ? [s.warning] : [])])];
                  const error = m?.error || s?.error || '';
                  return (
                    <tr key={r.line} className={error ? 'tr-row-error' : ''}>
                      <td className="tr-no">{r.line}</td>
                      <td><input type="date" value={r.transportDate} disabled={!!busy} aria-label="TRANSPORT"
                        onChange={(e) => edit(r.line, { transportDate: e.target.value })} />
                        {r.eta ? <small className="tr-sub">ETA {dmy(r.eta)}</small> : null}</td>
                      <td><input value={r.customer} disabled={!!busy} aria-label="ชิปเปอร์" onChange={(e) => edit(r.line, { customer: e.target.value })} /></td>
                      <td><input className="tr-short" value={r.vessel} disabled={!!busy} aria-label="SHIPLINE" onChange={(e) => edit(r.line, { vessel: e.target.value })} />
                        {r.vesselName ? <small className="tr-sub" title={r.vesselName}>{r.vesselName}</small> : null}</td>
                      <td><input className="tr-mono" value={r.bl} disabled={!!busy} aria-label="เลข BL" onChange={(e) => edit(r.line, { bl: e.target.value })} /></td>
                      <td><textarea className="tr-mono" rows={Math.max(1, r.containers.length)} value={r.containers.join('\n')} disabled={!!busy}
                        aria-label="เลขตู้" onChange={(e) => edit(r.line, { containers: e.target.value.split(/[\s,]+/).map(keyOf).filter(Boolean) })} /></td>
                      <td><input className="tr-num" inputMode="numeric" value={r.quantity || ''} disabled={!!busy} aria-label="จำนวนตู้"
                        onChange={(e) => edit(r.line, { quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></td>
                      <td><input className="tr-short" value={r.port} disabled={!!busy} aria-label="ท่า" onChange={(e) => edit(r.line, { port: e.target.value })} /></td>
                      <td>{!m ? <span className="tr-muted">—</span> : m.jobNo ? <span className="badge approved">{m.jobNo}</span> : <span className="badge pending">ไม่พบ</span>}</td>
                      <td>{!m || m.doExchanged === null ? <span className="tr-muted">—</span>
                        : m.doExchanged ? <span className="badge approved">แลกแล้ว</span> : <span className="badge rejected">ยัง</span>}</td>
                      <td>{s ? <><span className={`badge ${STATUS[s.status][1]}`}>{checked?.committed && s.status !== 'error' ? 'ส่งแล้ว · ' : ''}{STATUS[s.status][0]}</span>
                        {s.shipping ? <small className="tr-sub">ชิปปิ้ง {s.shipping}</small> : null}</> : <span className="tr-muted">—</span>}</td>
                      <td className="tr-notes">{error ? <b className="tr-error">{error}</b> : null}{notes.map((n) => <span key={n}>{n}</span>)}</td>
                      <td><button type="button" className="icon-button" aria-label={`ลบแถว ${r.line}`} disabled={!!busy} onClick={() => remove(r.line)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>รวม {totals.bl} BL</td>
                  <td className="tr-num">{totals.boxes}</td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="tr-actions">
            <button type="button" className="button" disabled={!!busy} onClick={() => void run(false)}>
              {busy === 'check' ? 'กำลังตรวจ…' : 'ตรวจกับ SHIPME'}
            </button>
            <button type="button" className="button primary" disabled={!canPush} onClick={() => confirmDialog.current?.showModal()}>
              {busy === 'push' ? 'กำลังส่ง…' : `ส่งให้ SHIPME${sendable ? ` (${sendable} BL)` : ''}`}
            </button>
            {checked?.summary && !checked.committed ? (
              <span className="tr-summary">SHIPME: ใหม่ {checked.summary.new} · อัปเดต {checked.summary.update}
                {checked.summary.error ? ` · ผิดพลาด ${checked.summary.error}` : ''}
                {checked.summary.noShipping ? ` · ยังไม่มีชิปปิ้งประจำท่า ${checked.summary.noShipping}` : ''}</span>
            ) : !checked ? <span className="tr-summary">แก้ตารางแล้วต้องกดตรวจใหม่ก่อนส่ง</span> : null}
          </div>
        </>
      ) : null}

      <dialog ref={confirmDialog} className="confirm-dialog">
        <div className="popover-head">
          <b>ยืนยัน</b>
          <button type="button" className="popover-close" aria-label="ปิด" onClick={() => confirmDialog.current?.close()}>×</button>
        </div>
        <p className="confirm-text">ส่ง {sendable} BL ไปตารางขนส่งและแพลนงานของ SHIPME ใช่ไหม</p>
        <p className="confirm-detail">ไฟล์งาน {source} · BL + วันที่ TRANSPORT ที่มีอยู่แล้วใน SHIPME จะถูกอัปเดต แถวที่ผิดพลาดไม่ถูกส่ง</p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => confirmDialog.current?.close()}>ยกเลิก</button>
          <button type="button" className="button primary" onClick={() => void run(true)}>ส่งให้ SHIPME</button>
        </div>
      </dialog>
    </div>
  );
}
