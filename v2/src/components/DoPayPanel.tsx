'use client';

import { useState } from 'react';
import { saveDoPayAmount } from '@/lib/actions/jobs';
import { claimText } from '@/lib/do-claim';
import type { PreviewFile } from '@/components/SlipCheckPanel';

/**
 * แผงของ MAY — ดู Invoice DO แล้วกรอกยอดชำระ พร้อมคัดลอกข้อความเบิก
 *
 * ยอดกับข้อความอยู่จอเดียวกับไฟล์ เพราะต้องอ่านตัวเลขจากใบแล้วพิมพ์ตามทันที
 * เปิดไฟล์คนละหน้าแล้วสลับไปมาจำตัวเลขพลาดง่าย
 *
 * ข้อความคำนวณสด ๆ จากยอดที่กำลังพิมพ์ ไม่ต้องกดบันทึกก่อนถึงจะคัดลอกได้
 * ส่วนปุ่มบันทึกไว้เก็บยอดไว้ใช้รอบหน้า เปิดมาอีกครั้งจะได้ไม่ต้องอ่านไฟล์ซ้ำ
 */
export function DoPayPanel({
  jobId, invoiceDo, blNo, eta, shipline, amount,
}: {
  jobId: string;
  invoiceDo?: PreviewFile;
  blNo: string | null;
  eta: string | null;
  shipline: string | null;
  amount: string | null;
}) {
  const [value, setValue] = useState(amount ?? '');
  const [copied, setCopied] = useState(false);
  const text = claimText({ blNo, eta, shipline, amount: value });

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
      <div className="do-pay-side">
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
            />
          </label>
          <button className="button tiny primary" type="submit">บันทึกยอด</button>
        </form>

        <div className="do-pay-claim">
          <div className="do-pay-claim-head">
            <span>ข้อความเบิก</span>
            <button type="button" className="button tiny ok" onClick={() => void copy()}>
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความเบิก'}
            </button>
          </div>
          {/* อ่านอย่างเดียวแต่เลือกได้ เผื่อคลิปบอร์ดใช้ไม่ได้จะได้ลากคัดลอกเอง */}
          <textarea className="do-pay-text" readOnly rows={2} value={text} />
        </div>
      </div>

      <div className="slip-pane do-pay-view">
        <div className="slip-pane-head">
          <span>Invoice DO</span>
          {src ? (
            <a className="button tiny" href={src} target="_blank" rel="noreferrer">เปิดเต็มจอ</a>
          ) : null}
        </div>
        {!src ? (
          <div className="slip-empty">ยังไม่มีไฟล์ Invoice DO</div>
        ) : isImage ? (
          <img className="slip-view" src={src} alt={invoiceDo?.fileName ?? 'Invoice DO'} />
        ) : (
          <object className="slip-view" data={src} type="application/pdf">
            <p className="slip-empty">
              เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ ·{' '}
              <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
            </p>
          </object>
        )}
        {invoiceDo ? <div className="slip-pane-foot">{invoiceDo.fileName}</div> : null}
      </div>
    </div>
  );
}
