'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { markDoClaimed, saveDoPayAmount } from '@/lib/actions/jobs';
import { claimText } from '@/lib/do-claim';
import {
  checkExtras, claimAmountInput, depositInput, OTHER_LABEL_MAX, otherInput, type DoExtras,
} from '@/lib/do-claim-batch';
import { ConfirmSubmit } from '@/components/Interactions';
import type { PreviewFile } from '@/components/SlipCheckPanel';

type ExtraKind = 'deposit' | 'other';
const EXTRA_KINDS: Array<{ value: ExtraKind; label: string }> = [
  { value: 'deposit', label: 'ค่ามัดจำตู้' },
  { value: 'other', label: 'ค่าอื่นๆ (ระบุ)' },
];

/**
 * แผงของ MAY — ดู Invoice DO แล้วกรอกยอดชำระ พร้อมคัดลอกข้อความเบิก
 *
 * ทำงานทีละใบตามลำดับ เปิดไฟล์ → อ่านยอดแล้วกรอก → คัดลอกข้อความ → ตั้งเบิก → ใบถัดไป
 * ทุกปุ่มของขั้นตอนนี้อยู่ในแผงเดียวกัน ไม่ต้องปิดกลับไปหาแถวถัดไปในตารางเอง
 *
 * คอมพิวเตอร์แบ่งไฟล์ 70% กับฟอร์ม 30% ส่วนมือถือวางไฟล์บนและฟอร์มล่าง
 * formOnly ใช้ช่องกรอกเดียวกันในแผงหลายรายการ โดยมี preview รวมอยู่ด้านข้าง
 */
export function DoPayPanel({
  jobId, invoiceDo, blNo, eta, shipline, amount, extras, claimedAt, nextId, formOnly = false,
  amountValue, onAmountChange, extrasValue, onExtrasChange, disabled = false,
}: {
  jobId: string;
  invoiceDo?: PreviewFile;
  blNo: string | null;
  eta: string | null;
  shipline: string | null;
  amount: string | null;
  /** มัดจำตู้กับค่าอื่น ๆ ที่เคยบันทึกไว้ — ไม่ส่งมาคือยังไม่มี */
  extras?: DoExtras;
  claimedAt: Date | string | null;
  /** งานถัดไปที่ยังรอตั้งเบิก — ไม่มีแล้วแปลว่าทำครบทุกใบ */
  nextId: string | null;
  formOnly?: boolean;
  amountValue?: string;
  onAmountChange?: (value: string) => void;
  extrasValue?: DoExtras;
  onExtrasChange?: (value: DoExtras) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [localValue, setValue] = useState(amount ?? '');
  const value = amountValue ?? localValue;
  const [localExtras, setLocalExtras] = useState<DoExtras>(extras ?? { deposit: '', other: '', otherLabel: '' });
  const extra = extrasValue ?? localExtras;
  const changeExtras = (next: DoExtras) => { setLocalExtras(next); onExtrasChange?.(next); };
  const checked = checkExtras(extra);
  const [copied, setCopied] = useState(false);
  const text = claimText({
    blNo, eta, shipline, amount: claimAmountInput(value),
    deposit: checked?.deposit ?? null, other: checked?.other.amount ?? null, otherLabel: checked?.other.label ?? null,
  });
  const claimed = Boolean(claimedAt);
  // ยอดเพิ่มเติมไม่บังคับ แต่ถ้าพิมพ์ไว้แล้วผิดรูปต้องกันไว้ ไม่งั้นข้อความเบิกจะหล่นยอดไปเงียบ ๆ
  const ready = claimAmountInput(value) !== null && checked !== undefined;

  const [saveNote, setSaveNote] = useState('');

  /*
   * คัดลอกข้อความแล้วบันทึกยอดให้ในปุ่มเดียว
   *
   * เดิมมีปุ่มบันทึกยอดแยกอีกปุ่ม ซึ่งถ้าลืมกดแล้วปิดแผงไป ยอดที่พิมพ์ไว้หายหมด
   * ต้องเปิดไฟล์อ่านใหม่ทั้งที่คัดลอกข้อความไปวางในแชทแล้ว
   * คนที่กดคัดลอกคือคนที่อ่านยอดจนพอใจแล้ว จึงถือเป็นจังหวะที่ควรบันทึกพอดี
   *
   * บันทึกหลังคัดลอกสำเร็จ ไม่ใช่ก่อน เพราะถ้าคลิปบอร์ดพลาดผู้ใช้ยังต้องจัดการต่อ
   * แต่ยอดถูกเก็บแล้ว เปิดกลับมาก็ไม่ต้องพิมพ์ใหม่
   */
  const saveAmount = async () => {
    if (!ready) return;
    const fd = new FormData();
    fd.set('jobId', jobId);
    fd.set('amount', value);
    fd.set('deposit', extra.deposit);
    fd.set('other', extra.other);
    fd.set('otherLabel', extra.otherLabel);
    try {
      await saveDoPayAmount(fd);
      setSaveNote('บันทึกยอดแล้ว');
      router.refresh();
    } catch {
      setSaveNote('คัดลอกแล้ว แต่บันทึกยอดไม่สำเร็จ — กด "ตั้งเบิกแล้ว" จะบันทึกให้อีกครั้ง');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      await saveAmount();
    } catch {
      /*
       * คลิปบอร์ดถูกปิดในบางเบราว์เซอร์หรือตอนไม่ได้เปิดผ่าน https
       * เลือกข้อความในกล่องให้แทน ผู้ใช้กด Ctrl+C เองได้ทันที ไม่ต้องพิมพ์ใหม่
       */
      textArea.current?.select();
      // คลิปบอร์ดใช้ไม่ได้ก็ยังบันทึกยอดให้ ผู้ใช้เหลือแค่กด Ctrl+C เอง
      await saveAmount();
    }
  };

  const src = invoiceDo ? `/files/${invoiceDo.id}` : null;
  const isImage = (invoiceDo?.mimeType ?? '').startsWith('image/');

  return (
    <fieldset disabled={disabled} className={`${formOnly ? 'do-pay-entry' : 'do-pay'} do-pay-fieldset`}>
      {/* ไฟล์อยู่บนสุด — อ่านยอดจากใบแล้วสายตาไหลลงมาที่ช่องกรอกพอดี */}
      {!formOnly && <div className="do-pay-view">
        {!src ? (
          <p className="drawer-note warn">ยังไม่ได้อัปโหลด Invoice DO ของงานนี้</p>
        ) : isImage ? (
          <img className="do-pay-file" src={src} alt={invoiceDo?.fileName ?? 'Invoice DO'} />
        ) : (
          <object className="do-pay-file" data={src} type="application/pdf">
            <p className="drawer-note warn">
              เบราว์เซอร์นี้แสดงไฟล์นี้ในหน้าไม่ได้ ·{' '}
              <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
            </p>
          </object>
        )}
      </div>}

      <div className="do-pay-side">
        {/* ขั้นที่ 1-2 — กรอกยอดที่อ่านได้จากใบที่เปิดดูอยู่ */}
        {/* ไม่มีปุ่มส่งแล้ว ยอดถูกบันทึกตอนกดคัดลอกหรือกดตั้งเบิก */}
        <div className="do-pay-form">
          <label className="mini">
            <span>ยอดชำระ (บาท)</span>
            {/*
              inputMode=decimal ให้มือถือขึ้นแป้นตัวเลข แต่ยังเป็น type=text
              เพราะ type=number ทำให้พิมพ์ลูกน้ำคั่นหลักพันไม่ได้ ซึ่งคนคัดจากใบมักติดมาด้วย
            */}
            <input
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="เช่น 18400"
              value={value}
              onChange={(e) => { setValue(e.target.value); onAmountChange?.(e.target.value); }}
              disabled={claimed}
            />
          </label>

          <DoPayExtras value={extra} onChange={changeExtras} claimed={claimed} />
        </div>

        {/*
          ขั้นที่ 2 ต่อ — คัดลอกข้อความไปวางในแชทเบิกเงิน
          โหมดหลายรายการมีปุ่มคัดลอกรวมและปุ่มตั้งเบิกรวมอยู่ที่แผงแม่แล้ว
          ตรงนี้จึงแสดงเฉพาะตอนทำทีละใบ ไม่งั้นจะมีปุ่มซ้ำกันทุกแถว
        */}
        {formOnly ? null : <div className="do-pay-claim">
          <div className="do-pay-claim-head">
            <span>ข้อความเบิก</span>
          </div>
          {/* อ่านอย่างเดียวแต่เลือกได้ เผื่อคลิปบอร์ดใช้ไม่ได้จะได้ลากคัดลอกเอง */}
          <textarea ref={textArea} className="do-pay-text" readOnly rows={2} value={text} />
          <button
            type="button"
            className="button ok do-pay-copy"
            onClick={() => void copy()}
            disabled={!ready}
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความ · บันทึกยอด'}
          </button>
          {ready ? null : <p className="do-pay-note">กรอกยอดให้ถูกต้องก่อนจึงจะคัดลอกได้</p>}
          {saveNote ? <p className="do-pay-note" role="status">{saveNote}</p> : null}
        </div>}

        {/* ขั้นที่ 3 — ตั้งเบิกแล้วไปใบถัดไป */}
        {formOnly ? null : <div className="do-pay-next">
          {claimed ? (
            <p className="do-pay-done">ตั้งเบิกแล้ว · รายการอยู่ในแท็บ ตั้งเบิกแล้ว</p>
          ) : (
            <form action={markDoClaimed} className="do-pay-claim-form">
              <input type="hidden" name="jobId" value={jobId} />
              {/* ส่งยอดที่กำลังพิมพ์ไปด้วย จะได้ไม่ต้องกดบันทึกยอดก่อนอีกที */}
              <input type="hidden" name="amount" value={value} />
              <input type="hidden" name="deposit" value={extra.deposit} />
              <input type="hidden" name="other" value={extra.other} />
              <input type="hidden" name="otherLabel" value={extra.otherLabel} />
              {ready ? (
                <ConfirmSubmit
                  label="ตั้งเบิกแล้ว"
                  tone="primary"
                  confirm="คัดลอกข้อความไปตั้งเบิกแล้วใช่ไหม"
                  detail="ระบบจะบันทึกยอดกับเวลาที่ตั้งเบิก และรายการจะย้ายไปแท็บ ตั้งเบิกแล้ว"
                />
              ) : (
                <span className="badge pending">กรอกยอดก่อนจึงกดตั้งเบิกได้</span>
              )}
            </form>
          )}

          {/*
            ไปใบถัดไปโดยไม่ต้องปิดแผงกลับไปหาในตาราง
            ใช้ replace ไม่ push ประวัติย้อนกลับจะได้ไม่ยาวเป็นสิบชั้นตอนไล่ทำหลายใบ
          */}
          {formOnly ? null : nextId ? (
            <button
              type="button"
              className="button primary do-pay-nextbtn"
              onClick={() => router.replace(`/may/do-pay/${nextId}`)}
            >
              ดูไฟล์ต่อไป →
            </button>
          ) : (
            <p className="do-pay-note">ไม่มีใบที่รอตั้งเบิกแล้ว</p>
          )}
        </div>}
      </div>
    </fieldset>
  );
}

/**
 * ยอดเพิ่มเติมที่จ่ายไปพร้อมค่า DO — เลือกหัวข้อจาก dropdown ทีละบรรทัด
 *
 * งานส่วนใหญ่ไม่มี จึงซ่อนไว้จนกว่าจะกด "+ เพิ่มรายการ"
 * งานที่เคยบันทึกไว้แล้วต้องเห็นบรรทัดทันที ไม่งั้นจะไม่รู้ว่าข้อความเบิกมียอดอื่นติดไปด้วย
 * หัวข้อละหนึ่งบรรทัด (มัดจำ · ค่าอื่นๆ) เพราะรายงานแยกคอลัมน์ละยอด
 * เลือก "ค่าอื่นๆ" แล้วต้องพิมพ์หัวข้อเอง จะได้รู้ว่าเป็นค่าอะไรตอนเบิกและตอนดูรายงาน
 */
function DoPayExtras({ value, onChange, claimed }: {
  value: DoExtras;
  onChange: (next: DoExtras) => void;
  claimed: boolean;
}) {
  const [lines, setLines] = useState<ExtraKind[]>(() => [
    ...(value.deposit ? ['deposit' as const] : []),
    ...(value.other || value.otherLabel ? ['other' as const] : []),
  ]);
  const unused = EXTRA_KINDS.find((k) => !lines.includes(k.value))?.value;
  const cleared = (kind: ExtraKind): Partial<DoExtras> =>
    kind === 'deposit' ? { deposit: '' } : { other: '', otherLabel: '' };

  // เปลี่ยนหัวข้อของบรรทัดแล้วยกยอดที่พิมพ์ไว้ไปด้วย ไม่ต้องพิมพ์ใหม่
  const switchKind = (from: ExtraKind, to: ExtraKind) => {
    const amount = from === 'deposit' ? value.deposit : value.other;
    onChange({ ...value, ...cleared(from), ...(to === 'deposit' ? { deposit: amount } : { other: amount }) });
    setLines((prev) => prev.map((k) => (k === from ? to : k)));
  };
  const remove = (kind: ExtraKind) => {
    onChange({ ...value, ...cleared(kind) });
    setLines((prev) => prev.filter((k) => k !== kind));
  };
  const deposit = depositInput(value.deposit);
  const other = otherInput(value.other, value.otherLabel);

  return (
    <>
      {lines.map((kind) => (
        <div className="mini do-pay-deposit do-pay-extra" key={kind}>
          <span>
            <select
              aria-label="หัวข้อยอดเพิ่มเติม"
              value={kind}
              disabled={claimed}
              onChange={(e) => switchKind(kind, e.target.value as ExtraKind)}
            >
              {EXTRA_KINDS.map((k) => (
                <option key={k.value} value={k.value} disabled={k.value !== kind && lines.includes(k.value)}>
                  {k.label}
                </option>
              ))}
            </select>
            {claimed ? null : (
              <button type="button" className="link-button" onClick={() => remove(kind)}>ลบ</button>
            )}
          </span>
          {kind === 'other' ? (
            <input
              aria-label="ระบุหัวข้อค่าอื่นๆ"
              autoComplete="off"
              maxLength={OTHER_LABEL_MAX}
              placeholder="ระบุหัวข้อ เช่น ค่าล้างตู้"
              value={value.otherLabel}
              onChange={(e) => onChange({ ...value, otherLabel: e.target.value })}
              disabled={claimed}
            />
          ) : null}
          <input
            aria-label={kind === 'deposit' ? 'ค่ามัดจำตู้ (บาท)' : 'ยอดค่าอื่นๆ (บาท)'}
            inputMode="decimal"
            autoComplete="off"
            placeholder={kind === 'deposit' ? 'ยอด (บาท) เช่น 20000' : 'ยอด (บาท) เช่น 1500'}
            value={kind === 'deposit' ? value.deposit : value.other}
            onChange={(e) => onChange({ ...value, ...(kind === 'deposit' ? { deposit: e.target.value } : { other: e.target.value }) })}
            disabled={claimed}
          />
        </div>
      ))}
      {claimed || !unused ? null : (
        <button
          type="button"
          className="button tiny do-pay-add-deposit"
          onClick={() => setLines((prev) => [...prev, unused])}
        >
          + เพิ่มรายการ (มัดจำ / ค่าอื่นๆ)
        </button>
      )}
      {deposit === undefined ? (
        <p className="do-pay-note">ค่ามัดจำต้องเป็นตัวเลข เช่น 20000 หรือ 20,000</p>
      ) : null}
      {other === undefined ? (
        <p className="do-pay-note">ค่าอื่นๆ ต้องระบุหัวข้อและยอดเป็นตัวเลข หรือกดลบถ้าไม่มี</p>
      ) : null}
    </>
  );
}
