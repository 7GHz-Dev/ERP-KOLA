import Link from 'next/link';
import { AcknowledgeInvoice } from '@/components/ActionForms';
import { addDays, fileSize, formatDate, formatDateTime, num } from '@/lib/format';
import { statusLabel, statusTone, surrenderLabel } from '@/lib/status';
import { FILE_ORDER, fileLabel, type JobDetail } from '@/lib/queries/job-detail';

/**
 * เนื้อในของ Drawer สรุปงาน — วางหัวข้อชุดเดียวกับระบบเดิม
 *
 * ลำดับและชื่อช่องยกมาจาก renderDrawer() ของเดิมทั้งหมด เพราะทีมจำตำแหน่ง
 * ของแต่ละค่าได้อยู่แล้ว เปลี่ยนลำดับใหม่จะทำให้ต้องไล่หาใหม่ทุกครั้ง
 * ใช้ร่วมกันระหว่าง Drawer กับหน้าเต็ม /job/[id] จึงไม่มีทางแสดงไม่ตรงกัน
 */

function Kv({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="key">{label}</div>
      <div className={wide ? 'value wide' : 'value'}>{children ?? '-'}</div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="drawer-section">
      <div className="drawer-section-title">{title}</div>
      {children}
    </section>
  );
}

const TASK_STATUS: Record<string, string> = {
  QUEUED: 'รอคิว', PROCESSING: 'กำลังทำ', DONE: 'สำเร็จ', ERROR: 'ผิดพลาด',
};

export function JobSummary({ detail, canAck }: { detail: JobDetail; canAck?: boolean }) {
  const { job, files, history, entries, handoff, eoffice, tasks, containers, bls } = detail;

  const current = files.filter((f) => f.isCurrent);
  const older = files.filter((f) => !f.isCurrent);
  const ordered = [...current].sort(
    (a, b) => (FILE_ORDER.indexOf(a.category) + 1 || 99) - (FILE_ORDER.indexOf(b.category) + 1 || 99),
  );
  const invoice = current.find((f) => f.category === 'INVOICE_GOODS');

  // Shipper และ BL อ่านจากรายการ BL ก่อน เพราะงานหนึ่งใบมีได้หลาย BL
  const shipperNames = bls.map((b) => b.shipperName).filter(Boolean) as string[];
  const blNos = bls.map((b) => b.blNo).filter(Boolean) as string[];

  return (
    <div className="drawer-body-inner">
      {job.hasInvoiceAlert && invoice ? (
        <div className="warning-box">
          <strong>Invoice สินค้าถูกเปลี่ยน</strong>
          <span>เหตุผล: {invoice.changeReason || '-'}</span>
          {canAck ? <AcknowledgeInvoice jobId={job.id} /> : null}
        </div>
      ) : null}

      {/*
        เปลี่ยนไฟล์แล้วมีคนกดรับทราบไปแล้ว — บอกว่าใครกดและเมื่อไร
        ไฟล์ที่อัปครั้งแรกไม่นับ เพราะไม่ได้ผ่านการรับทราบจริง (ระบบตั้ง true ให้เอง)
      */}
      {!job.hasInvoiceAlert && invoice?.acknowledgedByName ? (
        <p className="ack-note">
          Invoice สินค้าเคยถูกเปลี่ยน · <b>{invoice.acknowledgedByName}</b> กดรับทราบแล้ว
          {invoice.acknowledgedAt ? ` เมื่อ ${formatDateTime(invoice.acknowledgedAt)}` : ''}
        </p>
      ) : null}

      <div className="drawer-status">
        <span className={`badge ${statusTone(job.status)}`}>{statusLabel(job.status)}</span>
      </div>

      <Section title="ข้อมูลงาน (Job Detail)">
        <div className="drawer-kv">
          <Kv label="Shipper name" wide>
            {shipperNames.length
              ? shipperNames.map((n) => <div key={n}>{n}</div>)
              : job.shipperName ?? '-'}
          </Kv>
          <Kv label="Consignee name">{job.consigneeName ?? '-'}</Kv>
          <Kv label="Notify party">{job.notifyName ?? '-'}</Kv>
          <Kv label="Client in charge">{job.personName ?? '-'}</Kv>
          <Kv label="Job type">{job.jobTypeName ?? '-'}</Kv>
          <Kv label="Description of Goods">{job.product ?? '-'}</Kv>
          <Kv label="ETA Date">{formatDate(job.eta)}{job.etaIsOfficial ? ' (OFC)' : ''}</Kv>
          <Kv label="Last Date of DEM">{formatDate(addDays(job.eta, job.demDays))}</Kv>
          <Kv label="Last Date of DET">{formatDate(addDays(job.transportDate, job.detDays))}</Kv>
          <Kv label="Invoice">{invoice ? invoice.fileName : 'รอดำเนินการ'}</Kv>
          <Kv label="Surrender">{surrenderLabel(job.surrenderStatus)}</Kv>
          <Kv label="Bill of Lading No." wide>
            {blNos.length ? blNos.map((n) => <div key={n}>{n}</div>) : job.blNo ?? '-'}
          </Kv>
          <Kv label="Unit amount">
            {job.unitAmount ? `${num(job.unitAmount)} ${job.packageType ?? ''}`.trim() : '-'}
          </Kv>
          <Kv label="Gross weight">{job.grossWeight ? `${num(job.grossWeight)} kg` : '-'}</Kv>
          <Kv label="Ship line">{job.shipline ?? '-'}</Kv>
          <Kv label="Vessel">{job.vessel ?? '-'}</Kv>
          <Kv label="Voyage name">{job.voyage ?? '-'}</Kv>
          <Kv label="Port of Discharge">{job.portName ?? '-'}</Kv>
          <Kv label="Port Terminal">{job.terminalName ?? '-'}</Kv>
          <Kv label="DEM / DET">{job.demDays} / {job.detDays} วัน</Kv>
          <Kv label="Draft Ref">{job.draftRefNo ?? '-'}</Kv>
          <Kv label="Im-Dcrl No.">{entries[0]?.declarationNo ?? '-'}</Kv>
          <Kv label="Port Release Partner">{job.releasePartner ?? handoff?.partnerName ?? '-'}</Kv>
        </div>
        {job.draftStatus === 'REJECTED' && job.draftRejectReason ? (
          <p className="drawer-note warn">Draft ถูกตีกลับ: {job.draftRejectReason}</p>
        ) : null}
        {job.customerNote ? <p className="drawer-note">หมายเหตุลูกค้า: {job.customerNote}</p> : null}
      </Section>

      <Section title={`Container no. [ ${containers.length} ]`}>
        <div className="container-box">
          {containers.length ? (
            containers.map((c) => (
              <div key={c.id} className="container-line">
                {c.containerNo} ({c.runningNo ?? job.jobNo}) {c.containerType ?? ''}
              </div>
            ))
          ) : (
            'รอดำเนินการ'
          )}
        </div>
      </Section>

      <Section title="File / เอกสาร">
        {ordered.length ? (
          ordered.map((f) => (
            <div key={f.id} className="document-line">
              <span className="label">{fileLabel(f.category)}</span>
              <span className="badge approved">{f.fileName} · v{f.version}</span>
              <Link className="button tiny" href={`/file/${f.id}`}>ดูไฟล์</Link>
            </div>
          ))
        ) : (
          <div className="drawer-empty">รอดำเนินการ</div>
        )}

        {older.length ? (
          <details className="old-files">
            <summary>เวอร์ชันเก่า {older.length} ไฟล์</summary>
            {older.map((f) => (
              <div key={f.id} className="document-line old">
                <span className="label">{fileLabel(f.category)}</span>
                <span>
                  {f.fileName} · v{f.version}
                  {f.sizeBytes ? ` · ${fileSize(f.sizeBytes)}` : ''}
                  {' · '}{f.uploaderName ?? 'ไม่ทราบผู้อัปโหลด'} · {formatDateTime(f.uploadedAt)}
                  {f.changeReason ? ` · เหตุผลที่เปลี่ยน: ${f.changeReason}` : ''}
                  {f.acknowledgedByName ? ` · ${f.acknowledgedByName} รับทราบ` : ''}
                </span>
                <Link className="button tiny" href={`/file/${f.id}`}>ดูไฟล์</Link>
              </div>
            ))}
          </details>
        ) : null}
      </Section>

      {eoffice || tasks.length ? (
        <Section title="คำร้อง E-Office · คิว Automation">
          {eoffice ? (
            <div className="drawer-kv">
              <Kv label="เลขที่คำร้อง">
                <Link href={`/eoffice/${job.id}`}>{eoffice.requestNo}</Link>
              </Kv>
              <Kv label="วันที่คำร้อง">{formatDate(eoffice.requestDate)}</Kv>
              <Kv label="จำนวนหีบห่อ / น้ำหนัก">{eoffice.packageCount} · {eoffice.netWeight}</Kv>
              <Kv label="ราคาของ">{eoffice.goodsValue}</Kv>
            </div>
          ) : null}
          {tasks.length ? (
            <div className="task-list">
              {tasks.map((t) => (
                <div key={t.id} className="document-line">
                  <span className="label">{t.type === 'DRAFT_ENTRY' ? 'สร้าง Draft' : 'ทำใบขน'}</span>
                  <span>
                    {TASK_STATUS[t.status] ?? t.status}
                    {' · '}
                    {t.resultEntryNo ?? t.resultRefNo ?? t.error ?? '-'}
                  </span>
                  <span className="when">{formatDateTime(t.completedAt ?? t.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="ไทม์ไลน์สถานะ">
        <div className="timeline-list">
          {history.length ? (
            history.map((h) => (
              <div key={h.id} className="timeline-item">
                <b>{statusLabel(h.toStatus)}</b>
                <span>
                  {h.note ?? ''}
                  {h.actorName ? ` · ${h.actorName}` : ''}
                  {' · '}{formatDateTime(h.createdAt)}
                </span>
              </div>
            ))
          ) : (
            <div className="timeline-item"><b>{statusLabel(job.status)}</b></div>
          )}
        </div>
      </Section>
    </div>
  );
}
