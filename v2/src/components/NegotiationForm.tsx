'use client';

import { useState } from 'react';
import { saveNegotiation } from '@/lib/actions/sale';
import { baht } from '@/lib/sale/pricing';

type Item = { id: string; lineNo: number; code: string | null; description: string; quantity: number; requestedAmount: number; agreedAmount: number | null; shipmeNote: string | null; saleNote: string | null };

/**
 * ตารางเจรจาค่าใช้จ่ายพิเศษ — ยอดที่ SHIPME ขอ เทียบกับยอดที่ตกลงได้ต่อรายการ
 * กด "ยอมรับตามที่ขอ" เพื่อใส่ยอดเดียวกันให้ทันที · ส่วนต่างรวมคำนวณสดด้านล่าง
 */
export function NegotiationForm({ chargeId, items, saleNote, editable }: { chargeId: string; items: Item[]; saleNote: string; editable: boolean }) {
  const [rows, setRows] = useState(items.map((i) => ({ id: i.id, agreed: i.agreedAmount === null ? '' : String(i.agreedAmount), note: i.saleNote ?? '' })));
  const set = (k: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
  const requested = items.reduce((s, i) => s + i.requestedAmount, 0);
  const agreedSum = rows.reduce((s, r) => s + (num(r.agreed) ?? 0), 0);
  const filled = rows.every((r) => num(r.agreed) !== null);

  return (
    <form action={saveNegotiation} className="nego-form">
      <input type="hidden" name="chargeId" value={chargeId} />
      <input type="hidden" name="items" value={JSON.stringify(rows.map((r) => ({ id: r.id, agreedAmount: r.agreed, saleNote: r.note })))} />
      <div className="table-wrap">
        <table className="data nego-table">
          <thead>
            <tr><th>#</th><th>รายการ (จาก SHIPME)</th><th className="num">ยอดที่ขอ</th><th className="num">ยอดที่ตกลง</th><th>หมายเหตุการเจรจา</th></tr>
          </thead>
          <tbody>
            {items.map((it, k) => {
              const a = num(rows[k].agreed);
              const diff = a === null ? null : a - it.requestedAmount;
              return (
                <tr key={it.id}>
                  <td>{it.lineNo}</td>
                  <td className="col-wrap">
                    <b>{it.description}</b>{it.code ? <small className="muted"> · {it.code}</small> : null}
                    {it.quantity !== 1 ? <small className="muted"> · จำนวน {it.quantity}</small> : null}
                    {it.shipmeNote ? <div className="muted"><small>SHIPME: {it.shipmeNote}</small></div> : null}
                  </td>
                  <td className="num">{baht(it.requestedAmount)}</td>
                  <td className="num">
                    {editable ? (
                      <span className="nego-agreed">
                        <input inputMode="decimal" value={rows[k].agreed} placeholder="—" onChange={(e) => set(k, { agreed: e.target.value })} />
                        <button type="button" className="button tiny" onClick={() => set(k, { agreed: String(it.requestedAmount) })} title="ยอมรับตามที่ขอ">=</button>
                      </span>
                    ) : <b>{a === null ? '-' : baht(a)}</b>}
                    {diff !== null && diff !== 0 ? <small className={diff < 0 ? 'nego-save' : 'nego-more'}>{diff < 0 ? 'ลด ' : 'เพิ่ม '}{baht(Math.abs(diff))}</small> : null}
                  </td>
                  <td>
                    {editable
                      ? <input value={rows[k].note} placeholder="เช่น ต่อรองเหลือครึ่งเพราะ…" onChange={(e) => set(k, { note: e.target.value })} />
                      : <span>{rows[k].note || '-'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="num"><b>รวม</b></td>
              <td className="num"><b>{baht(requested)}</b></td>
              <td className="num"><b>{filled ? baht(agreedSum) : '-'}</b>
                {filled && agreedSum !== requested ? <small className={agreedSum < requested ? 'nego-save' : 'nego-more'}>{agreedSum < requested ? 'ประหยัด ' : 'เพิ่ม '}{baht(Math.abs(agreedSum - requested))}</small> : null}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <label className="price-note">สรุปการเจรจา (คุยกับใคร ตกลงอย่างไร)
        <textarea name="saleNote" rows={3} defaultValue={saleNote} readOnly={!editable} />
      </label>
      {editable ? (
        <div className="price-actions">
          <button type="button" className="button tiny" onClick={() => setRows((rs) => rs.map((r, i) => ({ ...r, agreed: String(items[i].requestedAmount) })))}>ยอมรับตามที่ขอทุกรายการ</button>
          <button type="submit" className="button primary">บันทึกผลการเจรจา</button>
        </div>
      ) : null}
    </form>
  );
}
