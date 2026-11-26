'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteDoc, docUploadUrl, listDocs, lookupBl, matchDocFiles, registerDoc, type DocMatch, type SentDoc,
} from '@/lib/actions/transport-request';
import { loadPdfjs } from '@/lib/parse-arrival';
import { classifyDocFile } from '@/lib/transport-request/parse';

/**
 * MAY — อัปไฟล์ใบขน / E-Office เข้า ERP SHIPME (เมนูชั่วคราว) — ไฟล์ไม่ถูกแนบเข้างานใน KOLA
 *
 * เลือกหลายไฟล์ปนกันได้ ระบบแยกประเภทและหา BL ให้: ชื่อไฟล์ (เลขใบขน / BL + E-เลข) ก่อน ไม่ได้ค่อยอ่านข้อความหน้าแรก ๆ
 * ไฟล์ส่งจากเบราว์เซอร์ตรงเข้า Storage ของ SHIPME (signed upload URL) เพราะไฟล์สแกนใหญ่เกินเพดาน body ของ Vercel
 */
const MAX_BYTES = 20 * 1024 * 1024;
const KIND_LABEL = { DECL: 'ใบขน', EOFFICE: 'E-Office' } as const;
const BY_LABEL = { filename: 'ชื่อไฟล์', text: 'ข้อความในไฟล์', '': 'เลือกเอง' } as const;

type Row = Omit<DocMatch, 'name'> & {
  key: string; file: File; status: 'matching' | 'ready' | 'uploading' | 'done' | 'error'; error: string;
};

/** ข้อความ 2 หน้าแรก — พอสำหรับเลขใบขน / คำร้อง E-Office · ไฟล์สแกนไม่มีข้อความก็คืน '' */
async function firstPagesText(file: File): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(2, doc.numPages); i += 1) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return pages.join('\n');
  } catch {
    return '';
  }
}

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('th-TH-u-ca-gregory', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function TransportDocsUpload({ shipmeReady }: { shipmeReady: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SentDoc[] | null>(null);
  const [sentError, setSentError] = useState('');

  const patch = (key: string, p: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const refreshSent = useCallback(async () => {
    if (!shipmeReady) return;
    const res = await listDocs().catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    if (res.ok) { setSent(res.rows); setSentError(''); } else setSentError(res.detail);
  }, [shipmeReady]);
  useEffect(() => { void refreshSent(); }, [refreshSent]);

  async function addFiles(files: File[]) {
    const fresh: Row[] = files.map((file) => {
      const bad = !/\.pdf$/i.test(file.name) ? 'รับเฉพาะไฟล์ PDF' : file.size > MAX_BYTES ? 'ไฟล์ใหญ่เกิน 20MB' : '';
      return {
        key: `${file.name}-${file.size}-${Math.random()}`, file, kind: null, bl: '', jobId: '', jobNo: '', declarationNo: '',
        doExchanged: null, by: '', status: bad ? 'error' : 'matching', error: bad,
      };
    });
    setRows((cur) => [...cur, ...fresh]);
    const todo = fresh.filter((r) => r.status === 'matching');
    if (!todo.length) return;
    const texts = await Promise.all(todo.map(async (r) => ({ name: r.file.name, text: await firstPagesText(r.file) })));
    const res = await matchDocFiles(texts).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    todo.forEach((r, i) => {
      if (!res.ok) {
        // ถามงาน KOLA ไม่ได้ ยังแยกประเภท / BL จากชื่อไฟล์และข้อความในเครื่องได้
        const g = classifyDocFile(texts[i].name, texts[i].text);
        patch(r.key, { kind: g.kind, bl: g.blHint, declarationNo: g.declarationNo, by: g.by, status: 'ready', error: `หางาน KOLA ไม่ได้ (${res.detail})` });
        return;
      }
      const { name: _n, ...m } = res.items[i];
      patch(r.key, { ...m, status: 'ready', error: '' });
    });
  }

  async function setBl(row: Row, bl: string) {
    patch(row.key, { bl, by: '', jobId: '', jobNo: '', doExchanged: null });
    if (!bl.trim()) return;
    const res = await lookupBl(bl).catch(() => null);
    if (res?.ok) patch(row.key, { jobId: res.jobId, jobNo: res.jobNo, doExchanged: res.doExchanged });
  }

  async function uploadOne(row: Row) {
    if (!row.kind || !row.bl.trim()) return;
    patch(row.key, { status: 'uploading', error: '' });
    const meta = { bl: row.bl, kind: row.kind, fileName: row.file.name, size: row.file.size };
    const url = await docUploadUrl(meta).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    if (!url.ok) { patch(row.key, { status: 'error', error: url.detail }); return; }
    const put = await fetch(url.signedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: row.file })
      .then((r) => r.ok).catch(() => false);
    if (!put) { patch(row.key, { status: 'error', error: 'อัปไฟล์ขึ้น SHIPME ไม่สำเร็จ — กดลองใหม่' }); return; }
    const reg = await registerDoc({ ...meta, storageKey: url.storageKey, kolaJobId: row.jobId, declarationNo: row.declarationNo })
      .catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    patch(row.key, reg.ok ? { status: 'done', error: '' } : { status: 'error', error: reg.detail });
  }

  async function uploadAll() {
    setBusy(true);
    for (const r of rows) if (r.status === 'ready' || r.status === 'error') if (r.kind && r.bl.trim() && !/PDF|20MB/.test(r.error)) await uploadOne(r);
    setBusy(false);
    void refreshSent();
  }

  async function remove(doc: SentDoc) {
    if (!window.confirm(`ลบไฟล์ ${doc.fileName} (${KIND_LABEL[doc.kind as keyof typeof KIND_LABEL] ?? doc.kind} · BL ${doc.bl}) ออกจาก SHIPME ใช่ไหม`)) return;
    const res = await deleteDoc(doc.id).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    if (!res.ok) { setSentError(res.detail); return; }
    void refreshSent();
  }

  const ready = rows.filter((r) => (r.status === 'ready' || (r.status === 'error' && !/PDF|20MB/.test(r.error))) && r.kind && r.bl.trim()).length;
  const missing = rows.filter((r) => r.status === 'ready' && (!r.kind || !r.bl.trim())).length;

  return (
    <div className="td-upload">
      {shipmeReady ? null : (
        <p className="drawer-note warn">ยังไม่ได้ตั้งค่าการเชื่อม SHIPME (SHIPME_API_URL / SHIPME_SYNC_TOKEN) — จับคู่ไฟล์ได้ แต่ยังอัปไม่ได้</p>
      )}

      <label className="drop-zone" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files]); }}>
        <b>ลากไฟล์มาวาง หรือเลือกไฟล์ PDF ใบขน / E-Office ได้หลายไฟล์พร้อมกัน</b>
        <span className="tr-hint">ปนกันได้ทั้งสองประเภท · ระบบดูจากชื่อไฟล์ (เลขใบขน เช่น A0310691002615 · BL + E-เลข เช่น AMP0572751A E-744810) ก่อน ไม่ได้ค่อยอ่านข้อความในไฟล์ · ไฟล์ละไม่เกิน 20MB</span>
        <input type="file" accept="application/pdf,.pdf" multiple disabled={busy}
          onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>

      {rows.length ? (
        <>
          <div className="tr-scroll">
            <table className="tr-preview td-files">
              <thead>
                <tr>
                  <th className="tr-h-no">#</th><th className="tr-h-blue">ไฟล์</th><th className="tr-h-blue">ประเภท</th>
                  <th className="tr-h-blue">เลข BL</th><th>จับได้จาก</th><th>งาน KOLA</th><th>DO</th><th>สถานะ</th><th aria-label="เอาออก" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const locked = busy || r.status === 'matching' || r.status === 'uploading' || r.status === 'done';
                  return (
                    <tr key={r.key} className={r.status === 'error' ? 'tr-row-error' : ''}>
                      <td className="tr-no">{i + 1}</td>
                      <td><span className="td-name" title={r.file.name}>{r.file.name}</span><small className="tr-sub">{sizeText(r.file.size)}</small></td>
                      <td>
                        <select value={r.kind ?? ''} disabled={locked} aria-label="ประเภท"
                          onChange={(e) => patch(r.key, { kind: (e.target.value || null) as Row['kind'] })}>
                          <option value="">— เลือก —</option>
                          <option value="DECL">ใบขน</option>
                          <option value="EOFFICE">E-Office</option>
                        </select>
                      </td>
                      <td><input className="tr-mono" value={r.bl} disabled={locked} aria-label="เลข BL" placeholder="ใส่เลข BL"
                        onChange={(e) => patch(r.key, { bl: e.target.value })} onBlur={(e) => void setBl(r, e.target.value)} />
                        {r.declarationNo ? <small className="tr-sub">ใบขน {r.declarationNo}</small> : null}</td>
                      <td>{r.status === 'matching' ? <span className="tr-muted">กำลังอ่าน…</span> : BY_LABEL[r.by]}</td>
                      <td>{r.jobNo ? <span className="badge approved">{r.jobNo}</span> : r.status === 'matching' ? null : <span className="badge pending">ไม่พบ</span>}</td>
                      <td>{r.doExchanged === null ? <span className="tr-muted">—</span>
                        : r.doExchanged ? <span className="badge approved">แลกแล้ว</span> : <span className="badge rejected">ยัง</span>}</td>
                      <td>
                        {r.status === 'done' ? <span className="badge approved">ส่งแล้ว</span>
                          : r.status === 'uploading' ? <span className="tr-muted">กำลังอัป…</span>
                            : r.status === 'ready' && (!r.kind || !r.bl.trim()) ? <span className="badge pending">เลือกประเภท / ใส่ BL</span>
                              : r.status === 'ready' ? <span className="badge neutral">พร้อมอัป</span> : null}
                        {r.error ? <b className="tr-error">{r.error}</b> : null}
                        {r.status === 'error' && r.kind && r.bl.trim() && !/PDF|20MB/.test(r.error) && !busy
                          ? <button type="button" className="button tiny" onClick={() => void uploadOne(r)}>ลองใหม่</button> : null}
                      </td>
                      <td>{r.status === 'uploading' ? null : (
                        <button type="button" className="icon-button" aria-label={`เอา ${r.file.name} ออก`} disabled={busy}
                          onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}>×</button>
                      )}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tr-actions">
            <button type="button" className="button primary" disabled={!shipmeReady || busy || !ready} onClick={() => void uploadAll()}>
              {busy ? 'กำลังอัป…' : `อัปให้ SHIPME (${ready} ไฟล์)`}
            </button>
            {missing ? <span className="tr-summary">อีก {missing} ไฟล์ต้องเลือกประเภทหรือใส่ BL ก่อน</span> : null}
            {rows.some((r) => r.status === 'done') && !busy
              ? <button type="button" className="button tiny" onClick={() => setRows((cur) => cur.filter((r) => r.status !== 'done'))}>ล้างรายการที่ส่งแล้ว</button> : null}
          </div>
        </>
      ) : null}

      {shipmeReady ? (
        <section className="td-sent">
          <h2 className="section-title">ส่งไป SHIPME ล่าสุด</h2>
          {sentError ? <p className="drawer-note warn">{sentError}</p> : null}
          {sent === null ? <p className="tr-muted">กำลังโหลด…</p> : !sent.length ? <p className="tr-muted">ยังไม่มีไฟล์ที่ส่งไป</p> : (
            <div className="tr-scroll">
              <table className="tr-preview td-files">
                <thead><tr><th>เมื่อ</th><th>BL</th><th>ประเภท</th><th>ไฟล์</th><th>โดย</th><th aria-label="ลบ" /></tr></thead>
                <tbody>
                  {sent.map((d) => (
                    <tr key={d.id} className={d.current ? '' : 'td-old'}>
                      <td>{when(d.uploadedAt)}</td>
                      <td className="tr-mono">{d.bl}</td>
                      <td>{KIND_LABEL[d.kind as keyof typeof KIND_LABEL] ?? d.kind}{d.current ? null : <small className="tr-sub">ไฟล์เก่า (มีไฟล์ใหม่กว่า)</small>}</td>
                      <td>{d.url ? <a className="cell-link" href={d.url} target="_blank" rel="noreferrer">{d.fileName}</a> : d.fileName}</td>
                      <td>{d.uploadedBy}</td>
                      <td><button type="button" className="icon-button" aria-label={`ลบ ${d.fileName}`} onClick={() => void remove(d)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
