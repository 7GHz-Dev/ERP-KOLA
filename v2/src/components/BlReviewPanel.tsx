'use client';

import { useState } from 'react';
import { ApproveReject } from '@/components/ActionForms';
import type { PreviewDoc } from '@/components/BlEditPanel';

/**
 * แผงตรวจเอกสารก่อนอนุมัติ — ข้อมูลที่กรอกไว้อยู่ซ้าย ไฟล์ AN/BL อยู่ขวา
 *
 * NAMKANG ต้องเทียบว่าค่าที่ PAINT คีย์มาตรงกับใบจริงไหมก่อนกดอนุมัติ
 * เดิมต้องเปิดไฟล์คนละหน้าแล้วสลับไปมา จำเลขข้ามหน้าพลาดง่าย
 * อ่านอย่างเดียว แก้ไม่ได้ เพราะถ้าข้อมูลผิดต้องตีกลับให้ PAINT แก้ ไม่ใช่แก้แทน
 */

const LABEL: Record<string, string> = { ARRIVAL_NOTICE: 'Arrival Notice', BL: 'Bill of Lading' };

export function BlReviewPanel({
  rows, approvalId, source, other,
}: {
  /** คู่ป้าย-ค่า ที่เรนเดอร์มาจากฝั่งเซิร์ฟเวอร์แล้ว */
  rows: Array<[string, string]>;
  approvalId: string | null;
  source?: PreviewDoc;
  other?: PreviewDoc;
}) {
  const [shown, setShown] = useState(source?.id ?? '');
  const docs = [source, other].filter(Boolean) as PreviewDoc[];
  const doc = docs.find((d) => d.id === shown) ?? docs[0];
  const src = doc ? `/files/${doc.id}` : null;
  const isImage = (doc?.mimeType ?? '').startsWith('image/');

  return (
    <div className="bl-edit">
      <div className="bl-edit-form">
        <p className="edit-bl-group">ข้อมูลที่กรอกไว้</p>
        <dl className="review-kv">
          {rows.map(([k, v]) => (
            <div key={k} className="review-row">
              <dt>{k}</dt>
              <dd>{v || '-'}</dd>
            </div>
          ))}
        </dl>
        {approvalId ? (
          <div className="bl-edit-actions">
            <ApproveReject approvalId={approvalId} />
          </div>
        ) : null}
      </div>

      <div className="bl-edit-view">
        <div className="slip-pane-head">
          {docs.length > 1 ? (
            <span className="chip-row">
              {docs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`button tiny${d.id === doc?.id ? ' primary' : ''}`}
                  onClick={() => setShown(d.id)}
                >
                  {LABEL[d.category] ?? d.category}
                </button>
              ))}
            </span>
          ) : (
            <span>{doc ? LABEL[doc.category] ?? doc.category : 'เอกสารต้นทาง'}</span>
          )}
          {src ? (
            <a className="button tiny" href={src} target="_blank" rel="noreferrer">เปิดเต็มจอ</a>
          ) : null}
        </div>
        {!src ? (
          <div className="slip-empty">ไม่มีไฟล์ AN หรือ BL ของงานนี้</div>
        ) : isImage ? (
          <img className="bl-edit-file" src={src} alt={doc?.fileName ?? ''} />
        ) : (
          <object className="bl-edit-file" data={src} type="application/pdf">
            <p className="slip-empty">
              เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ ·{' '}
              <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
            </p>
          </object>
        )}
      </div>
    </div>
  );
}
