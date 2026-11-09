import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { getCharge } from '@/lib/sale/charge-store';
import { CHARGE_STATUS, SALE_EDITABLE, type ChargeStatus } from '@/lib/sale/charges';
import { baht } from '@/lib/sale/pricing';
import { reviewCharge, submitCharge, uploadEvidence } from '@/lib/actions/sale';
import { NegotiationForm } from '@/components/NegotiationForm';

export const dynamic = 'force-dynamic';

const ACTION_TEXT: Record<string, string> = {
  SHIPME_CHARGE_RECEIVED: '📥 รับชุดจาก SHIPME', SHIPME_CHARGE_UPDATED: '🔁 SHIPME ส่งชุดเดิมมาอัปเดต',
  SALE_NEGOTIATE: '💬 Sale บันทึกผลการเจรจา', SALE_EVIDENCE: '📎 Sale แนบหลักฐาน', SALE_SUBMIT: '📤 ส่งให้ Supervisor ตรวจ',
  SUPERVISOR_APPROVE: '✅ Supervisor อนุมัติ', SUPERVISOR_RETURN: '↩️ Supervisor ส่งกลับแก้',
};

/** รายละเอียดค่าใช้จ่ายพิเศษหนึ่งชุด — เจรจา · หลักฐาน · ตรวจสอบ · ประวัติ */
export default async function ChargeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserReady(['SALE', 'SALE_SUPERVISOR']);
  const { id } = await params;
  const data = await getCharge(id);
  if (!data) notFound();
  const { head, items, files } = data;
  const status = head.status as ChargeStatus;
  const editable = SALE_EDITABLE.includes(status);
  const supervisor = roleAllows(user.role, ['SALE_SUPERVISOR']);
  const shipmeFiles = files.filter((f) => f.source === 'SHIPME');
  const evidence = files.filter((f) => f.source === 'SALE');

  const FileList = ({ list }: { list: typeof files }) => (
    <div className="charge-files">
      {list.map((f) => (
        <a key={f.id} href={`/sale/charge-file/${f.id}`} target="_blank" rel="noreferrer" className="charge-file" title={f.fileName}>
          {/^image\//.test(f.mimeType ?? '')
            ? <img src={`/sale/charge-file/${f.id}`} alt={f.fileName} loading="lazy" />
            : <span className="charge-pdf">PDF</span>}
          <small>{f.fileName}</small>
          {f.note ? <small className="muted">{f.note}</small> : null}
          <small className="muted">{f.by ? `${f.by} · ` : ''}{formatDateTime(f.uploadedAt)}</small>
        </a>
      ))}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>ค่าใช้จ่ายพิเศษ · BL {head.blNo}</h1>
        <p><Link href="/sale/charges">← กลับไปรายการ</Link></p>
      </div>

      <section className="cgi-card">
        <div className="cgi-head">
          <div><span>สถานะ</span><b>{CHARGE_STATUS[status] ?? status}</b></div>
          <div><span>งาน</span><b>{data.job ? <Link href={`/job/${data.job.id}`}>{data.job.jobNo}</Link> : 'ยังไม่พบงานที่ BL นี้'}</b></div>
          <div><span>ชุดใบแจ้งหนี้ SHIPME</span><b>{head.invoiceNo ?? '-'}</b><small>{head.shipmeBatchId}</small></div>
          <div><span>รับเมื่อ</span><b>{formatDateTime(head.receivedAt)}</b><small>{head.issuedAt ? `ออกใบ ${formatDateTime(head.issuedAt)}` : ''}</small></div>
          <div><span>ยอดที่ขอ</span><b>{baht(Number(head.requestedTotal))} {head.currency}</b></div>
          <div><span>ยอดที่ตกลง</span><b>{head.agreedTotal === null ? '-' : `${baht(Number(head.agreedTotal))} ${head.currency}`}</b><small>{data.saleName ? `โดย ${data.saleName}` : ''}</small></div>
        </div>
        {head.shipmeNote ? <p className="nego-shipme">หมายเหตุจาก SHIPME: {head.shipmeNote}</p> : null}
        {status === 'RETURNED' && head.reviewNote ? <p className="cgi-error">↩️ Supervisor ส่งกลับ: {head.reviewNote}</p> : null}
        {status === 'APPROVED' ? <p className="nego-ok">✅ อนุมัติโดย {data.reviewName ?? '-'} · {formatDateTime(head.reviewAt)}{head.reviewNote ? ` — ${head.reviewNote}` : ''}</p> : null}
      </section>

      <section className="cgi-card">
        <h2>รายการและการเจรจา</h2>
        <NegotiationForm chargeId={id} items={items} saleNote={head.saleNote ?? ''} editable={editable} />
      </section>

      <section className="cgi-card">
        <h2>รูป / ไฟล์จาก SHIPME ({shipmeFiles.length})</h2>
        {shipmeFiles.length ? <FileList list={shipmeFiles} /> : <p className="muted">ไม่มีไฟล์แนบ</p>}
      </section>

      <section className="cgi-card">
        <h2>หลักฐานการเจรจาของ Sale ({evidence.length})</h2>
        {evidence.length ? <FileList list={evidence} /> : <p className="muted">ยังไม่มี — ต้องแนบอย่างน้อย 1 ไฟล์ก่อนส่งให้ Supervisor ตรวจ</p>}
        {editable ? (
          <form action={uploadEvidence} className="charge-upload">
            <input type="hidden" name="chargeId" value={id} />
            <input type="file" name="file" accept="image/*,application/pdf" required />
            <input name="note" placeholder="คำอธิบาย เช่น แชท LINE กับ SHIPME วันที่ …" />
            <button type="submit" className="button">แนบหลักฐาน</button>
          </form>
        ) : null}
      </section>

      {editable ? (
        <section className="cgi-card cgi-save">
          <p>บันทึกยอดที่ตกลงครบทุกรายการ และแนบหลักฐานแล้ว จึงส่งให้ SALE SUPERVISOR ตรวจได้</p>
          <form action={submitCharge}>
            <input type="hidden" name="chargeId" value={id} />
            <button type="submit" className="button primary">📤 ส่งให้ Supervisor ตรวจ</button>
          </form>
        </section>
      ) : null}

      {status === 'SUBMITTED' && supervisor ? (
        <section className="cgi-card">
          <h2>ตรวจสอบ (SALE SUPERVISOR)</h2>
          <form action={reviewCharge} className="charge-review">
            <input type="hidden" name="chargeId" value={id} />
            <textarea name="reviewNote" rows={2} placeholder="ความเห็น (ส่งกลับต้องใส่เหตุผล)" />
            <div className="price-actions">
              <button type="submit" name="decision" value="RETURNED" className="button">↩️ ส่งกลับแก้</button>
              <button type="submit" name="decision" value="APPROVED" className="button primary">✅ อนุมัติ</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="cgi-card">
        <h2>ประวัติ</h2>
        <ul className="charge-log">
          {data.events.map((e, i) => (
            <li key={i}><small>{formatDateTime(e.at)}</small> {ACTION_TEXT[e.action] ?? e.action} <span className="muted">· {e.by ?? (e.userId === 'SHIPME' ? 'ERP SHIPME' : '-')}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}
