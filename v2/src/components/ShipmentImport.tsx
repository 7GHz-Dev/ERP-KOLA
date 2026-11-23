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
  preview, confirm, sourceType = 'AN',
}: {
  /** BL = นำเข้าจากหน้า Waiting list — งานเข้า Waiting list รอ Arrival Notice */
  sourceType?: 'AN' | 'BL';
  preview: (formData: FormData) => Promise<PreviewResult | undefined>;
  confirm: (formData: FormData) => Promise<Done | undefined>;
}) {
  /*
   * แหล่งข้อมูลที่ตรวจไปล่าสุด — ไฟล์ หรือข้อความที่วางจากตาราง
   * ตอนยืนยันส่งตัวเดียวกับที่ตรวจขึ้นไปอ่านใหม่ ไม่ใช่ข้อความที่อาจแก้ในช่องไปแล้วหลังกดตรวจ
   */
  const source = useRef<{ file: File } | { text: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function formOf(src: { file: File } | { text: string }) {
    const fd = new FormData();
    if ('file' in src) fd.set('file', src.file);
    else fd.set('text', src.text);
    fd.set('sourceType', sourceType);
    return fd;
  }

  async function check(src: { file: File } | { text: string }) {
    source.current = src;
    setResult(null);
    setDone(null);
    setError('');
    setBusy(true);
    try {
      const res = await preview(formOf(src));
      if (res) setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  function pick(list: FileList | null) {
    const picked = list?.[0];
    if (picked) void check({ file: picked });
  }

  async function save() {
    if (!source.current) return;
    setBusy(true);
    setError('');
    try {
      const res = await confirm(formOf(source.current));
      if (res) {
        setDone(res);
        setResult(null);
        // นำเข้าแล้วล้างช่อง กันกดตรวจ/นำเข้าชุดเดิมซ้ำโดยไม่ตั้งใจ
        if ('text' in source.current) setPasted('');
      }
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
        เลือกไฟล์ตารางงาน — Excel (.xlsx) หรือ .csv · หนึ่งแถวเป็นหนึ่งงาน
        <input
          type="file"
          accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={busy}
          onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
        />
      </label>

      <div className="paste-import">
        <label htmlFor="shipment-paste">
          หรือวางข้อมูลที่ copy จากตาราง Excel — เลือกแถวทั้งแถวแล้ว Ctrl+C / ⌘C มาวางที่นี่
          (มีหรือไม่มีหัวคอลัมน์ก็ได้ · เลขลำดับแถวหน้าสุดระบบตัดให้)
        </label>
        <textarea
          id="shipment-paste"
          rows={5}
          value={pasted}
          disabled={busy}
          placeholder={'1024\tMUNNA BY\t16/6/2026\tMSFZ - รถยนต์เก่า\tY\tS\t…'}
          onChange={(e) => setPasted(e.target.value)}
          spellCheck={false}
        />
        <div className="paste-import-actions">
          <button
            type="button"
            className="button"
            disabled={busy || !pasted.trim()}
            onClick={() => void check({ text: pasted })}
          >
            ตรวจข้อมูลที่วาง
          </button>
          {pasted ? (
            <button type="button" className="button" disabled={busy} onClick={() => setPasted('')}>
              ล้างช่อง
            </button>
          ) : null}
        </div>
      </div>

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
                  <th className="col-bl">BL No.</th>
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
                    <td className="batch-name col-bl">{r.blNo || '-'}</td>
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
              {source.current && 'text' in source.current ? '' : 'ไฟล์ '}{result.fileName} · พร้อมนำเข้า {fresh.length} งาน
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
            ไฟล์ที่ไม่มีหัวคอลัมน์ ระบบอ่านตามลำดับคอลัมน์ของไฟล์ตารางงานที่ระบบ export ออกไป ·
            ไฟล์ Excel ระบบอ่านชีตแรกเสมอ ถ้าข้อมูลอยู่แผ่นอื่นให้ย้ายมาไว้แผ่นแรกก่อน
          </p>
        </>
      ) : null}

      {busy && !result ? <p className="batch-note">กำลังตรวจข้อมูล…</p> : null}
    </div>
  );
}
