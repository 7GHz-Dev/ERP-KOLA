'use client';

import { useActionState, useRef, useState } from 'react';
import { DoPayPanel } from './DoPayPanel';
import { ConfirmSubmit } from './Interactions';
import { allClaimText, claimAmountInput } from '@/lib/do-claim-batch';
import { markDoClaimedBatch, saveDoPayAmountsBatch } from '@/lib/actions/do-claim-batch';
import type { loadDoPayBatch } from '@/lib/queries/do-files';

export function DoPayBatchForms({ entries }: { entries: NonNullable<Awaited<ReturnType<typeof loadDoPayBatch>>> }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState(markDoClaimedBatch, { error: '', completed: [], message: '' });
  const amountOf = (id: string, original: string | null) => amounts[id] ?? original ?? '';
  const available = entries.filter(({ job }) => !job.doClaimedAt && !state.completed.includes(job.id));
  const chosen = available.filter(({ job }) => selected.includes(job.id));
  const ready = chosen.length > 0 && chosen.every(({ job }) => claimAmountInput(amountOf(job.id, job.doPayAmount)) !== null);
  const allReady = entries.every(({ job }) => claimAmountInput(amountOf(job.id, job.doPayAmount)) !== null);
  const text = allClaimText(entries.map(({ job }) => ({ ...job, amount: amountOf(job.id, job.doPayAmount) })));
  /*
   * บันทึกยอดทุกรายการที่ยังไม่ได้ตั้งเบิก
   *
   * ส่งเฉพาะใบที่ยอดกรอกถูกต้อง ใบที่ยังว่างหรือพิมพ์ผิดจะทำให้ทั้งชุดไม่ผ่าน
   * แต่ปุ่มคัดลอกกดได้ต่อเมื่อครบทุกใบอยู่แล้ว จึงไม่มีทางเจอกรณีนั้นในทางปฏิบัติ
   */
  async function saveAllAmounts() {
    const fd = new FormData();
    for (const { job } of available) {
      const value = amountOf(job.id, job.doPayAmount);
      if (claimAmountInput(value) === null) continue;
      fd.append('jobId', job.id);
      fd.set(`amount:${job.id}`, value);
    }
    if (!fd.getAll('jobId').length) return '';
    const result = await saveDoPayAmountsBatch(fd);
    return result.ok ? ' · บันทึกยอดแล้ว' : ` · บันทึกยอดไม่สำเร็จ: ${result.detail ?? ''}`;
  }

  /*
   * คัดลอกข้อความแล้วบันทึกยอดให้ในปุ่มเดียว เหมือนปุ่มของแผงทีละใบ
   * บันทึกหลังคัดลอกสำเร็จ ถ้าคลิปบอร์ดพลาดผู้ใช้ยังต้องจัดการต่อ แต่ยอดถูกเก็บแล้ว
   */
  async function copyAll() {
    let base: string;
    try { await navigator.clipboard.writeText(text); base = 'คัดลอกข้อความทุกรายการแล้ว'; }
    catch { textArea.current?.focus(); textArea.current?.select(); base = 'เลือกข้อความแล้ว กด Ctrl+C หรือคัดลอกด้วยตนเอง'; }
    setCopyStatus(base);
    setCopyStatus(base + await saveAllAmounts());
  }
  return <div className="do-pay-side do-pay-batch-forms">
    <div className="do-pay-claim">
      <b>ข้อความเบิกทุกรายการ ({entries.length})</b>
      <textarea ref={textArea} className="do-pay-text" rows={6} readOnly value={text} aria-label="ข้อความเบิกทุกรายการ" />
      <button className="button ok do-pay-copy" type="button" disabled={!allReady || pending} onClick={() => void copyAll()}>คัดลอกข้อความ · บันทึกยอดทุกรายการ</button>
      {!allReady ? <p className="do-pay-note">กรอกยอดให้ครบและถูกต้องทุกรายการก่อนคัดลอก</p> : null}
      <p className="do-pay-note" role="status">{copyStatus}</p>
    </div>
    <form action={action} className="do-pay-claim">
      <fieldset disabled={pending} className="do-pay-fieldset">
        <label><input type="checkbox" checked={available.length > 0 && chosen.length === available.length} disabled={!available.length}
          onChange={event => setSelected(event.target.checked ? available.map(({ job }) => job.id) : [])} /> เลือกทั้งหมดที่ยังไม่ตั้งเบิก</label>
        {chosen.map(({ job }) => <span key={job.id}>
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name={`amount:${job.id}`} value={amountOf(job.id, job.doPayAmount)} />
        </span>)}
        <p>เลือก {chosen.length} รายการ</p>
        {ready ? <ConfirmSubmit label={`ตั้งเบิกแล้ว (${chosen.length} รายการ)`} tone="primary"
          confirm={`ยืนยันตั้งเบิก ${chosen.length} รายการที่เลือกใช่ไหม`}
          detail={chosen.map(({ job }) => `${job.jobNo} · BL ${job.blNo ?? '-'}`).join(' / ')} />
          : <p className="do-pay-note">เลือกรายการและกรอกยอดให้ถูกต้องก่อนตั้งเบิก</p>}
      </fieldset>
      {pending ? <p role="status">กำลังบันทึกการตั้งเบิก…</p> : null}
      {state.error ? <p className="drawer-note warn" role="alert">{state.error}</p> : null}
      {state.message ? <p className="do-pay-done" role="status">{state.message}</p> : null}
    </form>
    {entries.map(({ job }, index) => {
      const claimed = Boolean(job.doClaimedAt) || state.completed.includes(job.id);
      return <section key={job.id} className="do-pay-amount-entry">
        <h3><label><input type="checkbox" aria-label={`เลือกตั้งเบิก ${job.jobNo}`} disabled={claimed || pending}
          checked={!claimed && selected.includes(job.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, job.id] : previous.filter(id => id !== job.id))} /> {index + 1}. {job.jobNo}</label></h3>
        <p>BL {job.blNo ?? '-'}</p>
        <a className="cell-link" href={`#invoice-${job.id}`}>ดู Invoice ของรายการนี้</a>
        <DoPayPanel jobId={job.id} blNo={job.blNo} eta={job.eta} shipline={job.shipline}
          amount={job.doPayAmount} amountValue={amountOf(job.id, job.doPayAmount)}
          onAmountChange={value => { setAmounts(previous => ({ ...previous, [job.id]: value })); setCopyStatus(''); }}
          claimedAt={job.doClaimedAt ?? (claimed ? 'claimed' : null)} nextId={null} formOnly disabled={pending} />
      </section>;
    })}
  </div>;
}
