'use client';

import { useState } from 'react';
import type { Option } from '@/lib/queries/master';
import { extractPdfText, parseArrivalText } from '@/lib/parse-arrival';
import { matchShipper } from '@/lib/match-shipper';

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
 * ไม่รองรับการตัดหน้าและแก้รายละเอียดรายใบ ใบที่ต้องแก้เยอะให้ใช้ฟอร์มทีละใบแทน
 * เพราะถ้าทำให้แก้ได้ครบทุกช่องในหน้าเดียว จะกลายเป็น 20 ฟอร์มซ้อนกันซึ่งอ่านยากกว่าเดิม
 */

type Row = {
  file: File;
  status: 'reading' | 'ok' | 'thin' | 'error';
  message: string;
  /** ค่าที่อ่านได้ ใช้ทั้งแสดงในตารางและส่งขึ้นเซิร์ฟเวอร์ */
  parsed?: ReturnType<typeof parseArrivalText>;
  shipperId?: string;
  shipperName?: string;
  /** ผลหลังกดบันทึก */
  savedAs?: string;
  saveError?: string;
};

export function IntakeBatch({
  sourceType, options, defaults, action,
}: {
  sourceType: 'AN' | 'BL';
  options: { shippers: Option[] };
  defaults: { containerType: string; jobTypeId: string | null; consigneeId: string | null;
              notifyId: string | null; portId: string | null; demDays: string; detDays: string };
  action: (formData: FormData) => Promise<string | void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function readAll(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...list].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!picked.length) return;

    setRows(picked.map((file) => ({ file, status: 'reading', message: 'กำลังอ่าน…' })));

    /*
     * อ่านทีละไฟล์ ไม่ยิงพร้อมกันทั้งหมด
     * pdf.js กินหน่วยความจำมากต่อไฟล์ เปิด 20 ไฟล์พร้อมกันแท็บค้างได้
     * และผู้ใช้เห็นความคืบหน้าทีละใบอยู่แล้ว จึงไม่ได้ช้าลงในความรู้สึก
     */
    for (let i = 0; i < picked.length; i += 1) {
      const file = picked[i];
      try {
        const parsed = parseArrivalText(await extractPdfText(file));
        const shipper = matchShipper(parsed.shipperName, options.shippers);
        // ต้องมีเลข BL เป็นอย่างน้อย ไม่งั้นบันทึกไม่ผ่านอยู่ดี
        const thin = !parsed.blNo;
        setRows((cur) => cur.map((r, n) => n !== i ? r : {
          ...r,
          status: thin ? 'thin' : 'ok',
          message: thin
            ? 'อ่านไม่พบเลข BL — ใบนี้ต้องใช้ฟอร์มทีละใบ'
            : [
                parsed.carrier && `สายเรือ ${parsed.carrier}`,
                parsed.containers.length && `ตู้ ${parsed.containers.length}`,
                shipper && `Shipper ${shipper.name}`,
              ].filter(Boolean).join(' · ') || 'อ่านได้',
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
  }

  /** ใบที่พร้อมบันทึก — อ่านเจอเลข BL และยังไม่เคยบันทึกสำเร็จ */
  const ready = rows.filter((r) => r.status === 'ok' && !r.savedAs);

  async function saveAll() {
    setBusy(true);
    /*
     * บันทึกทีละใบตามลำดับ ไม่ยิงพร้อมกัน
     * เลขงานออกจากตัวนับที่ล็อกแถวไว้ ยิงพร้อมกันจะไปรอคิวกันเองอยู่ดี
     * และถ้าใบไหนพลาด ใบที่เหลือยังบันทึกต่อได้ ไม่ล้มทั้งชุด
     */
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.status !== 'ok' || row.savedAs) continue;

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
      fd.set('blRows', JSON.stringify([{
        blNo: parsed.blNo,
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
                  <th>BL No.</th>
                  <th>เรือ / เที่ยว</th>
                  <th>ETA</th>
                  <th>ตู้</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.file.name}-${i}`}>
                    <td className="col-no">{i + 1}</td>
                    <td className="batch-name">{r.file.name}</td>
                    <td>{r.parsed?.blNo || '-'}</td>
                    <td>{[r.parsed?.vessel, r.parsed?.voyage].filter(Boolean).join(' / ') || '-'}</td>
                    <td>{r.parsed?.eta || '-'}</td>
                    <td>{r.parsed?.containers.length || '-'}</td>
                    <td>
                      {r.savedAs ? <span className="badge approved">{r.savedAs}</span>
                        : r.saveError ? <span className="badge rejected">{r.saveError}</span>
                        : r.status === 'reading' ? <span className="badge pending">กำลังอ่าน…</span>
                        : r.status === 'error' ? <span className="badge rejected">{r.message}</span>
                        : r.status === 'thin' ? <span className="badge pending">{r.message}</span>
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
              {savedCount ? ` · บันทึกแล้ว ${savedCount} ใบ` : ''}
            </span>
            <button
              type="button"
              className="button primary"
              disabled={busy || !ready.length}
              onClick={() => void saveAll()}
            >
              {busy ? 'กำลังบันทึก…' : `บันทึกทั้งหมด ${ready.length} ใบ`}
            </button>
          </div>
          <p className="batch-note">
            ระบบเติมค่าตั้งต้นให้เหมือนฟอร์มทีละใบ (Consignee · Notify · Port · DEM/DET ·
            ประเภทงาน) แล้วแก้รายใบทีหลังได้ที่หน้างานคงค้าง ·
            ใบที่ต้องตัดหน้าหรือแก้รายละเอียดมาก ให้ใช้ฟอร์มทีละใบ
          </p>
        </>
      ) : null}
    </div>
  );
}
