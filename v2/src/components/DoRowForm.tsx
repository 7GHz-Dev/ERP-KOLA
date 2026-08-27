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
  jobId, eta, transportDate, portId, terminalId, partnerName,
  ports, terminals, partners, sentAt,
}: {
  jobId: string;
  eta: string | null;
  transportDate: string | null;
  portId: string | null;
  terminalId: string | null;
  partnerName: string | null;
  ports: Choice[];
  terminals: Choice[];
  partners: Choice[];
  sentAt: string | null;
}) {
  const partnerId = partners.find((p) => p.name === partnerName)?.id ?? '';
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

  return (
    <form action={saveDoHandoff} className="do-row">
      <input type="hidden" name="jobId" value={jobId} />

      <label className="do-cell">
        <span>ETA official</span>
        <input key={`eta-${eta ?? ''}`} type="date" name="eta" defaultValue={eta ?? ''} required />
      </label>
      <label className="do-cell">
        <span>วันที่ขนย้าย</span>
        <input
          key={`td-${transportDate ?? ''}`}
          type="date"
          name="transportDate"
          defaultValue={transportDate ?? ''}
        />
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
