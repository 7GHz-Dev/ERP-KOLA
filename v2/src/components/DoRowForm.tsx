import { saveDoHandoff } from '@/lib/actions/jobs';
import { ConfirmSubmit } from '@/components/Interactions';

/**
 * แถวจัดการ Invoice DO — แก้ได้ในตารางเลย ไม่ต้องเปิดแผง
 *
 * FAH คีย์งานทีละหลายสิบแถว การเปิด-ปิดแผงทีละแถวช้ากว่าพิมพ์ในตารางตรง ๆ
 * ปุ่ม "ส่ง Partner" จะกดได้ต่อเมื่อบันทึกข้อมูลครบแล้ว เพราะต้องมี ETA
 * และ Partner ก่อนถึงจะมีอะไรให้ส่ง
 */

export type Choice = { id: string; code: string | null; name: string };

export function DoRowForm({
  jobId, eta, portId, terminalId, partnerName,
  ports, terminals, partners, sentAt, defaultPartnerId, readOnly,
}: {
  jobId: string;
  eta: string | null;
  portId: string | null;
  terminalId: string | null;
  partnerName: string | null;
  ports: Choice[];
  terminals: Choice[];
  partners: Choice[];
  sentAt: string | null;
  /** งานที่ยังไม่เคยเลือก Partner ให้ตั้งค่าเริ่มต้นไว้ก่อน ผู้ใช้เปลี่ยนได้ */
  defaultPartnerId?: string | null;
  /** ส่ง Partner แล้ว — แสดงค่าอย่างเดียว แก้ไม่ได้ */
  readOnly?: boolean;
}) {
  const partnerId =
    partners.find((p) => p.name === partnerName)?.id ?? defaultPartnerId ?? '';
  // ยังกดส่งไม่ได้จนกว่าจะบันทึก เพราะค่าเริ่มต้นเป็นแค่ค่าที่เห็นบนจอ ยังไม่ได้ลงฐานข้อมูล
  const ready = Boolean(eta && partnerName);

  const options = (list: Choice[], placeholder: string) => (
    <>
      <option value="">{placeholder}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>
      ))}
    </>
  );

  /*
   * key ต้องเปลี่ยนตามค่าที่บันทึกไว้
   *
   * <select defaultValue> เป็นช่องที่ React ไม่ได้คุมค่า พอบันทึกแล้วหน้าเรนเดอร์ใหม่
   * React จะใช้ DOM เดิมและไม่แตะค่าที่เลือกอยู่ ช่องจึงเด้งกลับไปเป็นค่าก่อนบันทึก
   * เปลี่ยน key เมื่อค่าเปลี่ยน React จะสร้างช่องใหม่พร้อมค่าที่ถูกต้อง
   */

  if (readOnly) {
    const nameOf = (list: Choice[], id: string | null) => {
      const hit = list.find((c) => c.id === id);
      return hit ? (hit.code ? `${hit.code} · ${hit.name}` : hit.name) : '-';
    };
    return (
      <div className="do-row readonly">
        <div className="do-cell"><span>ETA official</span><b>{eta ?? '-'}</b></div>
        <div className="do-cell"><span>Port of Discharge</span><b>{nameOf(ports, portId)}</b></div>
        <div className="do-cell"><span>Terminal</span><b>{nameOf(terminals, terminalId)}</b></div>
        <div className="do-cell"><span>Port Release Partner</span><b>{partnerName ?? '-'}</b></div>
        <div className="do-buttons"><span className="badge approved">ส่งแล้ว</span></div>
      </div>
    );
  }

  return (
    <form action={saveDoHandoff} className="do-row">
      <input type="hidden" name="jobId" value={jobId} />

      <label className="do-cell">
        <span>ETA official</span>
        <input key={`eta-${eta ?? ''}`} type="date" name="eta" defaultValue={eta ?? ''} required />
      </label>
      <label className="do-cell">
        <span>Port of Discharge</span>
        <select key={`port-${portId ?? ''}`} name="portId" defaultValue={portId ?? ''}>
          {options(ports, '— เลือก —')}
        </select>
      </label>
      <label className="do-cell">
        <span>Terminal</span>
        <select key={`tml-${terminalId ?? ''}`} name="terminalId" defaultValue={terminalId ?? ''}>
          {options(terminals, '— เลือก —')}
        </select>
      </label>
      <label className="do-cell">
        <span>Port Release Partner</span>
        <select key={`ptn-${partnerId}`} name="partnerId" defaultValue={partnerId}>
          {options(partners, '— เลือก —')}
        </select>
      </label>

      <div className="do-buttons">
        <button className="button tiny primary" type="submit" name="sendToPartner" value="0">
          บันทึก
        </button>
        {sentAt ? (
          <span className="badge approved">ส่งแล้ว</span>
        ) : ready ? (
          <ConfirmSubmit
            label="ส่ง Partner"
            tone="ok"
            name="sendToPartner"
            value="1"
            confirm={`ส่งข้อมูลให้ ${partnerName} ใช่ไหม`}
            detail="ระบบจะบันทึกเวลาที่ส่งไว้เป็นหลักฐาน"
          />
        ) : (
          <span className="badge pending">บันทึก ETA และ Partner ก่อน</span>
        )}
      </div>
    </form>
  );
}
