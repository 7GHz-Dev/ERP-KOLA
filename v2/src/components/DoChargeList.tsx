'use client';

import Link from 'next/link';
import { startTransition, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { claimExtraDoCharges, deleteDoCharge, saveDoCharge } from '@/lib/actions/do-charges';
import { removeDoAttachment } from '@/lib/actions/files';
import { claimAmount } from '@/lib/do-claim';
import { claimAmountInput } from '@/lib/do-claim-batch';
import {
  chargeLabel, DO_CHARGE_NOTE_MAX, extraClaimText, type DoCharge, type DoChargeTopic,
} from '@/lib/do-charges';
import { DO_CHARGE_INV, DO_CHARGE_SLIP, type DoAttachment } from '@/lib/do-attachments';
import { formatDateTime } from '@/lib/format';

/**
 * ค่าใช้จ่ายแลก DO ของ BL หนึ่ง — หลายหัวข้อ เลือกจาก dropdown (Master Data > หัวข้อค่าใช้จ่ายแลก DO)
 *
 * แต่ละบรรทัดบันทึกทันทีที่กด แล้วแนบ Invoice ของค่านั้น กับ Slip โอน ได้ในบรรทัดเดียวกัน
 * กดตั้งเบิกค่า DO แล้ว หัวข้อที่มีอยู่ตั้งเบิกไปพร้อมกัน (ล็อกยอด แต่ยังแนบไฟล์เพิ่มได้)
 * งานที่ตั้งเบิกแล้วเพิ่มหัวข้อได้อีก → คัดลอกข้อความเบิกเพิ่มเติม → กดตั้งเบิกเพิ่มเติม
 */
export function DoChargeList({
  jobId, charges, topics, jobClaimed, blNo, eta, shipline, disabled = false,
}: {
  jobId: string;
  charges: DoCharge[];
  topics: DoChargeTopic[];
  /** ตั้งเบิกค่า DO ไปแล้ว — หัวข้อที่เพิ่มต่อจากนี้คือค่าใช้จ่ายเพิ่มเติม */
  jobClaimed: boolean;
  blNo: string | null;
  eta: string | null;
  shipline: string | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const refresh = () => startTransition(() => router.refresh());
  const pendingExtra = jobClaimed ? charges.filter((c) => !c.claimedAt) : [];

  return (
    <div className="do-charges">
      <div className="do-charges-head">
        <b>ค่าใช้จ่ายอื่น (นอกจากค่า DO)</b>
        <small>{charges.length ? `${charges.length} หัวข้อ` : 'ไม่มีก็เว้นไว้'}</small>
      </div>
      {charges.map((c) => (
        <ChargeRow key={`${c.id}:${c.amount}:${c.topicId}:${c.note}`} jobId={jobId} charge={c} topics={topics}
          disabled={disabled} onDone={refresh} />
      ))}
      {disabled ? null : <AddCharge jobId={jobId} topics={topics} onDone={refresh} extra={jobClaimed} />}
      {pendingExtra.length ? (
        <ExtraClaim jobId={jobId} charges={pendingExtra} blNo={blNo} eta={eta} shipline={shipline} onDone={refresh} />
      ) : null}
    </div>
  );
}

function TopicSelect({ topics, value, onChange, disabled, current }: {
  topics: DoChargeTopic[]; value: string; onChange: (v: string) => void; disabled?: boolean;
  /** หัวข้อเดิมของบรรทัดที่ถูกปิดใช้ไปแล้ว — ยังต้องแสดงให้เห็น */
  current?: { id: string | null; name: string };
}) {
  const missing = current?.id && !topics.some((t) => t.id === current.id);
  return (
    <select aria-label="หัวข้อค่าใช้จ่าย" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {value ? null : <option value="">— เลือกหัวข้อ —</option>}
      {missing ? <option value={current!.id!}>{current!.name} (ปิดใช้แล้ว)</option> : null}
      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

function AddCharge({ jobId, topics, onDone, extra }: {
  jobId: string; topics: DoChargeTopic[]; onDone: () => void; extra: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [topicId, setTopicId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = Boolean(topicId) && Number(claimAmountInput(amount)) > 0;

  if (!open) {
    return (
      <button type="button" className="button tiny do-charge-add" onClick={() => setOpen(true)} disabled={!topics.length}>
        {topics.length ? (extra ? '+ เพิ่มค่าใช้จ่ายเพิ่มเติม' : '+ เพิ่มค่าใช้จ่าย (มัดจำ · ล่าช้า · DEM · DET …)') : 'ยังไม่มีหัวข้อ — เพิ่มได้ที่ Master Data'}
      </button>
    );
  }
  const add = async () => {
    setBusy(true); setError('');
    const fd = new FormData();
    fd.set('jobId', jobId); fd.set('topicId', topicId); fd.set('amount', amount); fd.set('note', note);
    const res = await saveDoCharge(fd).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    setBusy(false);
    if (!res.ok) { setError(res.detail); return; }
    setTopicId(''); setAmount(''); setNote(''); setOpen(false);
    onDone();
  };
  return (
    <div className="do-charge do-charge-new">
      <TopicSelect topics={topics} value={topicId} onChange={setTopicId} disabled={busy} />
      <input aria-label="ยอด (บาท)" inputMode="decimal" autoComplete="off" placeholder="ยอด (บาท) เช่น 1500"
        value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
      <input aria-label="หมายเหตุ" autoComplete="off" maxLength={DO_CHARGE_NOTE_MAX} placeholder="หมายเหตุ (ถ้ามี) เช่น ค่าล้างตู้"
        value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      <span className="do-charge-actions">
        <button type="button" className="button tiny primary" disabled={!valid || busy} onClick={() => void add()}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกหัวข้อ'}
        </button>
        <button type="button" className="button tiny ghost" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>ยกเลิก</button>
      </span>
      {error ? <p className="do-pay-note bad">{error}</p> : null}
    </div>
  );
}

function ChargeRow({ jobId, charge, topics, disabled, onDone }: {
  jobId: string; charge: DoCharge; topics: DoChargeTopic[]; disabled: boolean; onDone: () => void;
}) {
  const locked = Boolean(charge.claimedAt);
  const [topicId, setTopicId] = useState(charge.topicId ?? '');
  const [amount, setAmount] = useState(claimAmount(charge.amount));
  const [note, setNote] = useState(charge.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = topicId !== (charge.topicId ?? '') || claimAmountInput(amount) !== charge.amount || note.trim() !== (charge.note ?? '');
  const valid = Boolean(topicId) && Number(claimAmountInput(amount)) > 0;

  const run = async (work: () => Promise<{ ok: boolean; detail?: string }>) => {
    setBusy(true); setError('');
    const res = await work().catch(() => ({ ok: false, detail: 'เชื่อมต่อไม่ได้' }));
    setBusy(false);
    if (!res.ok) { setError(res.detail ?? 'ทำรายการไม่สำเร็จ'); return; }
    onDone();
  };
  const save = () => run(() => {
    const fd = new FormData();
    fd.set('chargeId', charge.id); fd.set('topicId', topicId); fd.set('amount', amount); fd.set('note', note);
    return saveDoCharge(fd);
  });
  const remove = () => {
    if (!window.confirm(`ลบ ${chargeLabel(charge)} ${claimAmount(charge.amount)} บาทใช่ไหม${charge.invoices.length + charge.slips.length ? '\nไฟล์ที่แนบไว้จะถูกเอาออกด้วย' : ''}`)) return;
    void run(() => { const fd = new FormData(); fd.set('chargeId', charge.id); return deleteDoCharge(fd); });
  };

  return (
    <div className={`do-charge${locked ? ' locked' : ''}`}>
      {locked ? (
        <div className="do-charge-locked">
          <b>{chargeLabel(charge)}</b>
          <span className="do-charge-amount">{claimAmount(charge.amount)}</span>
          <span className="badge approved" title={formatDateTime(charge.claimedAt)}>ตั้งเบิกแล้ว {formatDateTime(charge.claimedAt).slice(0, 5)}</span>
        </div>
      ) : (
        <>
          <TopicSelect topics={topics} value={topicId} onChange={setTopicId} disabled={busy || disabled}
            current={{ id: charge.topicId, name: charge.topicName }} />
          <input aria-label="ยอด (บาท)" inputMode="decimal" autoComplete="off" value={amount}
            onChange={(e) => setAmount(e.target.value)} disabled={busy || disabled} />
          <input aria-label="หมายเหตุ" autoComplete="off" maxLength={DO_CHARGE_NOTE_MAX} placeholder="หมายเหตุ (ถ้ามี)"
            value={note} onChange={(e) => setNote(e.target.value)} disabled={busy || disabled} />
          {disabled ? null : (
            <span className="do-charge-actions">
              {dirty ? (
                <button type="button" className="button tiny primary" disabled={!valid || busy} onClick={() => void save()}>
                  {busy ? 'กำลังบันทึก…' : 'บันทึก'}
                </button>
              ) : null}
              <button type="button" className="link-button" disabled={busy} onClick={remove}>ลบ</button>
            </span>
          )}
        </>
      )}
      <ChargeFiles jobId={jobId} chargeId={charge.id} category={DO_CHARGE_INV} label="Invoice" files={charge.invoices} onDone={onDone} />
      <ChargeFiles jobId={jobId} chargeId={charge.id} category={DO_CHARGE_SLIP} label="Slip โอน" files={charge.slips} onDone={onDone} />
      {error ? <p className="do-pay-note bad">{error}</p> : null}
    </div>
  );
}

/** Invoice / Slip ของหัวข้อหนึ่ง — เลือกได้หลายไฟล์ อัปทีละไฟล์ผ่านเส้นทางอัปโหลดเดียวกับไฟล์อื่น */
function ChargeFiles({ jobId, chargeId, category, label, files, onDone }: {
  jobId: string; chargeId: string; category: string; label: string; files: DoAttachment[]; onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState('');

  const upload = async (picked: File[]) => {
    if (!picked.length) return;
    setError('');
    const failed: string[] = [];
    for (const [i, file] of picked.entries()) {
      setStatus(picked.length > 1 ? `กำลังอัป ${i + 1}/${picked.length}…` : 'กำลังอัป…');
      const fd = new FormData();
      fd.set('jobId', jobId); fd.set('category', category); fd.set('doChargeId', chargeId); fd.set('file', file);
      try {
        const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
        const body = await res.json().catch(() => ({})) as { ok?: boolean; detail?: string };
        if (!res.ok || !body.ok) failed.push(`${file.name}: ${body.detail ?? 'อัปโหลดไม่สำเร็จ'}`);
      } catch {
        failed.push(`${file.name}: เชื่อมต่อไม่ได้`);
      }
    }
    setStatus('');
    if (input.current) input.current.value = '';
    if (failed.length) setError(failed.join('\n'));
    onDone();
  };
  const remove = async (f: DoAttachment) => {
    if (!window.confirm(`เอา ${f.fileName} ออกใช่ไหม`)) return;
    setRemoving(f.id);
    const fd = new FormData();
    fd.set('fileId', f.id);
    const res = await removeDoAttachment(fd).catch(() => ({ ok: false, detail: 'เชื่อมต่อไม่ได้' }));
    setRemoving('');
    if (!res.ok) { setError(res.detail ?? 'เอาไฟล์ออกไม่สำเร็จ'); return; }
    onDone();
  };

  return (
    <div className="do-charge-files">
      <small>{label}</small>
      {files.map((f) => (
        <span key={f.id} className="do-attach-row">
          <Link className="badge approved file-link" href={`/file/${f.id}`} title={f.fileName}>{f.fileName}</Link>
          <button type="button" className="icon-button do-attach-remove" aria-label={`เอา ${f.fileName} ออก`} title="เอาออก"
            disabled={removing === f.id} onClick={() => void remove(f)}>×</button>
        </span>
      ))}
      <label className={`button tiny${status ? ' disabled' : ''}`}>
        {status || (files.length ? '+ เพิ่ม' : `อัป ${label}`)}
        <input ref={input} type="file" multiple hidden disabled={Boolean(status)}
          onChange={(e) => void upload(Array.from(e.target.files ?? []))} />
      </label>
      {error ? <p className="do-pay-note bad">{error}</p> : null}
    </div>
  );
}

/** ค่าใช้จ่ายที่เพิ่มหลังตั้งเบิกค่า DO — คัดลอกข้อความเบิกเฉพาะส่วนเพิ่ม แล้วกดตั้งเบิกเพิ่มเติม */
function ExtraClaim({ jobId, charges, blNo, eta, shipline, onDone }: {
  jobId: string; charges: DoCharge[]; blNo: string | null; eta: string | null; shipline: string | null; onDone: () => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const text = extraClaimText({ blNo, eta, shipline, charges });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setNote('คัดลอกแล้ว'); }
    catch { area.current?.select(); setNote('เลือกข้อความแล้ว กด Ctrl+C'); }
  };
  const claim = async () => {
    if (!window.confirm(`ตั้งเบิกค่าใช้จ่ายเพิ่มเติม ${charges.length} หัวข้อใช่ไหม\nยอดจะถูกล็อก แก้/ลบไม่ได้ (ยังแนบไฟล์เพิ่มได้)`)) return;
    setBusy(true);
    const fd = new FormData();
    fd.set('jobId', jobId);
    const res = await claimExtraDoCharges(fd).catch(() => ({ ok: false as const, detail: 'เชื่อมต่อไม่ได้' }));
    setBusy(false);
    if (!res.ok) { setNote(res.detail); return; }
    onDone();
  };
  return (
    <div className="do-pay-claim do-charge-extra-claim">
      <div className="do-pay-claim-head"><span>ข้อความเบิกค่าใช้จ่ายเพิ่มเติม ({charges.length})</span></div>
      <textarea ref={area} className="do-pay-text" readOnly rows={2} value={text} />
      <span className="do-charge-actions">
        <button type="button" className="button tiny ok" onClick={() => void copy()}>คัดลอกข้อความ</button>
        <button type="button" className="button tiny primary" disabled={busy} onClick={() => void claim()}>
          {busy ? 'กำลังบันทึก…' : 'ตั้งเบิกเพิ่มเติมแล้ว'}
        </button>
      </span>
      {note ? <p className="do-pay-note" role="status">{note}</p> : null}
    </div>
  );
}
