'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { markDoClaimed, saveDoPayAmount } from '@/lib/actions/jobs';
import { claimText, type DoCharge, type DoChargeTopic } from '@/lib/do-charges';
import { claimAmountInput } from '@/lib/do-claim-batch';
import { ConfirmSubmit } from '@/components/Interactions';
import { DoChargeList } from '@/components/DoChargeList';
import type { PreviewFile } from '@/components/SlipCheckPanel';

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
  jobId, invoiceDo, blNo, eta, shipline, amount, charges, topics, claimedAt, nextId, formOnly = false,
  amountValue, onAmountChange, disabled = false,
}: {
  jobId: string;
  invoiceDo?: PreviewFile;
  blNo: string | null;
  eta: string | null;
  shipline: string | null;
  amount: string | null;
  /** หัวข้อค่าใช้จ่ายของงานนี้ (มัดจำ · ล่าช้า · DEM · DET …) ที่บันทึกไว้แล้ว */
  charges: DoCharge[];
  /** หัวข้อใน dropdown จาก Master Data */
  topics: DoChargeTopic[];
  claimedAt: Date | string | null;
  /** งานถัดไปที่ยังรอตั้งเบิก — ไม่มีแล้วแปลว่าทำครบทุกใบ */
  nextId: string | null;
  formOnly?: boolean;
  amountValue?: string;
  onAmountChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [localValue, setValue] = useState(amount ?? '');
  const value = amountValue ?? localValue;
  const [copied, setCopied] = useState(false);
  const claimed = Boolean(claimedAt);
  /*
   * ข้อความเบิกหลัก = ค่า DO + หัวข้อที่ตั้งเบิกไปพร้อมกัน
   * ก่อนตั้งเบิกคือทุกหัวข้อที่บันทึกไว้ · หลังตั้งเบิก หัวข้อที่เพิ่มทีหลังไปอยู่ในข้อความเบิกเพิ่มเติมแทน
   */
  const mainCharges = claimed ? charges.filter((c) => c.claimedAt) : charges;
  const text = claimText({ blNo, eta, shipline, amount: claimAmountInput(value), charges: mainCharges });
  const ready = claimAmountInput(value) !== null;

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

        </div>

        {/* หัวข้อค่าใช้จ่าย — บันทึกทีละหัวข้อ แนบ Invoice / Slip ได้ทุกหัวข้อ · ตั้งเบิกแล้วยังเพิ่มได้ */}
        <DoChargeList jobId={jobId} charges={charges} topics={topics} jobClaimed={claimed}
          blNo={blNo} eta={eta} shipline={shipline} disabled={disabled} />

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
              {ready ? (
                <ConfirmSubmit
                  label="ตั้งเบิกแล้ว"
                  tone="primary"
                  confirm="คัดลอกข้อความไปตั้งเบิกแล้วใช่ไหม"
                  detail={`ระบบจะบันทึกยอดกับเวลาที่ตั้งเบิก${charges.length ? ` · หัวข้อค่าใช้จ่าย ${charges.length} หัวข้อตั้งเบิกไปพร้อมกัน (ล็อกยอด)` : ''} และรายการจะย้ายไปแท็บ ตั้งเบิกแล้ว · เพิ่มค่าใช้จ่ายภายหลังได้`}
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
