'use client';

import type { DraftCsv } from '@/lib/cargo-invoice/draft-csv';

/**
 * แผงดูเอกสารของหน้า Create Cargo Invoice — ใช้ร่วมกันทั้งรูปแบบ JAN TRADING / AICHI และ NORMAL
 *   PdfDrawer  Preview FN Invoice (PDF ที่ประกอบแบบเดียวกับตอนบันทึก)
 *   CsvDrawer  CSV สำหรับ Draft ใบขน (ไฟล์เดียวกับที่ worker นำเข้า NETBAY) ดูเป็นตาราง + ดาวน์โหลด
 */

function Drawer({ title, note, onClose, actions, children }: {
  title: string; note: string; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="drawer-root">
      <button type="button" className="drawer-backdrop" aria-label="ปิด" onClick={onClose} />
      <aside className="job-drawer open wide" role="dialog" aria-label={title}>
        <header className="drawer-header">
          <div>
            <small>{note}</small>
            <h2 className="drawer-file">{title}</h2>
          </div>
          <div className="drawer-nav">
            {actions}
            <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">×</button>
          </div>
        </header>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  );
}

export function PdfDrawer({ url, title, note, onClose }: { url: string; title: string; note: string; onClose: () => void }) {
  return (
    <Drawer title={title} note={note} onClose={onClose}
      actions={<a className="button tiny" href={url} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a>}>
      <object className="file-preview-view" data={url} type="application/pdf">
        <p className="drawer-note warn">
          เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ · <a href={url} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
        </p>
      </object>
    </Drawer>
  );
}

/** ดาวน์โหลดไฟล์ CSV (TIS-620) ที่เซิร์ฟเวอร์เข้ารหัสมาให้ */
export function downloadCsv(csv: DraftCsv) {
  if (!csv.base64) return;
  const bytes = Uint8Array.from(atob(csv.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = csv.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CsvDrawer({ csv, note, onClose }: { csv: DraftCsv; note: string; onClose: () => void }) {
  // คอลัมน์ที่มีค่าต่างจาก N/A อย่างน้อยหนึ่งแถว — ที่เหลือเป็นค่าคงที่ของแม่แบบ ซ่อนไว้ไม่ให้ตารางกว้างเกิน
  const used = csv.columns.map((_, i) => csv.rows.some((r) => r[i] && r[i] !== 'N/A'));
  return (
    <Drawer title={`CSV Draft ใบขน · ${csv.fileName}`} note={note} onClose={onClose}
      actions={(
        <button type="button" className="button tiny primary" disabled={!csv.base64} onClick={() => downloadCsv(csv)}>
          ⬇ ดาวน์โหลด CSV
        </button>
      )}>
      {csv.warnings.length ? (
        <ul className="cgi-checks">{csv.warnings.map((w) => <li key={w} className="bad">⚠ {w}</li>)}</ul>
      ) : null}
      {csv.totals ? (
        <p className="batch-note">
          รวม {csv.totals.package_amount} {csv.totals.package_unit} · น้ำหนัก {csv.totals.gross_weight} KG ·
          ราคา {csv.totals.price} {csv.totals.currency} · {csv.rows.length} แถว
          {' '}· แสดง {used.filter(Boolean).length} จาก {csv.columns.length} คอลัมน์ (ที่ซ่อนเป็น N/A ทุกแถว — ไฟล์ที่ดาวน์โหลดมีครบ)
        </p>
      ) : null}
      <div className="table-wrap cgi-csv">
        <table className="data">
          <thead>
            <tr>{csv.columns.map((c, i) => (used[i] ? <th key={`${c}-${i}`}>{c}</th> : null))}</tr>
          </thead>
          <tbody>
            {csv.rows.map((r, k) => (
              <tr key={k}>{r.map((v, i) => (used[i] ? <td key={i}>{v}</td> : null))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
