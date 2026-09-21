'use client';

import { useRef, useState } from 'react';
import type { PreviewResult } from '@/lib/actions/shipment-import';

/**
 * นำเข้า Shipment Detail จากไฟล์ตารางงาน
 *
 * สองจังหวะเสมอ — เลือกไฟล์แล้วดูผลตรวจก่อน ค่อยกดยืนยัน
 * ไฟล์ที่ผู้ใช้เอามามักเป็นตารางที่แก้มือกันมาหลายรอบ มีบรรทัดรวมยอด ชื่อที่ยังไม่มี
 * ใน Master และใบที่นำเข้าไปแล้ว เห็นทั้งแผ่นก่อนจึงปลอดภัยกว่ากดแล้วเขียนเลย
 *
 * ถือไฟล์ไว้ใน ref แทน state เพราะ File ไม่เปลี่ยนตามการ render
 * และตอนกดยืนยันต้องส่งไฟล์ตัวเดิมขึ้นไปให้เซิร์ฟเวอร์อ่านใหม่อีกรอบ
 * ไม่ได้ส่งผลตรวจที่อยู่ในหน้ากลับขึ้นไป ซึ่งแก้ในเบราว์เซอร์ได้
 */

type Done = { imported: number; duplicates: number; jobNos: string[] };

export function ShipmentImport({
  preview, confirm,
}: {
  preview: (formData: FormData) => Promise<PreviewResult | undefined>;
  confirm: (formData: FormData) => Promise<Done | undefined>;
}) {
  const file = useRef<File | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    file.current = picked;
    setResult(null);
    setDone(null);
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', picked);
      const res = await preview(fd);
      if (res) setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function save() {
    if (!file.current) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('file', file.current);
      const res = await confirm(fd);
      if (res) { setDone(res); setResult(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const rows = result?.rows ?? [];
  const fresh = rows.filter((r) => !r.duplicateOf);
  const dup = rows.length - fresh.length;
  const warned = fresh.filter((r) => r.warnings.length).length;

  return (
    <div className="batch">
      <div className="section-title">นำเข้า Shipment Detail จากไฟล์ตาราง</div>

      <label className="drop-zone">
        เลือกไฟล์ .csv ของตารางงาน · หนึ่งแถวเป็นหนึ่งงาน
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => void pick(e.target.files)}
        />
      </label>

      {error ? <p className="drawer-note warn">{error}</p> : null}

      {done ? (
        <div className="import-done">
          <p>
            นำเข้าแล้ว <strong>{done.imported}</strong> งาน
            {done.duplicates ? ` · ข้ามใบที่มีอยู่แล้ว ${done.duplicates} ใบ` : ''}
          </p>
          <p className="batch-note">
            เลขงานที่ได้: {done.jobNos.slice(0, 20).join(' · ')}
            {done.jobNos.length > 20 ? ` และอีก ${done.jobNos.length - 20} งาน` : ''}
          </p>
          <p className="batch-note">
            ขั้นต่อไป — อัปไฟล์ AN/BL เข้างานเหล่านี้ได้ที่แท็บ “แนบไฟล์ AN/BL เข้างาน”
            ระบบจะจับคู่ให้จากเลข BL ที่อ่านได้ในไฟล์
          </p>
        </div>
      ) : null}

      {result ? (
        <>
          <div className="table-wrap batch-table">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-no">บรรทัด</th>
                  <th>BL No.</th>
                  <th>เรือ / เที่ยว</th>
                  <th>ETA</th>
                  <th>ตู้</th>
                  <th>Shipper</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lineNo} className={r.duplicateOf ? 'batch-saved' : undefined}>
                    <td className="col-no">{r.lineNo}</td>
                    <td className="batch-name">{r.blNo || '-'}</td>
                    <td>{r.vessel || '-'}</td>
                    <td>{r.eta ?? '-'}</td>
                    <td>{r.containers || '-'}</td>
                    <td>{r.resolved.shipper ?? '-'}</td>
                    <td>
                      {r.duplicateOf
                        ? <span className="badge neutral">มีอยู่แล้ว ({r.duplicateOf}) — ข้าม</span>
                        : r.warnings.length
                          ? <span className="badge pending">{r.warnings.join(' · ')}</span>
                          : <span className="badge approved">พร้อมนำเข้า</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="batch-foot">
            <span>
              ไฟล์ {result.fileName} · พร้อมนำเข้า {fresh.length} งาน
              {dup ? ` · ข้ามใบที่มีอยู่แล้ว ${dup} ใบ` : ''}
              {warned ? ` · มีคำเตือน ${warned} แถว` : ''}
              {result.skipped ? ` · ข้ามบรรทัดว่าง ${result.skipped} บรรทัด` : ''}
            </span>
            <button
              type="button"
              className="button primary"
              disabled={busy || !fresh.length}
              onClick={() => void save()}
            >
              {busy ? 'กำลังนำเข้า…' : `นำเข้า ${fresh.length} งาน`}
            </button>
          </div>

          <p className="batch-note">
            แถวที่มีคำเตือนยังนำเข้าได้ — ช่องที่จับกับ Master Data ไม่ได้จะเว้นว่างไว้
            แล้วแก้รายใบทีหลังได้ที่หน้างานคงค้าง ·
            ใบที่มีเลข BL ตรงกับงานในระบบแล้วจะถูกข้ามเสมอ นำเข้าไฟล์เดิมซ้ำจึงไม่เกิดงานซ้ำ ·
            ไฟล์ที่ไม่มีหัวคอลัมน์ ระบบอ่านตามลำดับคอลัมน์ของไฟล์ตารางงานที่ระบบ export ออกไป
          </p>
        </>
      ) : null}

      {busy && !result ? <p className="batch-note">กำลังตรวจไฟล์…</p> : null}
    </div>
  );
}
