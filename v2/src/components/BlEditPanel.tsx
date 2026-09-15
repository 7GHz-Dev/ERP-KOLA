'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateBlInfo } from '@/lib/actions/jobs';
import type { Option } from '@/lib/queries/master';

/**
 * แผงแก้ข้อมูล BL — ฟอร์มอยู่ซ้าย ไฟล์ AN/BL อยู่ขวา
 *
 * PAINT ต้องเทียบค่าที่กรอกกับใบตัวจริงแทบทุกช่อง
 * เดิมฟอร์มอยู่ในแผงเล็กที่กางจากปุ่มในตาราง เปิดไฟล์ดูทีก็บังฟอร์ม
 * ต้องจำเลขแล้วปิดไฟล์กลับมากรอก ซึ่งพลาดง่ายมากกับเลข BL ยาว ๆ
 *
 * หัวข้อและลำดับช่องยกมาจากฟอร์มรับงาน AN/BL ทั้งชุด เพราะเป็นข้อมูลชุดเดียวกัน
 * คนที่คีย์ตอนรับงานจะได้ไม่ต้องเรียนตำแหน่งใหม่ตอนมาแก้
 */

export type BlEditJob = {
  id: string; jobNo: string;
  blNo: string | null; vessel: string | null; voyage: string | null;
  eta: string | null; transportDate: string | null;
  demDays: number; detDays: number; product: string | null;
  blType: string | null; shipline: string | null; originPort: string | null;
  unitAmount: string | null; packageType: string | null; grossWeight: string | null;
  goodsValue: string | null; goodsCurrency: string | null;
  consigneeId: string | null; notifyPartyId: string | null; personId: string | null;
  jobTypeId: string | null; portId: string | null; terminalId: string | null;
  customerNote: string | null;
};

export type PreviewDoc = { id: string; fileName: string; mimeType: string | null; category: string };

type Opts = {
  consignees: Option[]; notify: Option[]; people: Option[]; jobTypes: Option[];
  ports: Option[]; originPorts: Option[]; terminals: Option[]; packageTypes: Option[];
};

const LABEL: Record<string, string> = { ARRIVAL_NOTICE: 'Arrival Notice', BL: 'Bill of Lading' };

export function BlEditPanel({
  job, options, source, other,
}: {
  job: BlEditJob;
  options: Opts;
  source?: PreviewDoc;
  other?: PreviewDoc;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(source?.id ?? '');
  const docs = [source, other].filter(Boolean) as PreviewDoc[];
  const doc = docs.find((d) => d.id === shown) ?? docs[0];

  const pick = (name: string, label: string, list: Option[], current: string | null) => (
    <label className="mini">
      <span>{label}</span>
      <select name={name} defaultValue={current ?? ''}>
        <option value="">— ไม่ระบุ —</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>{o.code ? `${o.code} · ${o.name}` : o.name}</option>
        ))}
      </select>
    </label>
  );

  const src = doc ? `/files/${doc.id}` : null;
  const isImage = (doc?.mimeType ?? '').startsWith('image/');

  return (
    <div className="bl-edit">
      <form
        className="bl-edit-form"
        action={(fd) => {
          void updateBlInfo(fd).then(() => router.back());
        }}
      >
        <input type="hidden" name="jobId" value={job.id} />

        <p className="edit-bl-group">ข้อมูลใบตราส่ง</p>
        <label className="mini">
          <span>B/L No.</span>
          <input name="blNo" defaultValue={job.blNo ?? ''} />
        </label>
        <div className="field-pair">
          <label className="mini">
            <span>BL TYPE</span>
            <select name="blType" defaultValue={job.blType ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              {['SWB', 'OBL', 'S', 'TWB', 'HBL', 'MBL', 'Original'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="mini">
            <span>SHIPLINE</span>
            <input name="shipline" defaultValue={job.shipline ?? ''} />
          </label>
        </div>
        {pick('jobTypeId', 'Job Type', options.jobTypes, job.jobTypeId)}

        <p className="edit-bl-group">เรือและกำหนดการ</p>
        <div className="field-pair">
          <label className="mini">
            <span>Vessel</span>
            <input name="vessel" defaultValue={job.vessel ?? ''} />
          </label>
          <label className="mini">
            <span>Voyage</span>
            <input name="voyage" defaultValue={job.voyage ?? ''} />
          </label>
        </div>
        <div className="field-pair">
          <label className="mini">
            <span>ETA</span>
            <input type="date" name="eta" defaultValue={job.eta ?? ''} />
          </label>
          <label className="mini">
            <span>วันที่ขนย้าย</span>
            <input type="date" name="transportDate" defaultValue={job.transportDate ?? ''} />
          </label>
        </div>
        <div className="field-pair">
          <label className="mini">
            <span>DEM (วัน)</span>
            <input type="number" min={0} name="demDays" defaultValue={job.demDays} />
          </label>
          <label className="mini">
            <span>DET (วัน)</span>
            <input type="number" min={0} name="detDays" defaultValue={job.detDays} />
          </label>
        </div>

        <p className="edit-bl-group">ท่าเรือ</p>
        <label className="mini">
          <span>เมืองต้นทาง (Port of Loading)</span>
          <input name="originPort" defaultValue={job.originPort ?? ''} list="bl-edit-origins" />
          {/* เสนอชื่อที่เคยใช้ แต่ยังพิมพ์เองได้ เพราะท่าต้นทางมีมากกว่าที่เก็บไว้ */}
          <datalist id="bl-edit-origins">
            {options.originPorts.map((o) => <option key={o.id} value={o.name} />)}
          </datalist>
        </label>
        <div className="field-pair">
          {pick('portId', 'Port of Discharge', options.ports, job.portId)}
          {pick('terminalId', 'Port Terminal', options.terminals, job.terminalId)}
        </div>

        <p className="edit-bl-group">สินค้า</p>
        <label className="mini">
          <span>สินค้า</span>
          <input name="product" defaultValue={job.product ?? ''} />
        </label>
        <div className="field-pair">
          <label className="mini">
            <span>จำนวน</span>
            <input type="number" step="any" name="unitAmount" defaultValue={job.unitAmount ?? ''} />
          </label>
          <label className="mini">
            <span>หน่วยนับ</span>
            <select name="packageType" defaultValue={job.packageType ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              {options.packageTypes.map((o) => (
                <option key={o.id} value={o.name}>{o.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-pair">
          <label className="mini">
            <span>น้ำหนักรวม (KG)</span>
            <input type="number" step="any" name="grossWeight" defaultValue={job.grossWeight ?? ''} />
          </label>
          <label className="mini">
            <span>มูลค่าสินค้า</span>
            <input type="number" step="any" name="goodsValue" defaultValue={job.goodsValue ?? ''} />
          </label>
        </div>
        <label className="mini">
          <span>สกุลเงิน</span>
          <input name="goodsCurrency" defaultValue={job.goodsCurrency ?? ''} maxLength={10} />
        </label>

        <p className="edit-bl-group">คู่ค้าและผู้รับผิดชอบ</p>
        {pick('consigneeId', 'Consignee', options.consignees, job.consigneeId)}
        {pick('notifyPartyId', 'Notify Party', options.notify, job.notifyPartyId)}
        {pick('personId', 'ผู้รับผิดชอบ', options.people, job.personId)}
        <label className="mini">
          <span>หมายเหตุถึงลูกค้า</span>
          <textarea name="customerNote" rows={2} defaultValue={job.customerNote ?? ''} />
        </label>

        {/* ปุ่มติดอยู่ท้ายแผงเสมอ ฟอร์มยาวกว่าจอจึงไม่ต้องเลื่อนลงไปหา */}
        <div className="bl-edit-actions">
          <button type="button" className="button" onClick={() => router.back()}>ยกเลิก</button>
          <button type="submit" className="button primary">บันทึก</button>
        </div>
      </form>

      <div className="bl-edit-view">
        <div className="slip-pane-head">
          {docs.length > 1 ? (
            /* มีทั้ง AN และ BL ให้สลับดูได้ บางงานเลขอยู่คนละใบ */
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
