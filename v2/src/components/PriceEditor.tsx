'use client';

import { useMemo, useState } from 'react';
import { savePrice } from '@/lib/actions/sale';
import { PRICE_PRESETS, UNIT_LABEL, baht, lineAmount, priceTotal, type PriceLine, type PriceUnit } from '@/lib/sale/pricing';

type Row = { description: string; unit: PriceUnit; quantity: string; unitPrice: string };

const toRow = (l: PriceLine): Row => ({ description: l.description, unit: l.unit, quantity: String(l.quantity), unitPrice: String(l.unitPrice) });
const num = (s: string) => Number(s.replace(/,/g, '')) || 0;

/**
 * ตารางรายการราคาเก็บลูกค้า — ชื่อรายการ · หน่วย (ต่อตู้ / ต่องาน) · จำนวน · ราคาต่อหน่วย → ยอด
 * หน่วย "ต่อตู้" ใส่จำนวนตู้ของงานให้เอง · ยอดรวมคำนวณสดระหว่างพิมพ์
 */
export function PriceEditor({
  jobId, containers, initial, note, confirmed, copyFrom,
}: {
  jobId: string; containers: number; initial: PriceLine[]; note: string; confirmed: boolean;
  copyFrom: { jobNo: string; lines: PriceLine[] } | null;
}) {
  const blank = (unit: PriceUnit = 'JOB'): Row => ({ description: '', unit, quantity: String(unit === 'CONTAINER' ? containers || 1 : 1), unitPrice: '' });
  const [rows, setRows] = useState<Row[]>(initial.length ? initial.map(toRow) : [blank()]);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const parsed = useMemo(() => rows.map((r) => ({ ...r, q: num(r.quantity), p: num(r.unitPrice) })), [rows]);
  const total = priceTotal(parsed.map((r) => ({ quantity: r.q, unitPrice: r.p })));
  const payload = JSON.stringify(rows.map((r) => ({ description: r.description, unit: r.unit, quantity: r.quantity, unitPrice: r.unitPrice })));

  return (
    <form action={savePrice} className="price-editor">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="lines" value={payload} />
      <datalist id="price-presets">{PRICE_PRESETS.map((p) => <option key={p.description} value={p.description} />)}</datalist>

      <div className="table-wrap">
        <table className="data price-table">
          <thead>
            <tr><th>#</th><th>รายการ</th><th>หน่วย</th><th className="num">จำนวน</th><th className="num">ราคาต่อหน่วย (บาท)</th><th className="num">ยอด (บาท)</th><th /></tr>
          </thead>
          <tbody>
            {parsed.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input list="price-presets" value={r.description} placeholder="พิมพ์หรือเลือกรายการ"
                    onChange={(e) => {
                      const preset = PRICE_PRESETS.find((p) => p.description === e.target.value);
                      set(i, preset && !r.unitPrice
                        ? { description: e.target.value, unit: preset.unit, quantity: String(preset.unit === 'CONTAINER' ? containers || 1 : 1) }
                        : { description: e.target.value });
                    }} />
                </td>
                <td>
                  <select value={r.unit} onChange={(e) => {
                    const unit = e.target.value as PriceUnit;
                    set(i, { unit, quantity: String(unit === 'CONTAINER' ? containers || 1 : 1) });
                  }}>
                    {(Object.keys(UNIT_LABEL) as PriceUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                  </select>
                </td>
                <td className="num"><input inputMode="decimal" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                <td className="num"><input inputMode="decimal" value={r.unitPrice} placeholder="0.00" onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
                <td className="num"><b>{baht(lineAmount({ quantity: r.q, unitPrice: r.p }))}</b></td>
                <td>
                  <button type="button" className="icon-button" title="ลบแถว"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [blank()]))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className="num"><b>รวมทั้งสิ้น</b></td><td className="num price-total">{baht(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      <div className="price-tools">
        <button type="button" className="button tiny" onClick={() => setRows((rs) => [...rs, blank()])}>+ เพิ่มรายการ</button>
        <button type="button" className="button tiny" onClick={() => setRows((rs) => [...rs, blank('CONTAINER')])}>+ เพิ่มรายการต่อตู้</button>
        {copyFrom ? (
          <button type="button" className="button tiny" onClick={() => setRows(copyFrom.lines.map((l) => toRow({
            ...l, quantity: l.unit === 'CONTAINER' ? containers || l.quantity : l.quantity,
          })))}>
            ใช้รายการเดียวกับงาน {copyFrom.jobNo} (ลูกค้าเดียวกัน)
          </button>
        ) : null}
      </div>

      <label className="price-note">หมายเหตุ (ไม่บังคับ)
        <textarea name="note" rows={2} defaultValue={note} />
      </label>

      <div className="price-actions">
        <button type="submit" name="mode" value="draft" className="button">บันทึกร่าง</button>
        <button type="submit" name="mode" value="confirm" className="button primary">✓ ยืนยันราคา {baht(total)} บาท</button>
        <small>
          {confirmed
            ? 'ราคานี้ยืนยันแล้ว — กด "บันทึกร่าง" จะถอนการยืนยัน (ยิงใบขนไม่ได้จนกว่าจะยืนยันใหม่)'
            : 'ต้อง "ยืนยันราคา" ก่อน ทีมจึงยิงใบขนงานนี้ได้'}
        </small>
      </div>
    </form>
  );
}
