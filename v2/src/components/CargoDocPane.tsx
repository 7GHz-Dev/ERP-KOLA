'use client';

import { useEffect, useState } from 'react';
import { ZoomImage } from './ZoomImage';

/**
 * แผงเอกสารของ Create FN Invoice — ใช้ร่วมกันทุกรูปแบบ (NORMAL · JAN TRADING · AICHI)
 *
 * สลับ OG Invoice (ไฟล์ผู้ขาย) / FN Invoice (Preview ที่ประกอบแบบเดียวกับตอนบันทึก) / ดูคู่กัน
 * OG Invoice: รูป / PDF เปิดตรงจากเครื่อง · Excel แปลงเป็น PDF ที่เซิร์ฟเวอร์ (ไม่เก็บไฟล์)
 */
export type DocView = 'file' | 'fn' | 'both';

function useVendorFileView(file: File) {
  const [view, setView] = useState<{ url: string; kind: 'img' | 'pdf' } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    let url = '';
    let gone = false;
    setView(null);
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isImage || isPdf) {
      url = URL.createObjectURL(file);
      setView({ url, kind: isImage ? 'img' : 'pdf' });
    } else if (/\.xlsx$/i.test(file.name)) {
      setNote('กำลังแปลง Excel เป็น PDF…');
      const fd = new FormData();
      fd.set('file', file);
      void fetch('/api/cargo-invoice/file-preview', { method: 'POST', body: fd }).then(async (res) => {
        if (gone) return;
        if (!res.ok) { setNote((await res.json().catch(() => ({}))).error ?? 'แปลงไฟล์ไม่ได้'); return; }
        url = URL.createObjectURL(await res.blob());
        if (gone) { URL.revokeObjectURL(url); return; }
        setView({ url, kind: 'pdf' });
        setNote('');
      }).catch(() => { if (!gone) setNote('แปลงไฟล์ไม่ได้'); });
    } else {
      setNote('ไฟล์ชนิดนี้แสดงในหน้าไม่ได้ — เปิดดูจากเครื่องแทน');
    }
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return { fileView: view, fileNote: note };
}

export function CargoDocPane({
  file, badge, view, onView, preview, previewStale, disabled, onPreview, onReset, fnNote,
}: {
  file: File;
  /** รูปแบบใบ เช่น NORMAL · JAN TRADING · AICHI */
  badge: string;
  view: DocView;
  onView: (v: DocView) => void;
  /** URL ของ PDF Preview FN Invoice — null = ยังไม่ได้สร้าง */
  preview: string | null;
  /** ข้อมูลเปลี่ยนหลัง Preview */
  previewStale: boolean;
  disabled: boolean;
  onPreview: () => void;
  onReset: () => void;
  /** ข้อความใต้หัว FN Invoice ตอนดูคู่กัน */
  fnNote?: string;
}) {
  const { fileView, fileNote } = useVendorFileView(file);
  const vendorPane = fileView?.kind === 'img' ? <ZoomImage className="cgi-doc-file" src={fileView.url} alt={file.name} />
    : fileView ? <object className="cgi-doc-file" data={fileView.url} type="application/pdf"><p>{file.name}</p></object>
      : <p className="batch-note">{fileNote}</p>;
  const fnPane = preview
    ? <object className="cgi-doc-file" data={preview} type="application/pdf"><p><a href={preview} target="_blank" rel="noreferrer">เปิด Preview FN Invoice</a></p></object>
    : (
      <div className="cgi-doc-empty">
        <p>ยังไม่ได้สร้าง Preview FN Invoice</p>
        <button type="button" className="button primary" disabled={disabled} onClick={onPreview}>👁 Preview FN Invoice</button>
      </div>
    );

  return (
    <section className="cgi-doc">
      <div className="cgi-doc-bar">
        <span className="badge neutral">{badge}</span>
        <b className="cgi-doc-name" title={file.name}>{file.name}</b>
        <div className="cgi-doc-tabs" role="tablist" aria-label="เอกสารที่แสดง">
          {([['file', 'OG Invoice'], ['fn', `FN Invoice${previewStale ? ' •' : ''}`], ['both', 'ดูคู่กัน']] as Array<[DocView, string]>).map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => onView(v)}>{label}</button>
          ))}
        </div>
        <button type="button" className="button tiny" disabled={disabled} onClick={onPreview}>
          {preview ? '↻ Preview FN Invoice' : '👁 Preview FN Invoice'}
        </button>
        {preview ? <a className="button tiny" href={preview} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a> : null}
        <button type="button" className="button tiny" onClick={onReset} disabled={disabled}>เริ่มใหม่</button>
      </div>
      {previewStale && view !== 'file' ? <p className="cgi-doc-stale">ข้อมูลด้านล่างเปลี่ยนหลัง Preview — กด ↻ Preview FN Invoice เพื่อดูฉบับล่าสุด</p> : null}
      <div className={`cgi-doc-body ${view}`}>
        {view !== 'fn' ? <div className="cgi-doc-pane">{view === 'both' ? <small>OG Invoice</small> : null}{vendorPane}</div> : null}
        {view !== 'file' ? <div className="cgi-doc-pane">{view === 'both' ? <small>FN Invoice{preview && fnNote ? ` (${fnNote})` : ''}</small> : null}{fnPane}</div> : null}
      </div>
    </section>
  );
}
