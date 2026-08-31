'use client';

import { useState } from 'react';

/**
 * ปุ่มอ่านยอดจาก Slip ด้วย OCR
 *
 * ผลที่ได้เป็นตัวช่วยอ่านเท่านั้น ไม่บันทึกลงระบบ และไม่ตัดสินว่ายอดตรงหรือไม่
 * เพราะ OCR อ่านพลาดได้ คนยังต้องมองสองใบเทียบกันเองอยู่ดี
 * แสดงยอดที่เจอทุกตัวเพราะสลิปมีทั้งยอดโอนและค่าธรรมเนียมปนกัน
 */
type Result = {
  ok: boolean;
  detail?: string;
  amount?: number;
  amounts?: number[];
  date?: string;
  txn?: string;
  bank?: string;
  sample?: string;
};

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2 });

export function SlipReadButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/do-slip-ocr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      setResult((await res.json()) as Result);
    } catch {
      setResult({ ok: false, detail: 'เชื่อมต่อไม่ได้ กรุณาลองใหม่' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="slip-read">
      <button type="button" className="button tiny primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'กำลังอ่าน…' : 'อ่านยอดจาก Slip'}
      </button>

      {result && !result.ok ? <p className="popover-error">{result.detail}</p> : null}

      {result?.ok ? (
        <div className="slip-read-out">
          <div className="slip-read-amount">
            <span>ยอดที่อ่านได้</span>
            <b>{result.amount ? `${baht(result.amount)} บาท` : 'ไม่พบยอด'}</b>
          </div>
          <dl className="slip-read-meta">
            {result.date ? <><dt>วันที่</dt><dd>{result.date}</dd></> : null}
            {result.txn ? <><dt>เลขที่รายการ</dt><dd>{result.txn}</dd></> : null}
            {result.bank ? <><dt>ธนาคาร</dt><dd>{result.bank}</dd></> : null}
            {result.amounts && result.amounts.length > 1 ? (
              <><dt>ตัวเลขอื่นในสลิป</dt><dd>{result.amounts.slice(1).map(baht).join(' · ')}</dd></>
            ) : null}
          </dl>
          <p className="slip-read-note">
            เป็นตัวช่วยอ่านเท่านั้น · กรุณาเทียบกับยอดใน Invoice DO ด้วยตาอีกครั้ง
          </p>
        </div>
      ) : null}
    </div>
  );
}
