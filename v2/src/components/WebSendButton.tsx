'use client';

import { useState } from 'react';
import { cancelWebTask, queueWebTemplate } from '@/lib/actions/web-template';
import { PopoverCancel, PopoverHead } from '@/components/Interactions';
import type { TemplateInput } from '@/lib/web-template';
import type { WebTaskState } from '@/lib/web-template-store';

/** Template ที่ใช้กับงานแถวนี้ได้ (SHIPLINE ตรงรูปแบบของ Template) */
export type WebSendOption = {
  templateId: string;
  label: string;
  /** ช่องที่ Template ถามเพิ่ม — ไม่รวม slipno/billing ที่ระบบมีให้ */
  inputs: TemplateInput[];
  /** ไฟล์ที่ Template บังคับยังไม่มี — ชื่อหมวด ว่าง = พร้อม */
  missingFile: string | null;
};

/**
 * ปุ่ม "ส่งแลกผ่าน web" — ปุ่มเดียวของงานแถวนี้ ใช้ Template กรอกเว็บที่ตรงกับสายเรือ
 *
 * ถามเลขอ้างอิงในสลิปก่อนยืนยันทุกครั้ง (อ่านจากสลิปด้วย OCR หรือกรอกเอง) แล้วส่งเป็นตัวแปร {{input.slipno}}
 * ที่อยู่ใบเสร็จระบบใส่ให้เป็น {{input.billing}} · มีหลาย Template ตรงสายเรือเดียวกันจึงให้เลือก
 * กดแล้วแถวนี้บอกสถานะของคิวแทนปุ่ม กันกดยื่นซ้ำ
 */
export function WebSendButton({
  jobId, options, task,
}: {
  jobId: string;
  options: WebSendOption[];
  /** งานล่าสุดในคิวของแถวนี้ (ทุก Template) */
  task: (WebTaskState & { label: string }) | null;
}) {
  const [templateId, setTemplateId] = useState(options[0]?.templateId ?? '');
  const [slipno, setSlipno] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');

  if (!options.length) return null;

  if (task?.status === 'QUEUED') {
    return (
      <div className="do-request-state">
        <span className="badge pending">รอ worker: {task.label}</span>
        <form action={cancelWebTask} className="inline-form">
          <input type="hidden" name="taskId" value={task.id} />
          <button className="button tiny ghost" type="submit">ยกเลิก</button>
        </form>
      </div>
    );
  }
  if (task?.status === 'PROCESSING') return <span className="badge pending">กำลังกรอกเว็บ: {task.label}…</span>;

  const chosen = options.find((o) => o.templateId === templateId) ?? options[0];

  // อ่านเลขที่รายการจากสลิปค่า DO — เป็นตัวช่วย คนยังแก้ได้
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
      if (data.ok && data.txn) setSlipno(data.txn);
      else setReadNote(data.ok ? 'ไม่พบเลขที่รายการในสลิป กรุณากรอกเอง' : (data.detail ?? 'อ่านไม่สำเร็จ'));
    } catch {
      setReadNote('เชื่อมต่อไม่ได้ กรุณากรอกเอง');
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="do-request-state">
      {task?.status === 'DONE' ? (
        <span className="badge approved">ส่งแล้ว{task.resultRefNo ? ` · ${task.resultRefNo}` : ''}</span>
      ) : null}
      {task?.status === 'ERROR' ? (
        <small className="client-cell-note bad" title={task.error ?? ''}>
          ส่งผ่าน web ไม่สำเร็จ: {task.error ?? '-'}
          {task.hasShot ? <> · <a href={`/api/web-template/shot/${task.id}`} target="_blank" rel="noreferrer">ภาพ</a></> : null}
        </small>
      ) : null}
      <details className="disclosure">
        <summary className="button tiny primary">{task?.status === 'ERROR' ? 'ส่งแลกผ่าน web ใหม่' : 'ส่งแลกผ่าน web'}</summary>
        <div className="popover wide">
          <PopoverHead title="ส่งแลกผ่าน web" />
          <form action={queueWebTemplate}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="templateId" value={chosen.templateId} />
            {options.length > 1 ? (
              <label className="mini">
                <span>ใช้ Template</span>
                <select value={chosen.templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {options.map((o) => <option key={o.templateId} value={o.templateId}>{o.label}</option>)}
                </select>
              </label>
            ) : (
              <p className="popover-note">Template: <b>{chosen.label}</b></p>
            )}
            <label className="mini">
              <span>เลขอ้างอิงในสลิป (slipno)</span>
              <div className="do-request-ref">
                <input name="input.slipno" required value={slipno} onChange={(e) => setSlipno(e.target.value)}
                  placeholder="กดอ่านจากสลิป หรือกรอกเอง" />
                <button type="button" className="button tiny" disabled={reading} onClick={() => void readFromSlip()}>
                  {reading ? 'กำลังอ่าน…' : 'อ่านจากสลิป'}
                </button>
              </div>
              {readNote ? <small className="client-cell-note bad">{readNote}</small> : null}
            </label>
            {chosen.inputs.map((input) => (
              <label key={`${chosen.templateId}-${input.key}`} className="mini">
                <span>{input.label}</span>
                {input.multiline ? (
                  <textarea name={`input.${input.key}`} rows={3} required value={values[input.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [input.key]: e.target.value }))} />
                ) : (
                  <input name={`input.${input.key}`} required value={values[input.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [input.key]: e.target.value }))} />
                )}
              </label>
            ))}
            {chosen.missingFile ? (
              <p className="client-cell-note bad">ยังไม่มีไฟล์ {chosen.missingFile} — รวมชุดแลก DO ก่อน</p>
            ) : null}
            <div className="dialog-actions">
              <PopoverCancel />
              <button className="button tiny primary" type="submit" disabled={Boolean(chosen.missingFile) || !slipno.trim()}>
                ยืนยันส่ง
              </button>
            </div>
          </form>
        </div>
      </details>
    </div>
  );
}
