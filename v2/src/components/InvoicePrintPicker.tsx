'use client';

import { useState } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * เลือกเลข BL หลายใบแล้วเปิด Invoice DO รวมกันเพื่อสั่งพิมพ์
 *
 * ฝ่ายบัญชีต้องพิมพ์ทีละหลายใบต่อรอบ ถ้าเปิดทีละไฟล์แล้วสั่งพิมพ์
 * ต้องกดผ่านหน้าต่างพิมพ์ใหม่ทุกใบ ซึ่งช้าและพลาดง่ายว่าใบไหนพิมพ์ไปแล้ว
 * รวมเป็นไฟล์เดียวแล้วสั่งพิมพ์รอบเดียวจบ
 *
 * เก็บลำดับที่ติ๊กไว้ หน้าในไฟล์รวมจึงเรียงตามที่เลือก ไม่ใช่ตามที่ตารางเรียง
 */

export type InvoiceRow = {
  jobId: string; jobNo: string; blNo: string | null;
  eta: string | null; shipline: string | null; consigneeName: string | null;
  fileId: string; fileName: string; uploadedAt: string | Date;
};

export function InvoicePrintPicker({ rows }: { rows: InvoiceRow[] }) {
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((v) => v !== id) : [...cur, id]));

  const allPicked = rows.length > 0 && picked.length === rows.length;
  const href = `/api/invoice-print?${picked.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`;

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-pick">
                <input
                  type="checkbox"
                  className="pick-box"
                  aria-label="เลือกทั้งหมด"
                  checked={allPicked}
                  onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.fileId) : [])}
                />
              </th>
              <th>ลำดับพิมพ์</th>
              <th>BL No.</th>
              <th>Consignee</th>
              <th>SHIPLINE</th>
              <th>ETA</th>
              <th>ไฟล์ Invoice DO</th>
              <th>อัปโหลดเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => {
              const at = picked.indexOf(r.fileId);
              return (
                <tr key={r.fileId} className={at >= 0 ? 'row-picked' : undefined}>
                  <td className="col-pick">
                    <input
                      type="checkbox"
                      className="pick-box"
                      aria-label={`เลือก ${r.blNo ?? r.jobNo}`}
                      checked={at >= 0}
                      onChange={() => toggle(r.fileId)}
                    />
                  </td>
                  {/* บอกลำดับที่จะพิมพ์ เพราะเรียงตามที่ติ๊ก ไม่ใช่ตามที่ตารางแสดง */}
                  <td>{at >= 0 ? at + 1 : ''}</td>
                  <td><b>{r.blNo ?? '-'}</b></td>
                  <td>{r.consigneeName ?? '-'}</td>
                  <td>{r.shipline ?? '-'}</td>
                  <td>{formatDate(r.eta)}</td>
                  <td>
                    <a className="cell-link" href={`/files/${r.fileId}`} target="_blank" rel="noreferrer">
                      {r.fileName}
                    </a>
                  </td>
                  <td>{formatDateTime(r.uploadedAt)}</td>
                </tr>
              );
            }) : (
              <tr><td colSpan={8} className="drawer-empty">ไม่พบ BL ที่มีไฟล์ Invoice DO</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {picked.length ? (
        <div className="bulk-bar" role="status">
          <span>เลือกไว้ {picked.length} ใบ</span>
          <button type="button" className="button tiny" onClick={() => setPicked([])}>
            ล้างที่เลือก
          </button>
          {/*
            เปิดแท็บใหม่แล้วให้ตัวอ่าน PDF ของเบราว์เซอร์สั่งพิมพ์
            ไม่ใช้ window.print() เพราะสั่งพิมพ์ไฟล์ในแท็บอื่นไม่ได้
          */}
          <a className="button primary" href={href} target="_blank" rel="noreferrer">
            เปิดรวม {picked.length} ใบเพื่อพิมพ์
          </a>
        </div>
      ) : null}
    </>
  );
}
