'use client';

/**
 * แผงเทียบยอด — Invoice DO อยู่ซ้าย Slip อยู่ขวา
 *
 * ANN ต้องดูสองใบพร้อมกันเพื่อเช็คว่ายอดตรงกันก่อนรวมชุด
 * เปิดทีละใบแล้วสลับไปมาจำตัวเลขไม่ไหว จึงวางคู่กันในจอเดียว
 *
 * งานหนึ่งมี Slip ได้หลายใบ (ค่า DO · มัดจำตู้ · DEM …) ฝั่งขวาจึงมีแถบเลือกใบ
 * Invoice DO ค้างไว้ฝั่งซ้ายตลอด สลับดูสลิปทีละใบได้โดยไม่ต้องปิดแผง
 */
import { useState } from 'react';
import { SlipReadButton } from '@/components/SlipReadButton';
import { doAttachLabel, type DoAttachment } from '@/lib/do-attachments';

export type PreviewFile = { id: string; fileName: string; mimeType: string | null };

function Preview({ file, label }: { file?: PreviewFile; label: string }) {
  if (!file) {
    return (
      <div className="slip-pane">
        <div className="slip-pane-head">{label}</div>
        <div className="slip-empty">ยังไม่มีไฟล์</div>
      </div>
    );
  }
  const src = `/files/${file.id}`;
  const isImage = (file.mimeType ?? '').startsWith('image/');
  return (
    <div className="slip-pane">
      <div className="slip-pane-head">
        <span>{label}</span>
        <a className="button tiny" href={src} target="_blank" rel="noreferrer">เปิดเต็มจอ</a>
      </div>
      {/* รูปใช้ <img> ส่วน PDF ใช้ <object> เพราะเบราว์เซอร์มีตัวอ่าน PDF ในตัวอยู่แล้ว */}
      {isImage ? (
        <img className="slip-view" src={src} alt={file.fileName} />
      ) : (
        <object className="slip-view" data={src} type="application/pdf">
          <p className="slip-empty">
            เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ · <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
          </p>
        </object>
      )}
      <div className="slip-pane-foot">{file.fileName}</div>
    </div>
  );
}

export function SlipCheckPanel({
  jobId, invoiceDo, slips,
}: { jobId: string; invoiceDo?: PreviewFile; slips: DoAttachment[] }) {
  const [picked, setPicked] = useState(0);
  const slip = slips[Math.min(picked, slips.length - 1)];

  return (
    <div className="slip-check">
      <p className="slip-hint">เทียบยอดเงินใน Invoice DO กับ Slip ให้ตรงกันก่อนรวมชุด</p>
      {slips.length > 1 ? (
        <div className="slip-tabs" role="tablist" aria-label="เลือก Slip">
          {slips.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === slip?.id}
              className={`button tiny${s.id === slip?.id ? ' primary' : ''}`}
              onClick={() => setPicked(i)}
            >
              {i + 1}. {doAttachLabel(s.category)}
            </button>
          ))}
        </div>
      ) : null}
      {/* อ่านได้เฉพาะสลิปที่เป็นรูป — PDF ให้ดูเทียบเอง · key ทำให้ผลอ่านของใบก่อนไม่ค้างตอนสลับใบ */}
      {slip && (slip.mimeType ?? '').startsWith('image/') ? (
        <SlipReadButton key={slip.id} jobId={jobId} fileId={slip.id} />
      ) : null}
      <div className="slip-grid">
        <Preview file={invoiceDo} label="Invoice DO" />
        <Preview file={slip} label={slip ? `Slip ${doAttachLabel(slip.category)}` : 'Slip โอนเงิน'} />
      </div>
    </div>
  );
}
