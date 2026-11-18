'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { freeLastDate } from '@/lib/free-time';

/**
 * ช่อง DEM / DET ในแผง Upload Invoice of D/O — บังคับกรอกก่อนส่ง Partner (ว่าง = N/A)
 *
 * ปุ่ม Combine ที่หัวข้อ DET: DEM กับ DET ใช้จำนวนวันเดียวกัน (พิมพ์ที่ DEM ช่องเดียว DET ตามให้)
 * Last Date ทั้งคู่ = (ETA + จำนวนวัน) − 1 วัน · แสดงทันทีระหว่างพิมพ์
 */
export function DemDetFields({ eta, demDays, detDays, combined }: {
  eta: string | null; demDays: number | null; detDays: number | null; combined: boolean;
}) {
  const [dem, setDem] = useState(demDays === null ? '' : String(demDays));
  const [det, setDet] = useState(detDays === null ? '' : String(detDays));
  const [combine, setCombine] = useState(combined);
  const detValue = combine ? dem : det;
  const last = (v: string) => (v.trim() && eta ? formatDate(freeLastDate(eta, Number(v))) : null);

  return (
    <>
      <input type="hidden" name="demDetCombined" value={combine ? '1' : '0'} />
      <label className="do-cell">
        <span>DEM FREE (วัน) *{combine ? ' · Combine' : ''}</span>
        <input type="number" min={0} name="demDays" placeholder="N/A" value={dem} onChange={(e) => setDem(e.target.value)} />
        {last(dem) ? <small className="do-sub">Last Date of DEM {last(dem)}</small> : null}
      </label>
      <div className="do-cell">
        <span className="do-det-head">
          DET FREE (วัน) *
          <button
            type="button"
            className={`button tiny${combine ? ' primary' : ''}`}
            aria-pressed={combine}
            title="Combine: DEM กับ DET ใช้จำนวนวันเดียวกัน"
            onClick={() => setCombine((c) => !c)}
          >
            {combine ? '✓ Combine' : 'Combine'}
          </button>
        </span>
        {combine ? (
          <>
            <input type="hidden" name="detDays" value={detValue} />
            <input type="number" value={detValue} placeholder="= DEM" disabled aria-label="DET (Combine = DEM)" />
          </>
        ) : (
          <input type="number" min={0} name="detDays" placeholder="N/A" value={det} onChange={(e) => setDet(e.target.value)} />
        )}
        {last(detValue) ? <small className="do-sub">Last Date of DET {last(detValue)}</small> : null}
      </div>
    </>
  );
}
