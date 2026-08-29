import {
  decideApproval, fileCustomsEntry, rejectDraft, releaseJob,
  requestApproval, saveDoHandoff, submitDraftForReview, updateBlInfo, updateSurrender,
} from '@/lib/actions/jobs';
import { acknowledgeInvoice, uploadJobFile } from '@/lib/actions/files';
import { submitCustomsTask, submitDraftTask } from '@/lib/actions/automation';
import { createEofficeRequest } from '@/lib/actions/eoffice';
import { saveMasterRecord } from '@/lib/actions/master';
import { ConfirmSubmit, PopoverCancel, PopoverHead } from '@/components/Interactions';
export { UploadForm } from '@/components/UploadForm';
export { MergeEofficeButton } from '@/components/MergeEofficeButton';

/**
 * ปุ่มและฟอร์มสำหรับแก้ไขข้อมูล
 *
 * ใช้ <form> + server action ล้วน ไม่มี JavaScript ฝั่งเบราว์เซอร์
 * ส่วนที่ต้องกรอกเหตุผลใช้ <details> ซึ่งเป็น HTML มาตรฐาน กดแล้วกางออกมาเองได้
 */

export function SubmitButton({ label, tone }: { label: string; tone?: 'primary' | 'danger' | 'ok' }) {
  return (
    <button className={`button tiny ${tone ?? ''}`} type="submit">
      {label}
    </button>
  );
}

export function RequestApproval({ jobId, type, label }: { jobId: string; type: 'AN' | 'FN'; label: string }) {
  return (
    <form action={requestApproval} className="inline-form">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="type" value={type} />
      <ConfirmSubmit
        label={label}
        tone="primary"
        confirm={`ส่งรายการนี้ให้อนุมัติ ${type} ใช่ไหม`}
        detail="ส่งแล้วรายการจะย้ายไปแท็บรออนุมัติ และแก้ไขไม่ได้จนกว่าจะมีผลตัดสิน"
      />
    </form>
  );
}

export function ApproveReject({ approvalId }: { approvalId: string }) {
  return (
    <div className="row-actions">
      <form action={decideApproval} className="inline-form">
        <input type="hidden" name="approvalId" value={approvalId} />
        <input type="hidden" name="decision" value="APPROVED" />
        <ConfirmSubmit label="อนุมัติ" tone="ok" confirm="ยืนยันอนุมัติรายการนี้ใช่ไหม" />
      </form>

      {/* ไม่อนุมัติต้องมีเหตุผลเสมอ จึงกางฟอร์มออกมาก่อน ไม่ให้กดพลาด */}
      <details className="disclosure">
        <summary className="button tiny danger">ไม่อนุมัติ</summary>
        <form action={decideApproval} className="popover">
          <PopoverHead title="ไม่อนุมัติรายการ" />
          <input type="hidden" name="approvalId" value={approvalId} />
          <input type="hidden" name="decision" value="REJECTED" />
          <textarea name="reason" rows={3} placeholder="เหตุผลที่ตีกลับ" required />
          <SubmitButton label="ยืนยันไม่อนุมัติ" tone="danger" />
        </form>
      </details>
    </div>
  );
}

export function ShowReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <details className="disclosure">
      <summary className="button tiny">ดูเหตุผล</summary>
      <div className="popover reason">
        <PopoverHead title="เหตุผล" />
        {reason}
      </div>
    </details>
  );
}

export function SurrenderForm({ jobId, current }: { jobId: string; current: string | null }) {
  return (
    <details className="disclosure">
      <summary className="button tiny">เปลี่ยนสถานะ</summary>
      <form action={updateSurrender} className="popover">
        <PopoverHead title="เปลี่ยนสถานะ Surrender" />
        <input type="hidden" name="jobId" value={jobId} />
        <label className="mini">
          <span>สถานะ Surrender</span>
          <select name="surrenderStatus" defaultValue={current ?? 'PENDING'}>
            <option value="PENDING">รอดำเนินการ</option>
            <option value="CLEARED">เคลียร์แล้ว</option>
            <option value="ISSUE">มีปัญหา</option>
          </select>
        </label>
        <label className="mini">
          <span>หมายเหตุ</span>
          <input name="note" />
        </label>
        <SubmitButton label="บันทึก" tone="primary" />
      </form>
    </details>
  );
}

export function ReleaseButton({ jobId, ready, released }: { jobId: string; ready: boolean; released: boolean }) {
  if (released) return <span className="badge approved">ปล่อยแล้ว</span>;
  if (!ready) return <span className="badge pending">เอกสารยังไม่ครบ</span>;
  return (
    <details className="disclosure">
      <summary className="button tiny ok">แจ้งปล่อยสินค้า</summary>
      <form action={releaseJob} className="popover">
        <PopoverHead title="แจ้งปล่อยสินค้า" />
        <input type="hidden" name="jobId" value={jobId} />
        <label className="mini">
          <span>หมายเหตุ</span>
          <input name="note" />
        </label>
        <ConfirmSubmit label="ยืนยันปล่อยสินค้า" tone="ok"
          confirm="ยืนยันปล่อยสินค้าของงานนี้ใช่ไหม" detail="ปล่อยแล้วย้อนกลับไม่ได้" />
      </form>
    </details>
  );
}

export function RejectDraftButton({ jobId }: { jobId: string }) {
  return (
    <details className="disclosure">
      <summary className="button tiny danger">ไม่อนุมัติ</summary>
      <form action={rejectDraft} className="popover">
        <PopoverHead title="ตีกลับ Draft" />
        <input type="hidden" name="jobId" value={jobId} />
        <textarea name="reason" rows={3} placeholder="เหตุผลที่ตีกลับ Draft" required />
        <ConfirmSubmit label="ยืนยันตีกลับ" tone="danger" confirm="ยืนยันตีกลับ Draft ใบขนใช่ไหม" />
      </form>
    </details>
  );
}

export function FileCustomsForm({ jobId }: { jobId: string }) {
  return (
    <details className="disclosure">
      <summary className="button tiny primary">บันทึกเลขใบขน</summary>
      <form action={fileCustomsEntry} className="popover">
        <PopoverHead title="บันทึกเลขใบขน" />
        <input type="hidden" name="jobId" value={jobId} />
        <label className="mini">
          <span>เลขที่ใบขน</span>
          <input name="declarationNo" required />
        </label>
        <SubmitButton label="บันทึก" tone="primary" />
      </form>
    </details>
  );
}

/* ---------- ไฟล์แนบ ---------- */

export function AcknowledgeInvoice({ jobId }: { jobId: string }) {
  return (
    <form action={acknowledgeInvoice} className="inline-form">
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton label="รับทราบ" tone="primary" />
    </form>
  );
}

/* ---------- ส่งเข้าคิว automation ---------- */

export function SubmitDraftTask({
  jobId, disabled, label,
}: { jobId: string; disabled?: boolean; label?: string }) {
  if (disabled) return <span className="badge pending">ต้องมี Final Invoice ก่อน</span>;
  return (
    <form action={submitDraftTask} className="inline-form">
      <input type="hidden" name="jobId" value={jobId} />
      <ConfirmSubmit
        label={label ?? 'สร้าง Draft'}
        tone="primary"
        confirm="ส่ง Final Invoice เข้าคิวสร้าง Draft ใบขนใช่ไหม"
      />
    </form>
  );
}

export function SubmitCustomsTask({ jobId }: { jobId: string }) {
  return (
    <form action={submitCustomsTask} className="inline-form">
      <input type="hidden" name="jobId" value={jobId} />
      <ConfirmSubmit
        label="สร้างใบขน"
        tone="primary"
        confirm="ส่งงานนี้เข้าคิวสร้างใบขนสินค้าใช่ไหม"
        detail="ระบบจะส่งเลข Ref No. ให้โปรแกรมทำใบขนต่อ"
      />
    </form>
  );
}

/* ---------- คำร้อง E-Office ---------- */

export function EofficeRequestForm({
  jobId, unitAmount, packageType, grossWeight, product, hasRequest, attentionName,
}: {
  jobId: string; unitAmount: string | null; packageType: string | null;
  grossWeight: string | null; product: string | null; hasRequest: boolean;
  /** ชื่อที่จ่าหน้าถึงของคำร้องใบก่อน เติมกลับให้ตอนออกใหม่ */
  attentionName: string | null;
}) {
  return (
    <details className="disclosure">
      <summary className="button tiny primary">{hasRequest ? 'ออกคำร้องใหม่' : 'สร้างคำร้อง'}</summary>
      <form action={createEofficeRequest} className="popover wide">
        <PopoverHead title="คำร้องขอนำของเข้าเขตปลอดอากร" />
        <input type="hidden" name="jobId" value={jobId} />
        <label className="mini">
          <span>จำนวนหีบห่อ</span>
          <input name="packageCount" defaultValue={Number(unitAmount ?? 0) || ''} />
        </label>
        <label className="mini">
          <span>หน่วย</span>
          <input name="packageType" defaultValue={packageType ?? 'UNITS'} />
        </label>
        <label className="mini">
          <span>น้ำหนักสุทธิ (ไม่ต้องใส่ KGM)</span>
          <input name="netWeight" defaultValue={Number(grossWeight ?? 0) || ''} />
        </label>
        <label className="mini">
          <span>ราคาของ</span>
          <input name="goodsValue" placeholder="153,000" required />
        </label>
        <label className="mini">
          <span>สกุลเงิน</span>
          <input name="goodsCurrency" defaultValue="USD" />
        </label>
        <label className="mini">
          <span>ชนิดของ</span>
          <input name="goodsType" defaultValue={`${product ?? 'สินค้า'} (รายละเอียดตามใบขนฯ แนบ)`} />
        </label>
        <label className="mini">
          <span>เรียน คุณ</span>
          <input name="attentionName" defaultValue={attentionName ?? ''} placeholder="ชื่อเจ้าหน้าที่ที่จ่าหน้าถึง" />
        </label>
        <ConfirmSubmit label="ออกคำร้อง" tone="primary"
          confirm="ออกเลขที่คำร้องสำหรับงานนี้ใช่ไหม"
          detail="ออกใหม่ได้ แต่เลขที่คำร้องเดิมจะถูกใช้ต่อ ไม่ออกเลขใหม่" />
      </form>
    </details>
  );
}

/* ---------- Draft ใบขน: สร้าง → ส่งอนุมัติ → ถูกตีกลับ → แก้ไฟล์ → ส่งใหม่ ---------- */

export function SubmitDraftForReview({ jobId, label }: { jobId: string; label: string }) {
  return (
    <form action={submitDraftForReview} className="inline-form">
      <input type="hidden" name="jobId" value={jobId} />
      <ConfirmSubmit label={label} tone="primary" confirm={`${label} — ส่ง Draft ให้ FAH ตรวจใช่ไหม`} />
    </form>
  );
}

/**
 * ปุ่มของฝั่ง PAINT ในแท็บ Draft ใบขน
 * แสดงเฉพาะปุ่มที่กดได้จริงในสถานะนั้น ๆ จะได้ไม่ต้องเดาว่าขั้นต่อไปคืออะไร
 */
export function DraftActions({
  jobId, draftStatus, hasRefNo, hasInvoice,
}: {
  jobId: string; draftStatus: string | null; hasRefNo: boolean; hasInvoice: boolean;
}) {
  if (draftStatus === 'SENT_TO_HUB') {
    return <span className="badge pending">รอ Automation สร้าง Draft</span>;
  }
  if (draftStatus === 'SUBMITTED') {
    return <span className="badge pending">รอ FAH ตรวจ</span>;
  }

  // ถูกตีกลับ: แก้ไฟล์แล้วส่งใหม่ได้เลย หรือจะให้ automate สร้าง Draft ใหม่ก็ได้
  return (
    <>
      {hasRefNo ? (
        <SubmitDraftForReview
          jobId={jobId}
          label={draftStatus === 'REJECTED' ? 'ส่งตรวจอีกครั้ง' : 'ส่งให้ FAH ตรวจ'}
        />
      ) : null}
      {hasInvoice ? (
        <SubmitDraftTask jobId={jobId} label={hasRefNo ? 'สร้าง Draft ใหม่' : 'สร้าง Draft'} />
      ) : (
        <span className="badge pending">ต้องมี Final Invoice ก่อน</span>
      )}
    </>
  );
}

/** แก้ข้อมูล BL ที่คีย์ผิด — ใช้ตอนที่ยังไม่ส่งอนุมัติ AN */
export function EditBlForm({
  jobId, blNo, vessel, voyage, eta, transportDate, demDays, detDays, product,
}: {
  jobId: string; blNo: string | null; vessel: string | null; voyage: string | null;
  eta: string | null; transportDate: string | null;
  demDays: number; detDays: number; product: string | null;
}) {
  return (
    <details className="disclosure">
      <summary className="button tiny">แก้ไข</summary>
      <form action={updateBlInfo} className="popover wide">
        <PopoverHead title="แก้ข้อมูล BL" />
        <input type="hidden" name="jobId" value={jobId} />
        <label className="mini">
          <span>B/L No.</span>
          <input name="blNo" defaultValue={blNo ?? ''} />
        </label>
        <div className="field-pair">
          <label className="mini">
            <span>Vessel</span>
            <input name="vessel" defaultValue={vessel ?? ''} />
          </label>
          <label className="mini">
            <span>Voyage</span>
            <input name="voyage" defaultValue={voyage ?? ''} />
          </label>
        </div>
        <div className="field-pair">
          <label className="mini">
            <span>ETA</span>
            <input type="date" name="eta" defaultValue={eta ?? ''} />
          </label>
          <label className="mini">
            <span>วันที่ขนย้าย</span>
            <input type="date" name="transportDate" defaultValue={transportDate ?? ''} />
          </label>
        </div>
        <div className="field-pair">
          <label className="mini">
            <span>DEM (วัน)</span>
            <input type="number" min={0} name="demDays" defaultValue={demDays} />
          </label>
          <label className="mini">
            <span>DET (วัน)</span>
            <input type="number" min={0} name="detDays" defaultValue={detDays} />
          </label>
        </div>
        <label className="mini">
          <span>สินค้า</span>
          <input name="product" defaultValue={product ?? ''} />
        </label>
        <div className="dialog-actions">
          <PopoverCancel />
          <SubmitButton label="บันทึก" tone="primary" />
        </div>
      </form>
    </details>
  );
}

/* ---------- Master Data ---------- */

export function MasterRecordForm({
  type, typeLabel, record, isSettings,
}: {
  type: string;
  typeLabel: string;
  /** ไม่ส่งมา = เพิ่มรายการใหม่ */
  record?: { id: string; code: string | null; name: string; description: string | null;
    value: string | null; isActive: boolean };
  isSettings: boolean;
}) {
  const editing = Boolean(record);
  return (
    <details className="disclosure">
      <summary className={`button tiny ${editing ? '' : 'primary'}`}>
        {editing ? 'แก้ไข' : `เพิ่ม ${typeLabel}`}
      </summary>
      <form action={saveMasterRecord} className="popover wide">
        <PopoverHead title={editing ? `แก้ไข ${typeLabel}` : `เพิ่ม ${typeLabel}`} />
        <input type="hidden" name="type" value={type} />
        {record ? <input type="hidden" name="id" value={record.id} /> : null}
        <label className="mini">
          <span>รหัส {editing ? '' : '(เว้นว่างให้ระบบรันต่อจากเลขล่าสุด)'}</span>
          <input name="code" defaultValue={record?.code ?? ''} />
        </label>
        <label className="mini">
          <span>ชื่อ</span>
          <input name="name" defaultValue={record?.name ?? ''} required />
        </label>
        {isSettings ? (
          <label className="mini">
            <span>ค่า</span>
            <input name="value" defaultValue={record?.value ?? ''} />
          </label>
        ) : (
          <label className="mini">
            <span>รายละเอียด</span>
            <input name="description" defaultValue={record?.description ?? ''} />
          </label>
        )}
        <label className="mini">
          <span>สถานะ</span>
          <select name="isActive" defaultValue={record && !record.isActive ? '0' : '1'}>
            <option value="1">ACTIVE — ให้เลือกใช้ได้</option>
            <option value="0">INACTIVE — ซ่อนจากรายการเลือก</option>
          </select>
        </label>
        <SubmitButton label="บันทึก" tone="primary" />
      </form>
    </details>
  );
}
