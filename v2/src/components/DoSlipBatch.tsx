'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { attachDoSlip } from '@/lib/actions/files';
import { SearchSelect } from '@/components/SearchSelect';
import type { SlipChoice } from '@/lib/do-slip-match';

/**
 * อัป Slip ค่าแลก D/O ทีละหลายรูป — ระบบอ่านเลข BL จากช่องบันทึกช่วยจำแล้วจับคู่งานให้
 *
 * MAY โอนเงินจากแอปธนาคารบนมือถือเป็นชุด ได้สลิปมาหลายรูปพร้อมกัน
 * เดิมต้องไล่หาแถวแล้วอัปทีละใบ ตรงนี้เลือกรูปทั้งหมดจากคลังรูปทีเดียว
 *
 * ทำสองจังหวะ อ่านก่อนแล้วค่อยแนบ ไม่แนบทันทีที่อ่านได้
 * ผู้ใช้เห็นว่าแต่ละรูปจะไปอยู่งานไหนแล้วแก้ได้ก่อนกด เพราะแนบผิดงานแล้วไม่มีใครสังเกต
 *
 * ออกแบบให้ใช้บนมือถือ — การ์ดเรียงลงล่าง ปุ่มแนบอยู่ล่างสุดเต็มความกว้าง
 */

type Row = {
  key: string;
  file: File;
  thumb: string;
  status: 'reading' | 'ok' | 'error';
  message: string;
  memo: string;
  /** งานที่จะแนบรูปนี้ — สลิปใบเดียวจ่ายหลาย BL ได้ */
  jobIds: string[];
  /** ระบบจับคู่ให้เอง ยังไม่มีคนแก้ */
  auto: boolean;
  saved?: boolean;
  saveError?: string;
};

type ReadResult = {
  ok: boolean;
  detail?: string;
  memo?: string;
  jobIds?: string[];
  from?: 'memo' | 'text' | null;
};

/** เพดานของโฮสต์ต่อคำขออยู่ราว 4.5 MB — ย่อรูปที่ใหญ่กว่านี้ก่อนส่ง */
const SHRINK_OVER = 3 * 1024 * 1024;

/**
 * ย่อรูปจากกล้องมือถือที่ใหญ่เกินให้เหลือด้านยาวไม่เกิน 2000px
 *
 * สลิปที่แคปจอมักเล็กอยู่แล้ว แต่รูปที่ถ่ายจากกล้องได้หลาย MB ส่งตรง ๆ จะหลุดเพดาน
 * 2000px ยังอ่านตัวหนังสือในช่องบันทึกช่วยจำได้ชัด ย่อไม่ได้ก็ส่งไฟล์เดิมไป
 */
async function shrink(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function DoSlipBatch({ choices }: { choices: SlipChoice[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(choices.map((c) => [c.jobId, c])), [choices]);
  const options = useMemo(() => choices.map((c) => ({
    id: c.jobId, code: c.blNo, name: [c.consigneeName, c.jobNo].filter(Boolean).join(' · '),
  })), [choices]);

  // คืนหน่วยความจำของรูปตัวอย่างตอนออกจากหน้า
  const thumbs = useRef<string[]>([]);
  useEffect(() => () => thumbs.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const patch = (key: string, next: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...next } : r)));

  async function readAll(list: FileList | null) {
    if (!list?.length) return;
    const picked = [...list].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (!picked.length) return;
    const added: Row[] = picked.map((file, n) => {
      const thumb = URL.createObjectURL(file);
      thumbs.current.push(thumb);
      return {
        key: `${Date.now()}-${n}-${file.name}`, file, thumb, status: 'reading',
        message: 'รอคิวอ่าน…', memo: '', jobIds: [], auto: false,
      };
    });
    // เลือกเพิ่มได้หลายรอบ รูปที่เลือกรอบก่อนยังอยู่
    setRows((cur) => [...cur, ...added]);
    if (input.current) input.current.value = '';

    /*
     * อ่านทีละรูป ไม่ยิงพร้อมกันทั้งชุด
     * Drive OCR มีโควตาต่อช่วงเวลา ยิงสิบรูปพร้อมกันจะโดนปัดตกกลางทาง
     */
    setBusy(true);
    for (const row of added) {
      patch(row.key, { message: 'กำลังอ่าน…' });
      try {
        const file = await shrink(row.file);
        const fd = new FormData();
        fd.set('file', file);
        const res = await fetch('/api/may/slip-read', { method: 'POST', body: fd });
        const out = (await res.json().catch(() => ({ ok: false, detail: `HTTP ${res.status}` }))) as ReadResult;
        const jobIds = (out.jobIds ?? []).filter((id) => byId.has(id));
        patch(row.key, {
          file,
          status: 'ok',
          memo: out.memo ?? '',
          jobIds,
          auto: jobIds.length > 0,
          message: !out.ok ? `${out.detail ?? 'อ่านไม่สำเร็จ'} — เลือกงานเอง`
            : jobIds.length ? (out.from === 'text' ? 'จับคู่จากเลข BL ในสลิป (ไม่พบช่องบันทึกช่วยจำ)' : 'จับคู่จากบันทึกช่วยจำ')
            : out.memo ? 'บันทึกช่วยจำไม่ตรงกับ BL ในรายการ — เลือกงานเอง'
            : 'ไม่พบเลข BL ในสลิป — เลือกงานเอง',
        });
      } catch {
        patch(row.key, { status: 'ok', message: 'เชื่อมต่อไม่ได้ — เลือกงานเอง' });
      }
    }
    setBusy(false);
  }

  /*
   * สองรูปชี้งานเดียวกัน — ไฟล์หลังจะทับไฟล์แรกจนเหลือใบเดียวโดยไม่มีใครเห็น
   * ต้องให้แก้ก่อน เหมือนหน้าแนบ AN/BL หลายไฟล์
   */
  const dupIds = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) {
      if (r.saved) continue;
      for (const id of r.jobIds) count.set(id, (count.get(id) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const isReady = (r: Row) => r.status === 'ok' && !r.saved && r.jobIds.length > 0
    && r.jobIds.every((id) => !dupIds.has(id));
  const ready = rows.filter(isReady);
  const savedCount = rows.filter((r) => r.saved).length;

  async function saveAll() {
    setBusy(true);
    // แนบทีละใบ ใบไหนพลาดใบที่เหลือยังไปต่อได้ ไม่ล้มทั้งชุด
    for (const row of ready) {
      const errors: string[] = [];
      for (const jobId of row.jobIds) {
        const fd = new FormData();
        fd.set('jobId', jobId);
        fd.set('file', row.file);
        const res = await attachDoSlip(fd).catch(() => ({ ok: false, detail: 'เชื่อมต่อไม่ได้' }));
        if (!res.ok) errors.push(`${byId.get(jobId)?.blNo ?? jobId}: ${res.detail ?? ''}`);
      }
      patch(row.key, errors.length ? { saveError: errors.join(' · ') } : { saved: true, saveError: undefined });
    }
    setBusy(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="slip-batch">
      <label className="drop-zone slip-batch-pick">
        <b>เลือกรูป Slip ได้หลายรูปพร้อมกัน</b>
        <span>ระบบอ่านเลข BL จากช่องบันทึกช่วยจำ แล้วจับคู่กับรายการให้เอง</span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          disabled={busy || !choices.length}
          onChange={(e) => void readAll(e.target.files)}
        />
      </label>

      {choices.length ? null : (
        <p className="drawer-note warn">ยังไม่มีรายการรอแลก DO ให้แนบ Slip</p>
      )}

      <div className="slip-batch-list">
        {rows.map((r, n) => (
          <article key={r.key} className={`slip-card${r.saved ? ' saved' : ''}`}>
            <a href={r.thumb} target="_blank" rel="noreferrer" className="slip-card-thumb">
              <img src={r.thumb} alt={`Slip ${n + 1}`} />
            </a>
            <div className="slip-card-body">
              <small>{n + 1}. {r.file.name}</small>
              {r.memo ? <p className="slip-card-memo">บันทึกช่วยจำ: <b>{r.memo}</b></p> : null}

              {r.jobIds.map((id) => {
                const c = byId.get(id);
                return (
                  <div key={id} className={`slip-card-job${dupIds.has(id) && !r.saved ? ' dup' : ''}`}>
                    <span>
                      <b>{c?.blNo ?? id}</b>
                      <small>{[c?.consigneeName, c?.jobNo].filter(Boolean).join(' · ')}</small>
                      {c?.hasSlip && !r.saved ? <small className="slip-card-warn">มี Slip เดิมอยู่ จะถูกแทนที่</small> : null}
                    </span>
                    {r.saved || busy ? null : (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`เอา ${c?.blNo ?? id} ออก`}
                        onClick={() => patch(r.key, { jobIds: r.jobIds.filter((x) => x !== id), auto: false })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}

              {r.saved || r.status === 'reading' ? null : (
                <label className="mini">
                  <span>{r.jobIds.length ? 'เพิ่ม BL อื่นในสลิปนี้' : 'เลือกงาน'}</span>
                  <SearchSelect
                    choices={options.filter((o) => !r.jobIds.includes(o.id))}
                    value=""
                    placeholder="พิมพ์เลข BL หรือชื่อ Consignee"
                    onChange={(id) => id && patch(r.key, { jobIds: [...r.jobIds, id], auto: false })}
                  />
                </label>
              )}

              {r.saved ? <span className="badge approved">แนบแล้ว</span>
                : r.saveError ? <span className="badge rejected">{r.saveError}</span>
                : r.jobIds.some((id) => dupIds.has(id)) ? (
                  <span className="badge rejected">BL นี้ถูกเลือกในรูปอื่นด้วย — เหลือไว้รูปเดียว</span>
                )
                : r.status === 'reading' ? <span className="badge pending">{r.message}</span>
                : <span className={r.jobIds.length ? (r.auto ? 'badge neutral' : 'badge approved') : 'badge pending'}>
                  {r.jobIds.length && !r.auto ? 'เลือกเอง' : r.message}
                </span>}
            </div>
          </article>
        ))}
      </div>

      {rows.length ? (
        <div className="slip-batch-foot">
          <span>
            พร้อมแนบ {ready.length} รูป{savedCount ? ` · แนบแล้ว ${savedCount} รูป` : ''}
          </span>
          <button
            type="button"
            className="button primary"
            disabled={busy || !ready.length}
            onClick={() => void saveAll()}
          >
            {busy ? 'กำลังทำงาน…' : `แนบ ${ready.length} รูป`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
