'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveDoLetterText } from '@/lib/actions/do-letter';

/**
 * แผงแก้ข้อความบนจดหมายแลก D/O
 *
 * ฟอร์มอยู่ซ้าย จดหมายที่ออกไว้แล้วอยู่ขวา แก้แล้วกดออกใหม่เห็นผลในจอเดียว
 *
 * ทุกช่องเว้นว่างได้ ค่าที่ขึ้นเป็น placeholder คือค่าจากข้อมูลงานที่จะถูกพิมพ์ถ้าไม่แก้
 * จึงเห็นได้ทันทีว่าช่องไหนกำลังใช้ค่าอัตโนมัติ ช่องไหนถูกแก้เอง
 */

export type DetailValues = {
  blNo: string | null;
  origin: string | null;
  destination: string | null;
  vessel: string | null;
  eta: string | null;
};

const ROWS: Array<{ key: keyof DetailValues; label: string; hint: string }> = [
  { key: 'blNo', label: 'B/L No.', hint: 'เลขที่ใบตราส่ง' },
  { key: 'origin', label: 'เมืองต้นทาง', hint: 'ว่างไว้ = อ่านจาก BL หรือ Arrival Notice ให้เอง' },
  { key: 'destination', label: 'เมืองปลายทาง', hint: 'ปกติคือแหลมฉบัง' },
  { key: 'vessel', label: 'เรือ / เที่ยว', hint: 'เช่น SITC HAIPHONG  V. 2404N' },
  { key: 'eta', label: 'ETA', hint: 'วันที่เรือเข้า' },
];

function SubmitButton({ hasLetter }: { hasLetter: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? 'กำลังออกจดหมาย…' : hasLetter ? 'บันทึกและออกจดหมายใหม่' : 'บันทึกและออกจดหมาย'}
    </button>
  );
}

export function DoLetterEditPanel({
  jobId, line, fromJob, edited, letter,
}: {
  jobId: string;
  line: string | null;
  fromJob: DetailValues;
  edited: DetailValues;
  letter?: { id: string; fileName: string };
}) {
  // ถือค่าในฟอร์มไว้เอง เพื่อให้ปุ่ม "กลับไปใช้ค่าจากงาน" ล้างช่องได้ทันที
  const [values, setValues] = useState<DetailValues>(edited);

  const set = (key: keyof DetailValues, value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <div className="do-letter-edit">
      <form className="do-letter-form" action={saveDoLetterText}>
        <input type="hidden" name="jobId" value={jobId} />

        {line ? null : (
          <p className="client-cell-note bad">
            งานนี้ยังไม่มีแบบฟอร์มจดหมายของสายเรือ — ออกจดหมายไม่ได้จนกว่าจะตั้งค่าที่ Master Data
          </p>
        )}

        <p className="slip-hint">
          ช่องที่เว้นว่างจะใช้ค่าจากข้อมูลงาน (ข้อความจาง ๆ ในช่อง) ·
          การแก้ตรงนี้มีผลกับจดหมายฉบับนี้เท่านั้น ไม่เปลี่ยนข้อมูลงาน
        </p>

        {ROWS.map((row) => {
          const auto = fromJob[row.key];
          const current = values[row.key] ?? '';
          return (
            <label className="field" key={row.key}>
              <span>
                {row.label}
                {current.trim() ? <em className="do-letter-flag">แก้เอง</em> : null}
              </span>
              <input
                type="text"
                name={row.key}
                value={current}
                maxLength={200}
                placeholder={auto ?? '— ไม่มีค่าจากงาน ปล่อยว่างบนจดหมาย —'}
                onChange={(e) => set(row.key, e.target.value)}
              />
              <small className="do-letter-hint">
                {current.trim() && auto ? `ค่าจากงาน: ${auto}` : row.hint}
              </small>
            </label>
          );
        })}

        <div className="do-letter-actions">
          <SubmitButton hasLetter={Boolean(letter)} />
          <button
            type="button"
            className="button ghost"
            onClick={() => setValues({
              blNo: '', origin: '', destination: '', vessel: '', eta: '',
            })}
          >
            กลับไปใช้ค่าจากงานทั้งหมด
          </button>
        </div>
      </form>

      <div className="slip-pane">
        <div className="slip-pane-head">
          <span>จดหมายฉบับล่าสุด</span>
          {letter ? (
            <a className="button tiny" href={`/files/${letter.id}`} target="_blank" rel="noreferrer">
              เปิดเต็มจอ
            </a>
          ) : null}
        </div>
        {letter ? (
          <object className="slip-view" data={`/files/${letter.id}`} type="application/pdf">
            <p className="slip-empty">
              เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ ·{' '}
              <a href={`/files/${letter.id}`} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
            </p>
          </object>
        ) : (
          <div className="slip-empty">ยังไม่เคยออกจดหมาย — กรอกแล้วกดออกจดหมายได้เลย</div>
        )}
        {letter ? <div className="slip-pane-foot">{letter.fileName}</div> : null}
      </div>
    </div>
  );
}
