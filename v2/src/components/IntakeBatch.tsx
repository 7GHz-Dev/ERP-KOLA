'use client';

import { useState } from 'react';
import type { Option } from '@/lib/queries/master';
import { extractPdfPieces, parseArrivalText } from '@/lib/parse-arrival';
import { combineRead, matchTemplate, type ParseTemplate } from '@/lib/parse-template';
import { matchShipper } from '@/lib/match-shipper';
import { SearchSelect } from '@/components/SearchSelect';
import { QuickAddMaster } from '@/components/QuickAddMaster';
import { findDuplicateBls } from '@/lib/actions/intake';
import { dedupeContainers, isBlDuplicateExempt, normalizeBlNo } from '@/lib/intake-checks';

/**
 * รับงานทีละหลายใบ — เลือก PDF หลายไฟล์พร้อมกัน หนึ่งไฟล์เป็นหนึ่งงาน
 *
 * ของเดิมรับได้ทีละใบ คีย์ครบ 20 ใบต้องเลือกไฟล์ 20 รอบ รออ่าน 20 รอบ
 * ตรงนี้อ่านรวดเดียวแล้วแสดงเป็นรายการให้ตรวจก่อน เห็นพร้อมกันว่าใบไหนอ่านไม่ครบ
 * แล้วค่อยกดบันทึกทีเดียว
 *
 * ยังใช้ตัวอ่านและ server action ตัวเดียวกับฟอร์มทีละใบ ผลลัพธ์จึงเหมือนกันทุกประการ
 * ต่างแค่จำนวนรอบที่คนต้องกด
 *
 * แก้ได้สองช่องที่ฝั่งเซิร์ฟเวอร์บังคับ — เลข BL กับ Shipper
 * เพราะถ้าขาดสองอย่างนี้จะบันทึกไม่ผ่าน แล้วขึ้น error ที่ผู้ใช้แก้ในหน้านี้ไม่ได้
 * ช่องอื่นแก้ทีหลังได้ที่หน้างานคงค้าง จึงไม่เอามาไว้ตรงนี้
 * ไม่งั้นจะกลายเป็น 20 ฟอร์มซ้อนกันซึ่งอ่านยากกว่าเดิม
 *
 * ตัดหน้ายังไม่รองรับ ใบที่ต้องตัดให้ใช้ฟอร์มทีละใบแทน
 */

type Row = {
  file: File;
  status: 'reading' | 'ok' | 'thin' | 'error';
  message: string;
  /*
   * ค่าที่ผู้ใช้แก้ได้ในตาราง แยกจาก parsed ซึ่งเป็นค่าที่อ่านได้ดิบ ๆ
   * เก็บแยกเพราะต้องรู้ว่าอันไหนระบบอ่านมา อันไหนคนแก้เอง ตอนแสดงสถานะ
   */
  blNo: string;
  /** ค่าที่อ่านได้ ใช้ทั้งแสดงในตารางและส่งขึ้นเซิร์ฟเวอร์ */
  parsed?: ReturnType<typeof parseArrivalText>;
  shipperId?: string;
  shipperName?: string;
  /** ผลหลังกดบันทึก */
  savedAs?: string;
  saveError?: string;
};

export function IntakeBatch({
  sourceType, options, defaults, action, templates = [],
}: {
  sourceType: 'AN' | 'BL';
  options: { shippers: Option[] };
  /** แบบร่างพื้นที่อ่านค่าที่ผู้ดูแลตั้งไว้ — ค่าจากกรอบมาก่อนตัวอ่านอัตโนมัติ */
  templates?: ParseTemplate[];
  defaults: { containerType: string; jobTypeId: string | null; consigneeId: string | null;
              notifyId: string | null; portId: string | null; demDays: string; detDays: string };
  action: (formData: FormData) => Promise<string | void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  /*
   * เลข BL ที่ซ้ำ — คีย์เป็นเลข BL แบบปรับรูปแล้ว ค่าเป็นข้อความว่าซ้ำกับอะไร
   * ซ้ำได้ทั้งกับงานที่มีอยู่ในระบบ และกับไฟล์อื่นในชุดที่กำลังรับอยู่นี้
   */
  const [dupBls, setDupBls] = useState<Map<string, string>>(new Map());

  /** ตรวจเลข BL ซ้ำของทุกแถว — SEALS ซ้ำได้ตามปกติ ไม่นับ */
  async function refreshDuplicates(list: Array<{ blNo: string; carrier: string; saved?: boolean }>) {
    const pending = list.filter((r) => r.blNo.trim() && !r.saved && !isBlDuplicateExempt(r.carrier));
    const out = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const r of pending) counts.set(normalizeBlNo(r.blNo), (counts.get(normalizeBlNo(r.blNo)) ?? 0) + 1);
    for (const [bl, n] of counts) if (n > 1) out.set(bl, 'ไฟล์อื่นในชุดนี้');
    try {
      const found = pending.length ? await findDuplicateBls(pending.map((r) => r.blNo), '') : [];
      for (const d of found) {
        const bl = normalizeBlNo(d.blNo);
        out.set(bl, [out.get(bl), `งาน ${d.jobNo}`].filter(Boolean).join(' · '));
      }
    } catch { /* ตรวจไม่ได้ก็ไม่ขวางการรับงาน เซิร์ฟเวอร์ยังตรวจซ้ำตอนบันทึก */ }
    setDupBls(out);
    return out;
  }
  const dupOf = (r: Row) =>
    isBlDuplicateExempt(r.parsed?.carrier) ? undefined : dupBls.get(normalizeBlNo(r.blNo));
  const [busy, setBusy] = useState(false);
  /*
   * ไฟล์ที่กำลังเปิดดู — ใช้ blob URL ของไฟล์ในเครื่อง ยังไม่ได้อัปขึ้นเซิร์ฟเวอร์
   * เก็บชื่อไว้ด้วยเพื่อโชว์บนหัวแผง และคืนหน่วยความจำตอนปิด
   */
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  async function readAll(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...list].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!picked.length) return;

    setRows(picked.map((file) => ({ file, status: 'reading', message: 'กำลังอ่าน…', blNo: '' })));
    const readBls: Array<{ blNo: string; carrier: string }> = [];

    /*
     * อ่านทีละไฟล์ ไม่ยิงพร้อมกันทั้งหมด
     * pdf.js กินหน่วยความจำมากต่อไฟล์ เปิด 20 ไฟล์พร้อมกันแท็บค้างได้
     * และผู้ใช้เห็นความคืบหน้าทีละใบอยู่แล้ว จึงไม่ได้ช้าลงในความรู้สึก
     */
    for (let i = 0; i < picked.length; i += 1) {
      const file = picked[i];
      try {
        // อ่านสองทางแล้วรวมกัน เหมือนหน้าอัปทีละใบ — กรอบที่ผู้ดูแลตั้งไว้มาก่อน
        const read = await extractPdfPieces(file);
        const parsed = combineRead(
          parseArrivalText(read.text), matchTemplate(templates, read.text), read.pieces,
        );
        const shipper = matchShipper(parsed.shipperName, options.shippers);
        // เอกสารบางใบพิมพ์รายการตู้ซ้ำสองที่ ตัดตู้ที่ซ้ำออกให้เหลือแถวเดียวพร้อมซีลของแถวแรก
        const { kept, removed } = dedupeContainers(
          parsed.containers.map((c, n) => ({ c, seal: parsed.seals[n] ?? '' })), (x) => x.c,
        );
        parsed.containers = kept.map((x) => x.c);
        parsed.seals = kept.map((x) => x.seal);
        readBls.push({ blNo: parsed.blNo, carrier: parsed.carrier });
        setRows((cur) => cur.map((r, n) => n !== i ? r : {
          ...r,
          status: 'ok',
          message: [
            parsed.templateName && `แบบร่าง ${parsed.templateName}`,
            parsed.carrier && `สายเรือ ${parsed.carrier}`,
            parsed.containers.length && `ตู้ ${parsed.containers.length}`,
            removed.length && `ตัดเลขตู้ซ้ำ ${removed.length}`,
            parsed.shipperName && !shipper && `อ่านชื่อได้ "${parsed.shipperName}" แต่ไม่มีใน Master`,
          ].filter(Boolean).join(' · ') || 'อ่านได้',
          blNo: parsed.blNo,
          parsed,
          shipperId: shipper?.id,
          shipperName: shipper?.name,
        }));
      } catch (error) {
        setRows((cur) => cur.map((r, n) => n !== i ? r : {
          ...r,
          status: 'error',
          message: `อ่านไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
        }));
      }
    }
    // อ่านครบแล้วตรวจเลข BL ซ้ำทีเดียว ให้เห็นในตารางก่อนกดบันทึก
    void refreshDuplicates(readBls);
  }

  /*
   * ใบที่พร้อมบันทึก — ต้องมีทั้งเลข BL และ Shipper
   *
   * ฝั่งเซิร์ฟเวอร์บังคับสองอย่างนี้ ถ้าปล่อยให้กดบันทึกทั้งที่ยังขาด
   * จะไปพังตอนบันทึกแล้วขึ้นว่า "กรุณาเลือก Shipper ให้ครบทุก BL"
   * ซึ่งผู้ใช้ไม่รู้ว่าใบไหนขาด และแก้ในหน้านี้ไม่ได้ด้วย
   */
  const isReady = (r: Row) => Boolean(r.blNo.trim() && r.shipperId);
  const ready = rows.filter((r) => r.status === 'ok' && !r.savedAs && isReady(r));
  const incomplete = rows.filter((r) => r.status === 'ok' && !r.savedAs && !isReady(r));

  const patch = (i: number, next: Partial<Row>) =>
    setRows((cur) => cur.map((r, n) => (n === i ? { ...r, ...next } : r)));

  async function saveAll() {
    /*
     * เลข BL ซ้ำ — ตรวจใหม่ด้วยค่าล่าสุด (อาจแก้เลขในตารางไปแล้ว) แล้วถามยืนยันครั้งเดียวทั้งชุด
     * ยกเลิกก็ไม่บันทึกใบไหนเลย ให้กลับไปแก้หรือเอาใบที่ซ้ำออกก่อน
     */
    const latest = await refreshDuplicates(rows.map((r) => ({
      blNo: r.blNo, carrier: r.parsed?.carrier ?? '', saved: Boolean(r.savedAs),
    })));
    const dupRows = rows.filter((r) => r.status === 'ok' && !r.savedAs && isReady(r)
      && !isBlDuplicateExempt(r.parsed?.carrier) && latest.has(normalizeBlNo(r.blNo)));
    if (dupRows.length) {
      const list = dupRows.map((r) => `${r.blNo.trim()} — ซ้ำกับ ${latest.get(normalizeBlNo(r.blNo))}`).join('\n');
      if (!window.confirm(`เลข BL ซ้ำ ${dupRows.length} ใบ:\n${list}\n\nต้องการบันทึกทั้งหมดต่อหรือไม่`)) return;
    }

    setBusy(true);
    /*
     * บันทึกทีละใบตามลำดับ ไม่ยิงพร้อมกัน
     * เลขงานออกจากตัวนับที่ล็อกแถวไว้ ยิงพร้อมกันจะไปรอคิวกันเองอยู่ดี
     * และถ้าใบไหนพลาด ใบที่เหลือยังบันทึกต่อได้ ไม่ล้มทั้งชุด
     */
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.status !== 'ok' || row.savedAs || !isReady(row)) continue;

      const parsed = row.parsed!;
      const fd = new FormData();
      fd.set('sourceType', sourceType);
      fd.set('file', row.file);
      fd.set('vessel', parsed.vessel || '-');
      fd.set('voyage', parsed.voyage);
      fd.set('eta', parsed.eta);
      fd.set('blType', parsed.blType || 'SWB');
      fd.set('shipline', parsed.carrier);
      fd.set('originPort', parsed.portOfLoading);
      fd.set('product', 'รถยนต์เก่าใช้แล้ว');
      fd.set('unitAmount', parsed.unitAmount);
      fd.set('grossWeight', parsed.grossWeight);
      fd.set('demDays', defaults.demDays);
      fd.set('detDays', defaults.detDays);
      if (defaults.jobTypeId) fd.set('jobTypeId', defaults.jobTypeId);
      if (defaults.consigneeId) fd.set('consigneeId', defaults.consigneeId);
      if (defaults.notifyId) fd.set('notifyPartyId', defaults.notifyId);
      if (defaults.portId) fd.set('portId', defaults.portId);
      // ผู้ใช้ยืนยันเลข BL ซ้ำไปแล้วข้างบน
      if (dupRows.includes(row)) fd.set('allowDuplicateBl', '1');
      // ใช้ค่าที่ผู้ใช้แก้แล้ว ไม่ใช่ค่าที่อ่านได้ดิบ ๆ
      fd.set('blRows', JSON.stringify([{
        blNo: row.blNo.trim(),
        shipperId: row.shipperId ?? '',
        shipperName: row.shipperName ?? '',
      }]));
      fd.set('containerRows', JSON.stringify(parsed.containers.map((c, n) => ({
        containerNo: c,
        containerType: defaults.containerType,
        sealNo: parsed.seals[n] ?? '',
      }))));

      try {
        const jobNo = await action(fd);
        setRows((cur) => cur.map((r, n) => n === i
          ? { ...r, savedAs: String(jobNo ?? ''), saveError: undefined } : r));
      } catch (error) {
        setRows((cur) => cur.map((r, n) => n === i
          ? { ...r, saveError: error instanceof Error ? error.message : String(error) } : r));
      }
    }
    setBusy(false);
  }

  const savedCount = rows.filter((r) => r.savedAs).length;

  return (
    <div className="batch">
      <div className="section-title">
        รับงานหลายใบพร้อมกัน — {sourceType === 'AN' ? 'Arrival Notice' : 'Bill of Lading'}
      </div>
      <label className="drop-zone">
        เลือกไฟล์ PDF ได้หลายไฟล์พร้อมกัน · หนึ่งไฟล์เป็นหนึ่งงาน
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={busy}
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
                  <th className="batch-col-bl">BL No.</th>
                  <th className="batch-col-shipper">Shipper</th>
                  <th>เรือ / เที่ยว</th>
                  <th>ETA</th>
                  <th>ตู้</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.file.name}-${i}`} className={r.savedAs ? 'batch-saved' : undefined}>
                    <td className="col-no">{i + 1}</td>
                    <td className="batch-name">
                      {/* กดดูไฟล์ก่อนแก้ ไม่ต้องเปิดจากโฟลเดอร์เอง */}
                      <button
                        type="button"
                        className="cell-link batch-preview"
                        onClick={() => setPreview({ url: URL.createObjectURL(r.file), name: r.file.name })}
                      >
                        {r.file.name}
                      </button>
                    </td>
                    <td>
                      {r.savedAs ? r.blNo : (
                        <input
                          className={`batch-input${dupOf(r) ? ' is-dup' : ''}`}
                          value={r.blNo}
                          placeholder="กรอกเลข BL"
                          disabled={busy}
                          onChange={(e) => patch(i, { blNo: e.target.value })}
                          onBlur={() => void refreshDuplicates(rows.map((x) => ({
                            blNo: x.blNo, carrier: x.parsed?.carrier ?? '', saved: Boolean(x.savedAs),
                          })))}
                        />
                      )}
                      {!r.savedAs && dupOf(r) ? <small className="dup-note">⚠️ BL ซ้ำกับ {dupOf(r)}</small> : null}
                    </td>
                    <td>
                      {r.savedAs ? (r.shipperName ?? '-') : (
                        <div className="batch-shipper">
                          <SearchSelect
                            choices={options.shippers}
                            value={r.shipperId ?? ''}
                            placeholder="พิมพ์ค้นหา Shipper"
                            onChange={(id) => patch(i, {
                              shipperId: id,
                              shipperName: options.shippers.find((o) => o.id === id)?.name ?? '',
                            })}
                          />
                          {/* Shipper ที่ยังไม่มีในระบบ เพิ่มแล้วเลือกให้แถวนี้เลย */}
                          {r.shipperId ? null : (
                            <QuickAddMaster
                              type="shippers"
                              onAdded={({ id, name }) => patch(i, { shipperId: id, shipperName: name })}
                            />
                          )}
                        </div>
                      )}
                    </td>
                    <td>{[r.parsed?.vessel, r.parsed?.voyage].filter(Boolean).join(' / ') || '-'}</td>
                    <td>{r.parsed?.eta || '-'}</td>
                    <td>{r.parsed?.containers.length || '-'}</td>
                    <td>
                      {r.savedAs ? <span className="badge approved">{r.savedAs}</span>
                        : r.saveError ? <span className="badge rejected">{r.saveError}</span>
                        : r.status === 'reading' ? <span className="badge pending">กำลังอ่าน…</span>
                        : r.status === 'error' ? <span className="badge rejected">{r.message}</span>
                        : !isReady(r) ? (
                          /* บอกให้ชัดว่าขาดอะไร จะได้รู้ว่าต้องกรอกช่องไหน */
                          <span className="badge pending">
                            ยังขาด: {[
                              !r.blNo.trim() && 'เลข BL',
                              !r.shipperId && 'Shipper',
                            ].filter(Boolean).join(' · ')}
                          </span>
                        )
                        : <span className="badge neutral">{r.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="batch-foot">
            <span>
              พร้อมบันทึก {ready.length} ใบ
              {incomplete.length ? ` · ยังกรอกไม่ครบ ${incomplete.length} ใบ` : ''}
              {savedCount ? ` · บันทึกแล้ว ${savedCount} ใบ` : ''}
            </span>
            <button
              type="button"
              className="button primary"
              disabled={busy || !ready.length}
              onClick={() => void saveAll()}
            >
              {busy ? 'กำลังบันทึก…' : `บันทึก ${ready.length} ใบที่กรอกครบ`}
            </button>
          </div>
          <p className="batch-note">
            กดชื่อไฟล์เพื่อเปิดดูเอกสาร · แก้เลข BL และเลือก Shipper ได้ในตารางเลย ·
            ระบบเติมค่าตั้งต้นให้เหมือนฟอร์มทีละใบ (Consignee · Notify · Port · DEM/DET ·
            ประเภทงาน) แล้วแก้รายใบทีหลังได้ที่หน้างานคงค้าง ·
            ใบที่ต้องตัดหน้าหรือแก้รายละเอียดมาก ให้ใช้ฟอร์มทีละใบ
          </p>
        </>
      ) : null}

      {/*
        แผงดูไฟล์ — ใช้ตัวอ่าน PDF ของเบราว์เซอร์ ไฟล์ยังอยู่ในเครื่อง
        ปิดแล้วคืน blob URL ไม่งั้นหน่วยความจำค้างสะสมเมื่อเปิดหลายใบ
      */}
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
                <small>ตรวจเอกสารก่อนบันทึก</small>
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
