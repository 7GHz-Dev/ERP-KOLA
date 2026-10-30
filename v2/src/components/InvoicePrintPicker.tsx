'use client';

import { useEffect, useState } from 'react';
import { formatDate, formatDateTime } from '@/lib/format';
import { FilterTh, TableFilterScope } from '@/components/TableFilter';

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

  /*
   * แถวที่มองเห็นหลังกรองหัวคอลัมน์ — เลือกทั้งหมดเลือกเฉพาะแถวที่เห็น
   * และทิ้งใบที่เลือกไว้แต่ถูกกรองออก ไม่ให้ไปโผล่ในไฟล์รวมโดยมองไม่เห็นว่าเลือกไว้
   */
  const [shown, setShown] = useState<string[] | null>(null);
  useEffect(() => {
    const sync = () => {
      const ids = rows.map((r) => r.fileId)
        .filter((id) => !document.querySelector(`tr[data-file="${CSS.escape(id)}"]`)?.hasAttribute('hidden'));
      setShown((cur) => (cur && cur.join() === ids.join() ? cur : ids));
      setPicked((cur) => { const next = cur.filter((id) => ids.includes(id)); return next.length === cur.length ? cur : next; });
    };
    document.addEventListener('kola:table-filtered', sync);
    return () => document.removeEventListener('kola:table-filtered', sync);
  }, [rows]);
  const visible = shown ?? rows.map((r) => r.fileId);
  const allPicked = visible.length > 0 && visible.every((id) => picked.includes(id));
  const href = `/api/invoice-print?${picked.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`;

  return (
    <>
      <TableFilterScope storageKey="/account/invoice-print">
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
                  onChange={(e) => setPicked(e.target.checked ? visible : [])}
                />
              </th>
              <FilterTh label="ลำดับพิมพ์" filter={false} />
              <FilterTh label="BL No." />
              <FilterTh label="Consignee" />
              <FilterTh label="SHIPLINE" />
              <FilterTh label="ETA" />
              <FilterTh label="ไฟล์ Invoice DO" />
              <FilterTh label="อัปโหลดเมื่อ" />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => {
              const at = picked.indexOf(r.fileId);
              return (
                <tr key={r.fileId} data-file={r.fileId} className={at >= 0 ? 'row-picked' : undefined}>
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
      </TableFilterScope>

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
