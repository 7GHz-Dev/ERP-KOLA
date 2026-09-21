'use client';

import { useMemo, useState } from 'react';
import { extractPdfPieces, parseArrivalText } from '@/lib/parse-arrival';
import { combineRead, matchTemplate, type ParseTemplate } from '@/lib/parse-template';
import { candidateNumbers, matchBl, type BlChoice } from '@/lib/match-bl';
import { SearchSelect } from '@/components/SearchSelect';

/**
 * แนบไฟล์ AN/BL เข้างานที่มีอยู่แล้ว — ทีละหลายไฟล์
 *
 * คู่กับการนำเข้า Shipment Detail จากไฟล์ตาราง งานเข้าระบบไปแล้วแต่ยังไม่มีไฟล์
 * ตรงนี้เลือกไฟล์ทั้งกอง ระบบอ่านเลข BL หรือ Waybill ในไฟล์แล้วจับคู่ให้เอง
 *
 * ต่างจากหน้ารับงานตรงที่ "ไม่สร้างงานใหม่" — ช่องเลือกงานมีแต่ BL ที่มีในระบบ
 * ใบที่จับคู่ไม่ได้ต้องเลือกเอง ไม่งั้นจะได้งานซ้ำกับที่นำเข้ามาแล้ว แล้วต้องไล่ลบทีหลัง
 *
 * อ่านไฟล์ในเบราว์เซอร์เหมือนหน้ารับงาน ไฟล์จึงยังไม่ถูกส่งขึ้นเซิร์ฟเวอร์
 * จนกว่าผู้ใช้จะกดบันทึก — จับคู่ผิดแล้วอัปไปเลย แย่กว่าให้ดูก่อนกด
 */

type Row = {
  file: File;
  status: 'reading' | 'ok' | 'error';
  /** เลขที่อ่านได้จากไฟล์ ใช้แสดงให้ผู้ใช้เทียบกับใบที่ระบบเลือกให้ */
  readNo: string;
  message: string;
  /** BL ที่จะแนบไฟล์นี้เข้าไป — ระบบเลือกให้หรือผู้ใช้เลือกเอง */
  blId: string;
  /** ระบบจับคู่ให้เอง ยังไม่มีคนยืนยัน — ใช้แยกสีและนับยอด */
  auto: boolean;
  matchedBy?: 'blNo' | 'waybill';
  savedAs?: string;
  saveError?: string;
};

export function AttachArrival({
  sourceType, choices, templates = [], action,
}: {
  sourceType: 'AN' | 'BL';
  /** BL ทุกใบในระบบที่ยังรับไฟล์ได้ */
  choices: BlChoice[];
  templates?: ParseTemplate[];
  action: (formData: FormData) => Promise<{ jobNo: string; replaced: boolean } | undefined>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const byId = useMemo(() => new Map(choices.map((c) => [c.id, c])), [choices]);

  /*
   * รายการให้เลือกในช่องค้นหา — เลขงานนำหน้า แล้วตามด้วยเลข BL เรือ และ Shipper
   *
   * เลข BL อย่างเดียวแยกไม่ออกเวลามีหลายงานที่เลขใกล้กัน ซึ่งเจอบ่อยเพราะ
   * เลขของตัวแทนเดินเป็นชุดต่อกัน (KG1222026-70107, -70108, …)
   * SearchSelect ค้นทั้งสองช่องอยู่แล้ว จึงพิมพ์เลข BL หรือเลขงานก็เจอเหมือนกัน
   */
  const options = useMemo(() => choices.map((c) => ({
    id: c.id,
    code: c.jobNo,
    name: [c.blNo, c.vessel, c.shipperName].filter(Boolean).join(' · '),
  })), [choices]);

  async function readAll(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...list].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!picked.length) return;

    setRows(picked.map((file) => ({
      file, status: 'reading', message: 'กำลังอ่าน…', readNo: '', blId: '', auto: false,
    })));

    /*
     * อ่านทีละไฟล์ ไม่ยิงพร้อมกันทั้งหมด
     * pdf.js กินหน่วยความจำมากต่อไฟล์ เปิด 20 ไฟล์พร้อมกันแท็บค้างได้
     */
    for (let i = 0; i < picked.length; i += 1) {
      const file = picked[i];
      try {
        // ใช้ตัวอ่านชุดเดียวกับหน้ารับงาน ผลจึงตรงกัน — กรอบที่ผู้ดูแลตั้งไว้มาก่อน
        const read = await extractPdfPieces(file);
        const parsed = combineRead(
          parseArrivalText(read.text), matchTemplate(templates, read.text), read.pieces,
        );
        const numbers = candidateNumbers(parsed, read.text);
        const hit = matchBl(numbers, choices);

        setRows((cur) => cur.map((r, n) => n !== i ? r : {
          ...r,
          status: 'ok',
          readNo: parsed.blNo || numbers[0] || '',
          blId: hit?.choice.id ?? '',
          auto: Boolean(hit),
          matchedBy: hit?.by,
          message: hit
            ? `จับคู่กับ ${hit.choice.jobNo}${hit.by === 'waybill' ? ' (จากเลข Waybill)' : ''}`
            : parsed.blNo
              ? `อ่านเลขได้ "${parsed.blNo}" แต่ไม่ตรงกับ BL ใบไหนในระบบ — เลือกเอง`
              : 'อ่านเลข BL ไม่ได้ — เลือกงานเอง',
        }));
      } catch (error) {
        setRows((cur) => cur.map((r, n) => n !== i ? r : {
          ...r,
          status: 'error',
          message: `อ่านไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
        }));
      }
    }
  }

  const patch = (i: number, next: Partial<Row>) =>
    setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...next } : r)));

  /*
   * ใบที่พร้อมบันทึก — ต้องเลือก BL แล้ว และต้องไม่ซ้ำกับใบอื่นในชุดเดียวกัน
   *
   * ซ้ำกันเองเจอบ่อยเวลาเลข BL ในไฟล์อ่านมาไม่ครบแล้วไปตรงกับใบเดียวกันหลายไฟล์
   * ปล่อยไปจะได้ไฟล์ทับกันเองจนเหลือใบสุดท้ายใบเดียว ซึ่งดูจากผลลัพธ์ไม่ออกว่าหายไปไหน
   */
  const dupIds = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      if (!r.blId || r.savedAs) continue;
      count.set(r.blId, (count.get(r.blId) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const isReady = (r: Row) => Boolean(r.blId) && !dupIds.has(r.blId);
  const ready = rows.filter((r) => r.status === 'ok' && !r.savedAs && isReady(r));
  const autoCount = rows.filter((r) => r.auto && !r.savedAs).length;
  const savedCount = rows.filter((r) => r.savedAs).length;

  async function saveAll() {
    setBusy(true);
    // บันทึกทีละใบตามลำดับ ถ้าใบไหนพลาด ใบที่เหลือยังไปต่อได้ ไม่ล้มทั้งชุด
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.status !== 'ok' || row.savedAs || !isReady(row)) continue;

      const fd = new FormData();
      fd.set('sourceType', sourceType);
      fd.set('blId', row.blId);
      fd.set('file', row.file);

      try {
        const res = await action(fd);
        setRows((cur) => cur.map((r, n) => n === i
          ? {
            ...r,
            savedAs: res ? `${res.jobNo}${res.replaced ? ' (แทนไฟล์เดิม)' : ''}` : '',
            saveError: undefined,
          }
          : r));
      } catch (error) {
        setRows((cur) => cur.map((r, n) => n === i
          ? { ...r, saveError: error instanceof Error ? error.message : String(error) } : r));
      }
    }
    setBusy(false);
  }

  return (
    <div className="batch">
      <div className="section-title">
        แนบไฟล์ {sourceType === 'AN' ? 'Arrival Notice' : 'Bill of Lading'} เข้างานที่มีอยู่แล้ว
      </div>

      {choices.length ? null : (
        <p className="drawer-note warn">
          ยังไม่มี BL ในระบบให้แนบไฟล์ — นำเข้า Shipment Detail จากไฟล์ตารางก่อน
          หรือรับงานจากหน้า Arrival Notice ตามปกติ
        </p>
      )}

      <label className="drop-zone">
        เลือกไฟล์ PDF ได้หลายไฟล์พร้อมกัน · ระบบอ่านเลข BL หรือ Waybill แล้วจับคู่งานให้เอง
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={busy || !choices.length}
          onChange={(e) => void readAll(e.target.files)}
        />
      </label>

      {rows.length ? (
        <>
          <div className="table-wrap batch-table">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-no">No.</th>
                  <th>ไฟล์</th>
                  <th>เลขที่อ่านได้</th>
                  <th className="batch-col-shipper">BL ในระบบ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const target = r.blId ? byId.get(r.blId) : undefined;
                  return (
                    <tr key={`${r.file.name}-${i}`} className={r.savedAs ? 'batch-saved' : undefined}>
                      <td className="col-no">{i + 1}</td>
                      <td className="batch-name">
                        <button
                          type="button"
                          className="cell-link batch-preview"
                          onClick={() => setPreview({ url: URL.createObjectURL(r.file), name: r.file.name })}
                        >
                          {r.file.name}
                        </button>
                      </td>
                      <td>{r.readNo || '-'}</td>
                      <td>
                        {r.savedAs ? (target?.blNo ?? '-') : (
                          <SearchSelect
                            choices={options}
                            value={r.blId}
                            placeholder="พิมพ์เลข BL หรือเลขงาน"
                            onChange={(id) => patch(i, { blId: id, auto: false })}
                          />
                        )}
                      </td>
                      <td>
                        {r.savedAs ? <span className="badge approved">{r.savedAs}</span>
                          : r.saveError ? <span className="badge rejected">{r.saveError}</span>
                          : r.status === 'reading' ? <span className="badge pending">กำลังอ่าน…</span>
                          : r.status === 'error' ? <span className="badge rejected">{r.message}</span>
                          : dupIds.has(r.blId) ? (
                            <span className="badge rejected">
                              เลือก BL ใบเดียวกับไฟล์อื่นในชุดนี้ — แก้ให้ต่างกันก่อน
                            </span>
                          )
                          : !r.blId ? <span className="badge pending">{r.message}</span>
                          : (
                            <span className={r.auto ? 'badge neutral' : 'badge approved'}>
                              {r.auto ? r.message : `เลือกเอง → ${target?.jobNo ?? ''}`}
                              {target?.hasFile ? ' · มีไฟล์เดิมอยู่ จะถูกแทนที่' : ''}
                            </span>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="batch-foot">
            <span>
              พร้อมแนบ {ready.length} ไฟล์
              {autoCount ? ` · ระบบจับคู่ให้ ${autoCount} ไฟล์` : ''}
              {savedCount ? ` · แนบแล้ว ${savedCount} ไฟล์` : ''}
            </span>
            <button
              type="button"
              className="button primary"
              disabled={busy || !ready.length}
              onClick={() => void saveAll()}
            >
              {busy ? 'กำลังแนบ…' : `แนบ ${ready.length} ไฟล์`}
            </button>
          </div>

          <p className="batch-note">
            กดชื่อไฟล์เพื่อเปิดดูเอกสารก่อนยืนยัน ·
            ใบที่ระบบจับคู่ให้เองขึ้นเป็นสีเทา ตรวจแล้วเปลี่ยนได้ในช่อง “BL ในระบบ” ·
            เลือกได้เฉพาะ BL ที่มีในระบบเท่านั้น หน้านี้ไม่สร้างงานใหม่ —
            งานที่ยังไม่มีในระบบให้รับจากหน้า Arrival Notice หรือ นำเข้า Shipment Detail ก่อน ·
            งานที่มีไฟล์อยู่แล้วจะถูกแทนที่ด้วยไฟล์ใหม่ ไฟล์เดิมยังย้อนดูได้ที่หน้าไฟล์ของงาน
          </p>
        </>
      ) : null}

      {/* แผงดูไฟล์ — ไฟล์ยังอยู่ในเครื่อง ปิดแล้วคืน blob URL กันหน่วยความจำค้าง */}
      {preview ? (
        <div className="drawer-root">
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="ปิดแผงดูไฟล์"
            onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
          />
          <aside className="job-drawer open wide" role="dialog" aria-label={`ดูไฟล์ ${preview.name}`}>
            <header className="drawer-header">
              <div>
                <small>ตรวจเอกสารก่อนแนบ</small>
                <h2 className="drawer-file">{preview.name}</h2>
              </div>
              <div className="drawer-nav">
                <a className="button tiny" href={preview.url} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}
                  aria-label="ปิด"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="drawer-content">
              <object className="file-preview-view" data={preview.url} type="application/pdf">
                <p className="drawer-note warn">
                  เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ ·{' '}
                  <a href={preview.url} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
                </p>
              </object>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
