'use client';

import { useEffect } from 'react';
import { DoRowForm, type Choice } from '@/components/DoRowForm';

/**
 * แผงกรอกข้อมูล DO คู่กับไฟล์ Invoice DO
 *
 * FAH ต้องอ่านยอดจาก Invoice DO แล้วคีย์ ETA · Port · Terminal · Partner
 * ถ้าให้กรอกในตาราง ช่องทั้งสี่ต้องเบียดอยู่ในเซลล์เดียวจนซ้อนกันสามบรรทัด
 * และเปิดไฟล์ทีก็บังตารางอีก ย้ายมาไว้ในแผงเดียวกับไฟล์จึงอ่านไปกรอกไปได้
 * โดยช่องไม่ต้องแคบ ส่วนตารางทางขวาเหลือไว้อ่านและใช้คลิกสลับแถว
 */

export type DoPaneJob = {
  id: string;
  jobNo: string;
  blNo: string | null;
  consigneeName: string | null;
  eta: string | null;
  portId: string | null;
  terminalId: string | null;
  releasePartner: string | null;
  invoiceFileId: string | null;
  invoiceFileName: string | null;
};

export function DoFillPane({
  job, ports, terminals, partners, defaultPortId, defaultPartnerId, sentAt, onClose,
}: {
  job: DoPaneJob;
  ports: Choice[];
  terminals: Choice[];
  partners: Choice[];
  defaultPortId: string | null;
  defaultPartnerId: string | null;
  sentAt: string | null;
  onClose: () => void;
}) {
  // เปิดแผงแล้วดันตารางไปทางขวา ไม่ให้แผงทับจนคลิกสลับแถวไม่ได้
  useEffect(() => {
    document.body.classList.add('has-dock-pane');
    return () => document.body.classList.remove('has-dock-pane');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const src = job.invoiceFileId ? `/files/${job.invoiceFileId}` : '';

  return (
    <div className="drawer-root dock-root">
      {/* ไม่มีฉากหลังทึบ เพราะตารางข้างหลังต้องคลิกสลับแถวได้ขณะแผงกางอยู่ */}
      <aside className="job-drawer open wide dock-left" aria-label={`กรอกข้อมูล DO งาน ${job.jobNo}`}>
        <header className="drawer-header">
          <div>
            <small>Invoice DO · งาน {job.jobNo}</small>
            <h2 className="drawer-file">{job.blNo ?? job.jobNo}</h2>
          </div>
          <div className="drawer-nav">
            {job.consigneeName ? <span className="wide">{job.consigneeName}</span> : null}
            {src ? (
              <a className="button tiny" href={src} target="_blank" rel="noreferrer" title="เปิดแท็บใหม่">⤢</a>
            ) : null}
            <button type="button" className="icon-button" onClick={onClose} title="ปิด (Esc)" aria-label="ปิด">
              ×
            </button>
          </div>
        </header>

        <div className="drawer-content do-pane">
          {/* ไฟล์อยู่บน ฟอร์มอยู่ล่าง อ่านยอดแล้วสายตาไหลลงมาที่ช่องกรอกพอดี */}
          {src ? (
            <object className="do-pane-view" data={src} type="application/pdf">
              <p className="drawer-note warn">
                เบราว์เซอร์นี้แสดงไฟล์นี้ในหน้าไม่ได้ ·{' '}
                <a href={src} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a>
              </p>
            </object>
          ) : (
            <p className="drawer-note warn">ยังไม่ได้อัปโหลด Invoice DO ของงานนี้</p>
          )}

          <div className="do-pane-form">
            <DoRowForm
              jobId={job.id}
              eta={job.eta}
              portId={job.portId ?? defaultPortId}
              terminalId={job.terminalId}
              partnerName={job.releasePartner}
              defaultPartnerId={defaultPartnerId}
              ports={ports}
              terminals={terminals}
              partners={partners}
              sentAt={sentAt}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
