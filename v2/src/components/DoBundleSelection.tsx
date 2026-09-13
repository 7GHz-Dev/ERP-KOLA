'use client';

import { createContext, useActionState, useContext, useState } from 'react';
import { MergeEofficeButton } from './MergeEofficeButton';
import { ConfirmSubmit } from './Interactions';
import { markDoExchangedBatch } from '@/lib/actions/do-exchange-batch';

const Selection = createContext<{ ids: string[]; toggle: (id: string) => void }>({ ids: [], toggle: () => {} });

export function DoBundleSelection({ ids, readyIds, children, enabled }: { ids: string[]; readyIds: string[]; children: React.ReactNode; enabled: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [state, sendAction, pending] = useActionState(markDoExchangedBatch, { error: '', message: '' });
  const chosen = ids.filter(id => selected.includes(id));
  const unready = chosen.filter(id => !readyIds.includes(id));
  return <Selection.Provider value={{ ids: chosen, toggle: id => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]) }}>
    <fieldset className="do-pay-fieldset" disabled={pending}>
    {enabled ? <div className="toolbar do-pay-selection">
      <label><input type="checkbox" checked={ids.length > 0 && chosen.length === ids.length} disabled={!ids.length}
        onChange={event => setSelected(event.target.checked ? ids : [])} /> เลือกทั้งหมด</label>
      <b>เลือก {chosen.length} รายการ</b>
      <MergeEofficeButton jobIds={chosen} kind="do" />
      <MergeEofficeButton jobIds={chosen} kind="doPlain" />
      <MergeEofficeButton jobIds={chosen} kind="doUploaded" />
      <form action={sendAction}>
        {chosen.map(id => <input key={id} type="hidden" name="jobId" value={id} />)}
        {chosen.length > 0 && !unready.length ? <ConfirmSubmit
          label={`ส่งแลก DO แล้ว (${chosen.length} รายการ)`} tone="primary"
          confirm={`ส่งชุดแลก DO ให้สายเรือแล้วทั้ง ${chosen.length} รายการที่เลือกใช่ไหม`}
          detail="รายการจะย้ายไปแท็บ ส่งแลก DO แล้ว พร้อมบันทึกผู้ดำเนินการและเวลาส่งของแต่ละงาน" />
          : <button className="button tiny primary" type="button" disabled>ส่งแลก DO แล้ว</button>}
      </form>
      {unready.length ? <span className="badge pending">ต้องรวมชุดอีก {unready.length} รายการก่อนส่ง</span> : null}
      {chosen.length ? <button className="button tiny" type="button" onClick={() => setSelected([])}>ล้างที่เลือก</button> : null}
    </div> : null}
    {pending ? <p role="status">กำลังบันทึกการส่งแลก DO…</p> : null}
    {state.error ? <p className="drawer-note warn" role="alert">{state.error}</p> : null}
    {state.message ? <p className="do-pay-done" role="status">{state.message}</p> : null}
    {children}
    </fieldset>
  </Selection.Provider>;
}

export function DoBundleCheckbox({ id, label }: { id: string; label: string }) {
  const selection = useContext(Selection);
  return <input type="checkbox" checked={selection.ids.includes(id)} onChange={() => selection.toggle(id)} aria-label={`เลือก ${label}`} />;
}
