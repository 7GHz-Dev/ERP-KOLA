'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateBlInfo } from '@/lib/actions/jobs';
import { PdfPageTrimmer } from '@/components/PdfPageTrimmer';
import { SearchSelect } from '@/components/SearchSelect';
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

/** ช่องกรอกหน้าตาเดียวกับหน้ารับงาน — ป้ายตัวพิมพ์ใหญ่อยู่บน ช่องอยู่ล่าง */
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`extract-field ${wide ? 'wide' : ''}`}>
      <div className="extract-label">{label}</div>
      <div className="extract-control">{children}</div>
    </div>
  );
}

function Opts({ list }: { list: Option[] }) {
  return (
    <>
      {list.map((o) => (
        <option key={o.id} value={o.id}>{o.code ? `${o.code} · ${o.name}` : o.name}</option>
      ))}
    </>
  );
}

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
  // SearchSelect เป็นช่องพิมพ์ค้นหา ค่าจึงต้องเก็บเองแล้วส่งผ่าน hidden
  const [personId, setPersonId] = useState(job.personId ?? '');
  const docs = [source, other].filter(Boolean) as PreviewDoc[];
  const doc = docs.find((d) => d.id === shown) ?? docs[0];

  /*
   * ตัดหน้าไฟล์ที่เก็บไว้แล้ว — ใช้แผงตัวเดียวกับตอนรับงาน
   *
   * ต่างกันตรงที่ตอนรับงานไฟล์ยังอยู่ในเครื่อง แต่ตรงนี้อยู่ใน storage แล้ว
   * จึงต้องโหลดกลับมาเป็น File ก่อน ตัดในเบราว์เซอร์ แล้วอัปกลับเป็นเวอร์ชันใหม่
   * ของเดิมไม่ถูกลบ ระบบเก็บเป็นเวอร์ชันเก่าไว้ตามปกติ
   */
  const [trimFile, setTrimFile] = useState<File | null>(null);
  const [trimBusy, setTrimBusy] = useState('');

  const openTrimmer = async () => {
    if (!doc) return;
    setTrimBusy('กำลังโหลดไฟล์…');
    try {
      const res = await fetch(`/files/${doc.id}`);
      if (!res.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
      const blob = await res.blob();
      setTrimFile(new File([blob], doc.fileName, { type: 'application/pdf' }));
      setTrimBusy('');
    } catch (e) {
      setTrimBusy(e instanceof Error ? e.message : String(e));
    }
  };

  const saveTrimmed = async (trimmed: File | null, kept: number, total: number) => {
    // ไม่ได้ตัดหน้าไหนออก ก็ไม่ต้องอัปทับให้เปลืองเวอร์ชัน
    if (!trimmed || !doc) { setTrimFile(null); return; }
    setTrimBusy(`กำลังบันทึก ${kept} จาก ${total} หน้า…`);
    const fd = new FormData();
    fd.set('jobId', job.id);
    fd.set('category', doc.category);
    fd.set('file', trimmed);
    fd.set('changeReason', `ตัดเหลือ ${kept} จาก ${total} หน้า`);
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      const body = await res.json() as { ok?: boolean; detail?: string };
      if (!res.ok || !body.ok) throw new Error(body.detail ?? 'อัปโหลดไม่สำเร็จ');
      setTrimFile(null);
      setTrimBusy('');
      // โหลดข้อมูลแผงใหม่ ให้ตัวอย่างชี้ไปไฟล์เวอร์ชันล่าสุด
      router.refresh();
    } catch (e) {
      setTrimBusy(e instanceof Error ? e.message : String(e));
    }
  };

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

        {/*
          หัวข้อ ลำดับ และหน้าตาของช่อง ยกมาจากหน้ารับงาน AN/BL ทั้งชุด
          เป็นข้อมูลชุดเดียวกัน คนที่คีย์ตอนรับงานจะได้ไม่ต้องเรียนตำแหน่งใหม่ตอนมาแก้
        */}
        <div className="extract-grid">
          <Field label="JOB TYPE">
            <select name="jobTypeId" defaultValue={job.jobTypeId ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              <Opts list={options.jobTypes} />
            </select>
          </Field>
          <Field label="PRODUCT">
            <input name="product" defaultValue={job.product ?? ''} />
          </Field>
          <Field label="BL TYPE">
            <select name="blType" defaultValue={job.blType ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              {['SWB', 'OBL', 'S', 'TWB', 'HBL', 'MBL', 'Original'].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="SHIPLINE">
            <input name="shipline" defaultValue={job.shipline ?? ''} />
          </Field>

          <Field label="B/L NO." wide>
            <input name="blNo" defaultValue={job.blNo ?? ''} />
          </Field>

          <Field label="QUANTITY">
            <div className="pair">
              <input name="unitAmount" type="number" step="any" defaultValue={job.unitAmount ?? ''} />
              <select name="packageType" defaultValue={job.packageType ?? ''}>
                <option value="">— ไม่ระบุ —</option>
                {options.packageTypes.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="WEIGHT (KG)">
            <input name="grossWeight" type="number" step="any" defaultValue={job.grossWeight ?? ''} />
          </Field>
          <Field label="VESSEL">
            <input name="vessel" defaultValue={job.vessel ?? ''} />
          </Field>
          <Field label="VOYAGE">
            <input name="voyage" defaultValue={job.voyage ?? ''} />
          </Field>
          <Field label="ETA">
            <input name="eta" type="date" defaultValue={job.eta ?? ''} />
          </Field>
          <Field label="วันที่ขนย้าย">
            <input name="transportDate" type="date" defaultValue={job.transportDate ?? ''} />
          </Field>
          <Field label="CONSIGNEE">
            <select name="consigneeId" defaultValue={job.consigneeId ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              <Opts list={options.consignees} />
            </select>
          </Field>
          <Field label="NOTIFY PARTY">
            <select name="notifyPartyId" defaultValue={job.notifyPartyId ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              <Opts list={options.notify} />
            </select>
          </Field>
          <Field label="CLIENT IN CHARGE">
            {/* ค่าที่ส่งไปกับฟอร์มเก็บใน hidden เพราะ SearchSelect เป็นช่องพิมพ์ ไม่ใช่ <select> */}
            <input type="hidden" name="personId" value={personId} />
            <SearchSelect
              choices={options.people}
              value={personId}
              placeholder="พิมพ์ค้นหาผู้รับผิดชอบ"
              onChange={setPersonId}
            />
          </Field>
          <Field label="PORT OF LOADING">
            <input name="originPort" defaultValue={job.originPort ?? ''} list="bl-edit-origins" />
            {/* เสนอชื่อที่เคยใช้ แต่ยังพิมพ์เองได้ เพราะท่าต้นทางมีมากกว่าที่เก็บไว้ */}
            <datalist id="bl-edit-origins">
              {options.originPorts.map((o) => <option key={o.id} value={o.name} />)}
            </datalist>
          </Field>
          <Field label="PORT OF DISCHARGE">
            <select name="portId" defaultValue={job.portId ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              <Opts list={options.ports} />
            </select>
          </Field>
          <Field label="PORT TERMINAL">
            <select name="terminalId" defaultValue={job.terminalId ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              <Opts list={options.terminals} />
            </select>
          </Field>
          <Field label="DEM FREE (วัน)">
            <input name="demDays" type="number" min={0} defaultValue={job.demDays} />
          </Field>
          <Field label="DET FREE (วัน)">
            <input name="detDays" type="number" min={0} defaultValue={job.detDays} />
          </Field>
          <Field label="มูลค่าสินค้า">
            <div className="pair">
              <input name="goodsValue" type="number" step="any" defaultValue={job.goodsValue ?? ''} />
              <input name="goodsCurrency" defaultValue={job.goodsCurrency ?? ''} maxLength={10} />
            </div>
          </Field>
          <Field label="หมายเหตุถึงลูกค้า" wide>
            <textarea name="customerNote" rows={2} defaultValue={job.customerNote ?? ''} />
          </Field>
        </div>

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
          {src && !isImage ? (
            <button type="button" className="button tiny" onClick={() => void openTrimmer()}>
              ดูตัวอย่าง / ตัดหน้า
            </button>
          ) : null}
          {src ? (
            <a className="button tiny" href={src} target="_blank" rel="noreferrer">เปิดเต็มจอ</a>
          ) : null}
        </div>
        {trimBusy ? <p className="trim-status">{trimBusy}</p> : null}
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

      {trimFile && doc ? (
        <PdfPageTrimmer
          file={trimFile}
          title={`${LABEL[doc.category] ?? doc.category} · ${job.jobNo}`}
          onApply={(trimmed, kept, total) => void saveTrimmed(trimmed, kept, total)}
          onClose={() => setTrimFile(null)}
        />
      ) : null}
    </div>
  );
}
