'use client';

import { createContext, useActionState, useContext, useMemo, useState } from 'react';
import { ConfirmSubmit } from './Interactions';
import { createDoPlan } from '@/lib/actions/do-plan';
import { missingSummary, planReadiness, type PlanCandidate } from '@/lib/do-plan';

const Selection = createContext<{ selected: string[]; toggle: (id: string) => void }>({
  selected: [], toggle: () => {},
});

/** วันนี้ตามเครื่องผู้ใช้ ในรูปแบบที่ input[type=date] รับได้ */
function today() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * แถบสร้าง Plan แลก DO เหนือตารางฝั่ง "รอส่ง Partner"
 *
 * เลือกวันที่นัดไปแลก แล้วติ๊กใบที่จะส่งไปด้วยกัน กดครั้งเดียวได้ทั้งชุด
 * ปุ่มส่งทีละใบในแผงกรอกยังอยู่ครบ ใบด่วนที่ไม่รอรอบก็ยังส่งเดี่ยวได้เหมือนเดิม
 *
 * ใบที่ยังกรอกไม่ครบติ๊กไม่ได้เลย ไม่ใช่ติ๊กได้แล้วค่อยไปโดนปฏิเสธตอนกดส่ง
 * เพราะเลือกทีละหลายสิบใบ ถ้าไปรู้ตอนกดส่งจะไม่รู้ว่าใบไหนที่ต้องกลับไปแก้
 */
export function DoPlanSelection({
  candidates, children,
}: { candidates: PlanCandidate[]; children: React.ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [planDate, setPlanDate] = useState(today());
  const [state, submit, pending] = useActionState(createDoPlan, { error: '', message: '' });

  const ready = useMemo(
    () => candidates.filter((job) => planReadiness(job).ready).map((job) => job.id),
    [candidates],
  );
  const chosen = ready.filter((id) => selected.includes(id));
  const chosenJobs = candidates.filter((job) => chosen.includes(job.id));
  const problem = missingSummary(chosenJobs);
  const notReady = candidates.length - ready.length;

  return (
    <Selection.Provider
      value={{
        selected: chosen,
        toggle: (id) => setSelected((previous) =>
          previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]),
      }}
    >
      <fieldset className="do-plan-fieldset" disabled={pending}>
        <form className="toolbar do-plan-bar" action={submit}>
          {chosen.map((id) => <input key={id} type="hidden" name="jobId" value={id} />)}

          <label className="do-plan-date">
            วันที่ Plan แลก DO
            <input
              type="date" name="planDate" value={planDate} required
              onChange={(event) => setPlanDate(event.target.value)}
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={ready.length > 0 && chosen.length === ready.length}
              disabled={!ready.length}
              onChange={(event) => setSelected(event.target.checked ? ready : [])}
            /> เลือกทั้งหมดที่พร้อม ({ready.length})
          </label>
          <b>เลือก {chosen.length} รายการ</b>

          <input
            className="do-plan-note" type="text" name="note" maxLength={500}
            placeholder="หมายเหตุของ Plan (ไม่บังคับ)"
          />

          {chosen.length && !problem ? (
            <ConfirmSubmit
              label={`สร้าง Plan แลก DO (${chosen.length} รายการ)`}
              tone="primary"
              confirm={`สร้าง Plan วันที่ ${planDate} จากรายการที่เลือกทั้ง ${chosen.length} รายการใช่ไหม`}
              detail="รายการทั้งชุดจะถูกส่งให้ Partner ทันที แล้วไปโผล่ที่หน้า Plan แลก DO ของ ANN และ MAY"
            />
          ) : (
            <button className="button tiny primary" type="button" disabled>สร้าง Plan แลก DO</button>
          )}

          {chosen.length ? (
            <button className="button tiny" type="button" onClick={() => setSelected([])}>ล้างที่เลือก</button>
          ) : null}

          {/* บอกจำนวนที่ยังติ๊กไม่ได้ไว้ตรงนี้ ส่วนว่าขาดอะไรอยู่ที่ช่องเลือกของแถวนั้น */}
          {notReady ? (
            <span className="badge pending">ยังกรอกไม่ครบอีก {notReady} รายการ</span>
          ) : null}
        </form>

        {pending ? <p role="status">กำลังสร้าง Plan…</p> : null}
        {state.error ? <p className="drawer-note warn" role="alert">{state.error}</p> : null}
        {state.message ? <p className="do-pay-done" role="status">{state.message}</p> : null}
        {children}
      </fieldset>
    </Selection.Provider>
  );
}

/**
 * ช่องติ๊กในแถว — ใบที่ยังกรอกไม่ครบจะติ๊กไม่ได้ และบอกไว้ตรงนั้นว่าขาดอะไร
 *
 * เขียนเหตุผลไว้ที่แถวเพราะนั่นคือที่ที่คนมองตอนสงสัยว่า "ทำไมใบนี้ติ๊กไม่ได้"
 * และเป็นแถวเดียวกับที่มีปุ่มกรอกข้อมูลให้กดแก้ต่อได้ทันที
 */
export function DoPlanCheckbox({ job }: { job: PlanCandidate }) {
  const { selected, toggle } = useContext(Selection);
  const check = planReadiness(job);
  if (!check.ready) {
    return (
      <div className="do-plan-blocked">
        <input type="checkbox" disabled aria-label={`${job.label} ยังเลือกไม่ได้`} />
        <small className="client-cell-note bad">ขาด {check.missing.join(' · ')}</small>
      </div>
    );
  }
  return (
    <input
      type="checkbox"
      aria-label={`เลือก ${job.label}`}
      checked={selected.includes(job.id)}
      onChange={() => toggle(job.id)}
    />
  );
}
