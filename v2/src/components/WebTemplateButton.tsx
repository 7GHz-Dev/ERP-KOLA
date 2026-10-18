'use client';

import { useState } from 'react';
import { cancelWebTask, queueWebTemplate } from '@/lib/actions/web-template';
import { PopoverCancel, PopoverHead } from '@/components/Interactions';
import type { TemplateInput } from '@/lib/web-template';
import type { WebTaskState } from '@/lib/web-template-store';
import type { BillingChoice } from '@/components/DoRequestButton';

/**
 * ปุ่มที่ Template กรอกเว็บสร้างไว้ในหน้างาน
 *
 * ถามเฉพาะช่องที่ Template ประกาศไว้ ที่เหลือ (ค่าของงาน ไฟล์ที่แนบ) ระบบหยิบจากงานให้
 * หลังกดแล้วแถวนี้บอกสถานะของคิวแทนปุ่ม เพื่อไม่ให้กดซ้ำ — แบบเดียวกับปุ่มส่งแลกเว็บ CMA
 */
export function WebTemplateButton({
  jobId, templateId, label, inputs, ready, task, billing,
}: {
  jobId: string;
  templateId: string;
  label: string;
  inputs: TemplateInput[];
  /** มีไฟล์ที่ Template บังคับแล้วหรือยัง */
  ready: boolean;
  task: WebTaskState | null;
  billing: BillingChoice[];
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    inputs.map((i) => [i.key, i.assist === 'billing' ? billing[0]?.text ?? '' : '']),
  ));
  const [reading, setReading] = useState('');
  const [readNote, setReadNote] = useState('');
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  if (task?.status === 'QUEUED') {
    return (
      <div className="do-request-state">
        <span className="badge pending">รอ worker: {label}</span>
        <form action={cancelWebTask} className="inline-form">
          <input type="hidden" name="taskId" value={task.id} />
          <button className="button tiny ghost" type="submit">ยกเลิก</button>
        </form>
      </div>
    );
  }
  if (task?.status === 'PROCESSING') return <span className="badge pending">กำลังกรอกเว็บ: {label}…</span>;
  if (!ready) return null;

  // อ่านเลขที่รายการจากสลิปด้วย OCR ตัวเดียวกับปุ่มส่งแลกเว็บ CMA — คนยังแก้ได้
  const readFromSlip = async (key: string) => {
    setReading(key);
    setReadNote('');
    try {
      const res = await fetch('/api/do-slip-ocr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = (await res.json()) as { ok: boolean; txn?: string; detail?: string };
      if (data.ok && data.txn) set(key, data.txn);
      else setReadNote(data.ok ? 'ไม่พบเลขที่รายการในสลิป กรุณากรอกเอง' : (data.detail ?? 'อ่านไม่สำเร็จ'));
    } catch {
      setReadNote('เชื่อมต่อไม่ได้ กรุณากรอกเอง');
    } finally {
      setReading('');
    }
  };

  return (
    <div className="do-request-state">
      {/* ส่งแล้วก็ยังกดซ้ำได้ — Template ที่ไม่ได้ย้ายแท็บ อาจต้องส่งรอบใหม่ */}
      {task?.status === 'DONE' ? (
        <span className="badge approved">ส่งแล้ว{task.resultRefNo ? ` · ${task.resultRefNo}` : ''}</span>
      ) : null}
      {task?.status === 'ERROR' ? (
        <small className="client-cell-note bad" title={task.error ?? ''}>
          {label} ไม่สำเร็จ: {task.error ?? '-'}
          {task.hasShot ? <> · <a href={`/api/web-template/shot/${task.id}`} target="_blank" rel="noreferrer">ภาพ</a></> : null}
        </small>
      ) : null}
      <details className="disclosure">
        <summary className="button tiny primary">{task?.status === 'ERROR' ? `${label} ใหม่` : label}</summary>
        <div className="popover wide">
          <PopoverHead title={label} />
          <form action={queueWebTemplate}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="templateId" value={templateId} />
            {inputs.length === 0 ? <p className="popover-note">ระบบจะกรอกเว็บตาม Template ให้ทั้งหมด</p> : null}
            {inputs.map((input) => (
              <label key={input.key} className="mini">
                <span>{input.label}</span>
                {input.assist === 'billing' && billing.length > 1 ? (
                  <div className="do-request-billing">
                    {billing.map((b) => (
                      <button key={b.label} type="button" className="button tiny" onClick={() => set(input.key, b.text)}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {input.multiline ? (
                  <textarea name={`input.${input.key}`} rows={4} required value={values[input.key] ?? ''}
                    onChange={(e) => set(input.key, e.target.value)} />
                ) : (
                  <div className="do-request-ref">
                    <input name={`input.${input.key}`} required value={values[input.key] ?? ''}
                      onChange={(e) => set(input.key, e.target.value)} />
                    {input.assist === 'slipRef' ? (
                      <button type="button" className="button tiny" disabled={Boolean(reading)} onClick={() => void readFromSlip(input.key)}>
                        {reading === input.key ? 'กำลังอ่าน…' : 'อ่านจากสลิป'}
                      </button>
                    ) : null}
                  </div>
                )}
                {input.assist === 'slipRef' && readNote ? <small className="client-cell-note bad">{readNote}</small> : null}
              </label>
            ))}
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
