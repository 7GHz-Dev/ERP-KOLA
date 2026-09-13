'use client';

import Link from 'next/link';
import { createContext, useContext, useState } from 'react';

const Selection = createContext<{ selected: string[]; toggle: (id: string) => void }>({ selected: [], toggle: () => {} });

export function DoPaySelection({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const visible = ids.filter(id => selected.includes(id));
  const params = new URLSearchParams();
  visible.forEach(id => params.append('jobId', id));
  return (
    <Selection.Provider value={{ selected: visible, toggle: id => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]) }}>
      <div className="toolbar do-pay-selection">
        <label><input type="checkbox" checked={ids.length > 0 && visible.length === ids.length}
          disabled={!ids.length} onChange={event => setSelected(event.target.checked ? ids : [])} /> เลือกทั้งหมด ({ids.length})</label>
        <span>เลือก {visible.length} รายการ</span>
        {visible.length ? <Link className="button primary" href={`/may/do-pay/batch?${params}`}>ดู Invoice DO ที่เลือก</Link> : <span className="badge pending">เลือกรายการเพื่อดูหลายไฟล์</span>}
        {visible.length ? <button className="button tiny" type="button" onClick={() => setSelected([])}>ล้างที่เลือก</button> : null}
      </div>
      {children}
    </Selection.Provider>
  );
}

export function DoPayCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useContext(Selection);
  return <input type="checkbox" aria-label={`เลือก ${label}`} checked={selected.includes(id)} onChange={() => toggle(id)} />;
}
