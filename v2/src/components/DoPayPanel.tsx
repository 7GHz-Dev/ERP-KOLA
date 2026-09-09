'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { markDoClaimed, saveDoPayAmount } from '@/lib/actions/jobs';
import { claimText } from '@/lib/do-claim';
import { ConfirmSubmit } from '@/components/Interactions';
import type { PreviewFile } from '@/components/SlipCheckPanel';

/**
 * แผงของ MAY — ดู Invoice DO แล้วกรอกยอดชำระ พร้อมคัดลอกข้อความเบิก
 *
 * ทำงานทีละใบตามลำดับ เปิดไฟล์ → อ่านยอดแล้วกรอก → คัดลอกข้อความ → ตั้งเบิก → ใบถัดไป
 * ทุกปุ่มของขั้นตอนนี้อยู่ในแผงเดียวกัน ไม่ต้องปิดกลับไปหาแถวถัดไปในตารางเอง
 *
 * วางไฟล์ไว้บน ฟอร์มอยู่ล่าง แบบเดียวกับแผงกรอก DO ของ FAH
 * เป็นงานลักษณะเดียวกันคืออ่านตัวเลขจากใบแล้วคีย์ตาม สายตาจึงไหลจากไฟล์ลงมาที่ช่องกรอกพอดี
 * และบนมือถือได้ความกว้างเต็มจอให้เอกสาร ซึ่งอ่านง่ายกว่าแบ่งซ้ายขวา
 */
export function DoPayPanel({
  jobId, invoiceDo, blNo, eta, shipline, amount, claimedAt, nextId,
}: {
  jobId: string;
  invoiceDo?: PreviewFile;
  blNo: string | null;
  eta: string | null;
  shipline: string | null;
  amount: string | null;
  claimedAt: Date | string | null;
  /** งานถัดไปที่ยังรอตั้งเบิก — ไม่มีแล้วแปลว่าทำครบทุกใบ */
  nextId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(amount ?? '');
  const [copied, setCopied] = useState(false);
  const text = claimText({ blNo, eta, shipline, amount: value });
  const claimed = Boolean(claimedAt);
  const ready = value.trim() !== '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /*
       * คลิปบอร์ดถูกปิดในบางเบราว์เซอร์หรือตอนไม่ได้เปิดผ่าน https
       * เลือกข้อความในกล่องให้แทน ผู้ใช้กด Ctrl+C เองได้ทันที ไม่ต้องพิมพ์ใหม่
       */
      document.querySelector<HTMLTextAreaElement>('.do-pay-text')?.select();
    }
  };

  const src = invoiceDo ? `/files/${invoiceDo.id}` : null;
  const isImage = (invoiceDo?.mimeType ?? '').startsWith('image/');

  return (
    <div className="do-pay">
      {/* ไฟล์อยู่บนสุด — อ่านยอดจากใบแล้วสายตาไหลลงมาที่ช่องกรอกพอดี */}
      <div className="do-pay-view">
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
      </div>

      <div className="do-pay-side">
        {/* ขั้นที่ 1-2 — กรอกยอดที่อ่านได้จากใบที่เปิดดูอยู่ */}
        <form action={saveDoPayAmount} className="do-pay-form">
          <input type="hidden" name="jobId" value={jobId} />
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
              onChange={(e) => setValue(e.target.value)}
              disabled={claimed}
            />
          </label>
          {claimed ? null : (
            <button className="button tiny" type="submit">บันทึกยอด</button>
          )}
        </form>

        {/* ขั้นที่ 2 ต่อ — คัดลอกข้อความไปวางในแชทเบิกเงิน */}
        <div className="do-pay-claim">
          <div className="do-pay-claim-head">
            <span>ข้อความเบิก</span>
          </div>
          {/* อ่านอย่างเดียวแต่เลือกได้ เผื่อคลิปบอร์ดใช้ไม่ได้จะได้ลากคัดลอกเอง */}
          <textarea className="do-pay-text" readOnly rows={2} value={text} />
          <button
            type="button"
            className="button ok do-pay-copy"
            onClick={() => void copy()}
            disabled={!ready}
          >
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความเบิก'}
          </button>
          {ready ? null : <p className="do-pay-note">กรอกยอดก่อนจึงจะคัดลอกได้</p>}
        </div>

        {/* ขั้นที่ 3 — ตั้งเบิกแล้วไปใบถัดไป */}
        <div className="do-pay-next">
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
          {nextId ? (
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
        </div>
      </div>
    </div>
  );
}
