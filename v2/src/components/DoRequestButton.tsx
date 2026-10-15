'use client';

import { useState } from 'react';
import { cancelDoRequest, queueDoRequest } from '@/lib/actions/do-request';
import { PopoverCancel, PopoverHead } from '@/components/Interactions';
import type { DoRequestTask } from '@/lib/queries/do-files';

/** ที่อยู่ออกใบเสร็จที่เลือกได้ — มาจากหัวจดหมายแลก D/O ชุดเดียวกับที่ตั้งไว้ใน /master/do-letter */
export type BillingChoice = { label: string; text: string };

/**
 * ปุ่มส่งชุดแลก D/O ไปขอ Delivery Order ผ่านเว็บ CMA CGM อัตโนมัติ
 *
 * กรอกสองอย่างที่ระบบยังไม่รู้เอง: หมายเลขอ้างอิงในสลิป กับที่อยู่ออกใบเสร็จ
 * ที่เหลือ (เลข BL, ไฟล์ชุดแลก) ระบบหยิบจากงานให้ แล้ว worker กรอกเว็บตามขั้นตอนเดิมของ ANN
 *
 * หลังกดแล้วแถวนี้บอกสถานะของคิวแทนปุ่ม เพื่อไม่ให้กดยื่นซ้ำ
 */
export function DoRequestButton({
  jobId, ready, task, billing,
}: {
  jobId: string;
  /** รวมชุดแลก DO แล้วหรือยัง — ไฟล์นั้นคือไฟล์ที่ถูกอัปขึ้นเว็บ */
  ready: boolean;
  task: DoRequestTask | null;
  billing: BillingChoice[];
}) {
  const [paymentRef, setPaymentRef] = useState('');
  const [note, setNote] = useState(billing[0]?.text ?? '');
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');

  if (task?.status === 'QUEUED') {
    return (
      <div className="do-request-state">
        <span className="badge pending">รอส่งแลกเว็บ CMA</span>
        <form action={cancelDoRequest} className="inline-form">
          <input type="hidden" name="taskId" value={task.id} />
          <button className="button tiny ghost" type="submit">ยกเลิก</button>
        </form>
      </div>
    );
  }
  if (task?.status === 'PROCESSING') {
    return <span className="badge pending">กำลังกรอกเว็บ CMA…</span>;
  }
  if (!ready) return null;

  // อ่านเลขที่รายการจากสลิปค่า DO ด้วย OCR ตัวเดียวกับปุ่มอ่านยอด — เป็นตัวช่วย คนยังแก้ได้
  const readFromSlip = async () => {
    setReading(true);
    setReadNote('');
    try {
      const res = await fetch('/api/do-slip-ocr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = (await res.json()) as { ok: boolean; txn?: string; detail?: string };
      if (data.ok && data.txn) setPaymentRef(data.txn);
      else setReadNote(data.ok ? 'ไม่พบเลขที่รายการในสลิป กรุณากรอกเอง' : (data.detail ?? 'อ่านไม่สำเร็จ'));
    } catch {
      setReadNote('เชื่อมต่อไม่ได้ กรุณากรอกเอง');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="do-request-state">
      {task?.status === 'ERROR' ? (
        <small className="client-cell-note bad" title={task.error ?? ''}>
          ส่งเว็บ CMA ไม่สำเร็จ: {task.error ?? '-'}
        </small>
      ) : null}
      <details className="disclosure">
        <summary className="button tiny primary">
          {task?.status === 'ERROR' ? 'ส่งแลกเว็บ CMA ใหม่' : 'ส่งแลกเว็บ CMA'}
        </summary>
        <div className="popover">
          <PopoverHead title="ขอ Delivery Order ผ่านเว็บ CMA CGM" />
          <p className="popover-note">
            ระบบจะกรอกเว็บ My Customer Service ให้ — New Delivery Order · Thailand · เลข BL ของงานนี้
            · แนบชุดแลก DO ที่รวมแล้วทั้งช่อง Payment และ Supporting Document
          </p>
          <form action={queueDoRequest}>
            <input type="hidden" name="jobId" value={jobId} />
            <label className="mini">
              <span>หมายเลขอ้างอิงในสลิป (Payment reference number)</span>
              <div className="do-request-ref">
                <input
                  name="paymentRef"
                  required
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="เลขที่รายการตามสลิปโอนเงิน"
                />
                <button type="button" className="button tiny" disabled={reading} onClick={() => void readFromSlip()}>
                  {reading ? 'กำลังอ่าน…' : 'อ่านจากสลิป'}
                </button>
              </div>
              {readNote ? <small className="client-cell-note bad">{readNote}</small> : null}
            </label>
            <label className="mini">
              <span>ที่อยู่ออกใบเสร็จ (Additional information)</span>
              {billing.length > 1 ? (
                <div className="do-request-billing">
                  {billing.map((b) => (
                    <button key={b.label} type="button" className="button tiny" onClick={() => setNote(b.text)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea name="note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="dialog-actions">
              <PopoverCancel />
              <button className="button tiny primary" type="submit">ส่งเข้าคิว</button>
            </div>
          </form>
        </div>
      </details>
    </div>
  );
}
