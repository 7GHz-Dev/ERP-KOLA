'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { freeLastDate } from '@/lib/free-time';

/**
 * ช่อง DEM / DET ในแผง Upload Invoice of D/O — บังคับกรอกก่อนส่ง Partner (ว่าง = N/A)
 *
 * ปุ่ม Combine ที่หัวข้อ DET: DEM กับ DET ใช้จำนวนวันเดียวกัน (พิมพ์ที่ DEM ช่องเดียว DET ตามให้)
 * Last DEM date = ETA + DEM − 1 · Last DET date = Transport Date + DET − 1 (Combine: ETA + DET − 1) · แสดงทันทีระหว่างพิมพ์
 */
export function DemDetFields({ eta, transportDate, demDays, detDays, combined }: {
  eta: string | null; transportDate?: string | null; demDays: number | null; detDays: number | null; combined: boolean;
}) {
  const [dem, setDem] = useState(demDays === null ? '' : String(demDays));
  const [det, setDet] = useState(detDays === null ? '' : String(detDays));
  const [combine, setCombine] = useState(combined);
  const detValue = combine ? dem : det;
  const last = (v: string, from: string | null | undefined = eta) => (v.trim() && from ? formatDate(freeLastDate(from, Number(v))) : null);
  // DET ปกตินับจาก Transport Date (วันลาก) · Combine นับจาก ETA
  const detFrom = combine ? eta : transportDate ?? null;

  return (
    <>
      <input type="hidden" name="demDetCombined" value={combine ? '1' : '0'} />
      <label className="do-cell">
        <span>DEM FREE (วัน) *{combine ? ' · Combine' : ''}</span>
        <input type="number" min={0} name="demDays" placeholder="N/A" value={dem} onChange={(e) => setDem(e.target.value)} />
        {last(dem) ? <small className="do-sub">Last DEM date {last(dem)}</small> : null}
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
        {last(detValue, detFrom) ? <small className="do-sub">Last DET date {last(detValue, detFrom)}</small>
          : detValue.trim() && !combine ? <small className="do-sub">Last DET date นับจาก Transport Date (วันลาก) + DET − 1</small> : null}
      </div>
    </>
  );
}
