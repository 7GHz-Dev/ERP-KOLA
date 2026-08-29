'use client';

import { useState, useTransition } from 'react';
import type { Option } from '@/lib/queries/master';
import { extractPdfText, parseArrivalText } from '@/lib/parse-arrival';
import { SearchSelect } from '@/components/SearchSelect';
import { PdfPageTrimmer } from '@/components/PdfPageTrimmer';

/**
 * ฟอร์มรับงาน
 *
 * ต้องเป็น client component เพราะสองอย่าง: แถว BL/ตู้ที่เพิ่มลดได้
 * และการอ่าน PDF ซึ่งทำในเบราว์เซอร์ ไฟล์จึงไม่ถูกส่งขึ้นเซิร์ฟเวอร์จนกว่าจะกดบันทึก
 */

type Options = {
  shippers: Option[]; consignees: Option[]; notify: Option[]; people: Option[];
  ports: Option[]; terminals: Option[]; jobTypes: Option[];
  containerTypes: Option[]; packageTypes: Option[];
};

type Defaults = {
  consigneeId: string | null; notifyId: string | null;
  portId: string | null; jobTypeId: string | null;
  demDays: string; detDays: string;
  containerType: string; packageType: string;
};

type BlRow = { blNo: string; shipperId: string; shipperName: string };
type ContainerRow = { containerNo: string; containerType: string; sealNo: string };

const byCode = (list: Option[], code: string) => list.find((o) => o.code?.toUpperCase() === code)?.name ?? '';

export function IntakeForm({
  sourceType, options, defaults, action,
}: {
  sourceType: 'AN' | 'BL';
  options: Options;
  defaults: Defaults;
  /** คืนเลขงานที่สร้าง เพื่อขึ้นข้อความแล้วล้างฟอร์มรอใบถัดไป */
  action: (formData: FormData) => Promise<string | undefined>;
}) {
  const [blRows, setBlRows] = useState<BlRow[]>([{ blNo: '', shipperId: '', shipperName: '' }]);
  const [personId, setPersonId] = useState('');
  const [saved, setSaved] = useState('');
  // เปลี่ยน key แล้ว React สร้างฟอร์มใหม่ทั้งชุด ช่องทุกช่องกลับไปเป็นค่าตั้งต้น
  const [formKey, setFormKey] = useState(0);
  const [containerRows, setContainerRows] = useState<ContainerRow[]>([
    { containerNo: '', containerType: defaults.containerType, sealNo: '' },
  ]);
  const [readStatus, setReadStatus] = useState('รองรับ Maersk · Evergreen · OOCL · ONE · Wan Hai · CNC · Namsung · Jinjiang · ESL');
  const [statusTone, setStatusTone] = useState<'' | 'ok' | 'error'>('');
  const [parsed, setParsed] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  /*
   * ไฟล์ที่เลือกไว้ กับไฟล์ที่ตัดหน้าออกแล้ว
   *
   * ช่อง input ยังถือไฟล์ต้นฉบับไว้เพื่อให้ required ของเบราว์เซอร์ทำงานตามปกติ
   * ส่วนตัวที่จะอัปโหลดจริงเลือกตอนกดบันทึก ถ้ามีตัวที่ตัดแล้วก็ใช้ตัวนั้นแทน
   */
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [trimmedFile, setTrimmedFile] = useState<File | null>(null);
  const [pageInfo, setPageInfo] = useState<{ kept: number; total: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setStatusTone('error');
      setReadStatus('กรุณาเลือกไฟล์ PDF เท่านั้น');
      return;
    }
    setStatusTone('');
    setReadStatus('กำลังอ่านไฟล์...');
    // เปิดแผงตัวอย่างทันทีที่เลือกไฟล์ ไม่ต้องรอผลอ่านข้อมูล
    // ถึงอ่านข้อมูลไม่ออกก็ยังต้องดูหน้าและตัดหน้าที่ไม่เอาได้
    setPickedFile(file);
    setTrimmedFile(null);
    setPageInfo(null);
    setShowPreview(true);
    try {
      const result = parseArrivalText(await extractPdfText(file));
      const filled: Record<string, string> = {};
      (['blNo', 'blType', 'vessel', 'voyage', 'eta', 'grossWeight', 'unitAmount'] as const)
        .forEach((k) => { if (result[k]) filled[k] = result[k]; });
      if (result.carrier) filled.shipline = result.carrier;
      setParsed(filled);

      if (result.blNo) {
        setBlRows((rows) => [{ ...rows[0], blNo: result.blNo }, ...rows.slice(1)]);
      }
      if (result.containers.length) {
        setContainerRows(result.containers.map((c, i) => ({
          containerNo: c,
          containerType: defaults.containerType,
          sealNo: result.seals[i] ?? '',
        })));
      }

      const found = Object.keys(filled).length + (result.containers.length ? 1 : 0);
      setStatusTone(found ? 'ok' : 'error');
      setReadStatus(found
        ? `อ่านได้ ${found} รายการ${result.carrier ? ` · สายเรือ ${result.carrier}` : ''}` +
          `${result.containers.length ? ` · ตู้ ${result.containers.length} ตู้` : ''} — กรุณาตรวจทานก่อนบันทึก`
        : 'อ่านไฟล์ได้แต่ไม่พบข้อมูลที่รู้จัก กรุณากรอกเอง');
    } catch (error) {
      setStatusTone('error');
      setReadStatus(`อ่านไฟล์ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** ล้างทุกอย่างให้พร้อมคีย์ใบถัดไป โดยไม่ต้องเปลี่ยนหน้า */
  function resetForNext(jobNo: string) {
    setSaved(jobNo);
    setBlRows([{ blNo: '', shipperId: '', shipperName: '' }]);
    setContainerRows([{ containerNo: '', containerType: defaults.containerType, sealNo: '' }]);
    setPersonId('');
    setParsed({});
    setReadStatus('ยังไม่ได้อ่านไฟล์');
    setStatusTone('');
    setPickedFile(null);
    setTrimmedFile(null);
    setPageInfo(null);
    setShowPreview(false);
    setFormKey((n) => n + 1);
  }

  return (
    <>
    <form
      key={formKey}
      action={(formData) => {
        formData.set('blRows', JSON.stringify(blRows));
        formData.set('containerRows', JSON.stringify(containerRows));
        // ตัดหน้าแล้วให้ส่งตัวที่ตัดแล้วขึ้นไปแทนต้นฉบับที่ยังอยู่ในช่องเลือกไฟล์
        if (trimmedFile) formData.set('file', trimmedFile);
        startTransition(async () => {
          const jobNo = await action(formData);
          if (jobNo) resetForNext(jobNo);
        });
      }}
      className="intake"
    >
      {saved ? (
        <div className="alert-bar good" role="status">
          <span>SENT TO DRAFT: สร้างงาน {saved} แล้ว · ฟอร์มพร้อมคีย์ใบถัดไป</span>
          <button type="button" onClick={() => setSaved('')} aria-label="ปิดข้อความ">✕</button>
        </div>
      ) : null}
      <input type="hidden" name="sourceType" value={sourceType} />

      <div className="section-title">อัปโหลด {sourceType === 'AN' ? 'Arrival Notice' : 'Bill of Lading'}</div>
      <label className="drop-zone">
        เลือกไฟล์ PDF เพื่อให้ระบบอ่านข้อมูลให้อัตโนมัติ
        <input type="file" name="file" accept="application/pdf,.pdf" required
          onChange={(e) => void handleFile(e.target.files?.[0])} />
      </label>
      <div className={`read-status ${statusTone}`}>{readStatus}</div>
      {pickedFile ? (
        <div className="file-bar">
          <span>
            {pageInfo && pageInfo.kept < pageInfo.total
              ? `ตัดเหลือ ${pageInfo.kept} จาก ${pageInfo.total} หน้า`
              : pageInfo
                ? `ใช้ทั้ง ${pageInfo.total} หน้า`
                : 'ยังไม่ได้ตรวจหน้า'}
          </span>
          <button type="button" className="button tiny" onClick={() => setShowPreview(true)}>
            ดูตัวอย่าง / ตัดหน้า
          </button>
        </div>
      ) : null}

      <div className="section-title">ข้อมูลจาก {sourceType === 'AN' ? 'Arrival Notice' : 'BL'}</div>
      <div className="extract-grid">
        <Field label="JOB TYPE">
          <select name="jobTypeId" defaultValue={defaults.jobTypeId ?? ''}>
            <Options list={options.jobTypes} />
          </select>
        </Field>
        <Field label="PRODUCT">
          <input name="product" defaultValue="USED CAR" />
        </Field>
        <Field label="BL TYPE">
          <select name="blType" key={parsed.blType} defaultValue={parsed.blType ?? 'SWB'}>
            {['SWB', 'OBL', 'S', 'TWB', 'HBL', 'MBL', 'Original'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="SHIPLINE">
          <input name="shipline" key={parsed.shipline} defaultValue={parsed.shipline ?? ''} />
        </Field>

        <Field label="SHIPPER / B/L" wide>
          <div className="repeat-list">
            {blRows.map((row, i) => (
              <div className="repeat-row" key={i}>
                <SearchSelect
                  choices={options.shippers}
                  value={row.shipperId}
                  placeholder="พิมพ์ค้นหา Shipper"
                  onChange={(id) => {
                    const name = options.shippers.find((s) => s.id === id)?.name ?? '';
                    setBlRows((rows) => rows.map((r, j) => (j === i ? { ...r, shipperId: id, shipperName: name } : r)));
                  }}
                />
                <input
                  placeholder="BILL OF LADING NO."
                  value={row.blNo}
                  onChange={(e) =>
                    setBlRows((rows) => rows.map((r, j) => (j === i ? { ...r, blNo: e.target.value } : r)))}
                />
                <button type="button" className="icon-button" title="ลบแถว"
                  onClick={() => setBlRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows))}>×</button>
              </div>
            ))}
          </div>
          <button type="button" className="button tiny"
            onClick={() => setBlRows((rows) => [...rows, { blNo: '', shipperId: '', shipperName: '' }])}>
            + เพิ่ม BL
          </button>
        </Field>

        <Field label="CONTAINER NO." wide>
          <div className="repeat-list">
            {containerRows.map((row, i) => (
              <div className="repeat-row container" key={i}>
                <input
                  placeholder="CONTAINER NO."
                  value={row.containerNo}
                  onChange={(e) =>
                    setContainerRows((rows) => rows.map((r, j) => (j === i ? { ...r, containerNo: e.target.value } : r)))}
                />
                <select
                  value={row.containerType}
                  onChange={(e) =>
                    setContainerRows((rows) => rows.map((r, j) => (j === i ? { ...r, containerType: e.target.value } : r)))}
                >
                  {options.containerTypes.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
                <input
                  placeholder="SEAL NO."
                  value={row.sealNo}
                  onChange={(e) =>
                    setContainerRows((rows) => rows.map((r, j) => (j === i ? { ...r, sealNo: e.target.value } : r)))}
                />
                <button type="button" className="icon-button" title="ลบแถว"
                  onClick={() => setContainerRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows))}>×</button>
              </div>
            ))}
          </div>
          <button type="button" className="button tiny"
            onClick={() => setContainerRows((rows) => [...rows, { containerNo: '', containerType: defaults.containerType, sealNo: '' }])}>
            + เพิ่มตู้
          </button>
        </Field>

        <Field label="QUANTITY">
          <div className="qty-pair">
            <input name="unitAmount" type="number" step="any" key={parsed.unitAmount} defaultValue={parsed.unitAmount ?? ''} />
            <select name="packageType" defaultValue={defaults.packageType}>
              {options.packageTypes.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          </div>
        </Field>
        <Field label="WEIGHT (KG)">
          <input name="grossWeight" key={parsed.grossWeight} defaultValue={parsed.grossWeight ?? ''} />
        </Field>
        <Field label="VESSEL">
          <input name="vessel" required key={parsed.vessel} defaultValue={parsed.vessel ?? ''} />
        </Field>
        <Field label="VOYAGE">
          <input name="voyage" key={parsed.voyage} defaultValue={parsed.voyage ?? ''} />
        </Field>
        <Field label="ETA">
          <input name="eta" type="date" key={parsed.eta} defaultValue={parsed.eta ?? ''} />
        </Field>
        <Field label="CONSIGNEE">
          <select name="consigneeId" defaultValue={defaults.consigneeId ?? ''}>
            <Options list={options.consignees} />
          </select>
        </Field>
        <Field label="NOTIFY PARTY">
          <select name="notifyPartyId" defaultValue={defaults.notifyId ?? ''}>
            <Options list={options.notify} />
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
        <Field label="PORT OF DISCHARGE">
          <select name="portId" defaultValue={defaults.portId ?? ''}>
            <Options list={options.ports} />
          </select>
        </Field>
        <Field label="PORT TERMINAL">
          <select name="terminalId" defaultValue="">
            <option value="">— เลือก —</option>
            <Options list={options.terminals} />
          </select>
        </Field>
        <Field label="DEM FREE (วัน)">
          <input name="demDays" type="number" defaultValue={defaults.demDays} />
        </Field>
        <Field label="DET FREE (วัน)">
          <input name="detDays" type="number" defaultValue={defaults.detDays} />
        </Field>
      </div>

      <div className="notice">
        ตู้ {containerRows.filter((r) => r.containerNo.trim()).length} ตู้ ·
        BL {blRows.filter((r) => r.blNo.trim()).length} ฉบับ ·
        กดบันทึก 1 ครั้ง = Job No. ใหม่ 1 เลข
      </div>

      <div className="form-actions">
        <button className="button primary" type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก...' : 'SENT TO DRAFT'}
        </button>
      </div>
    </form>

    {showPreview && pickedFile ? (
      <PdfPageTrimmer
        file={pickedFile}
        title={`ตัวอย่าง ${sourceType === 'AN' ? 'ARRIVAL NOTICE' : 'BILL OF LADING'}`}
        onClose={() => setShowPreview(false)}
        onApply={(trimmed, kept, total) => {
          setTrimmedFile(trimmed);
          setPageInfo({ kept, total });
          setShowPreview(false);
        }}
      />
    ) : null}
    </>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`extract-field ${wide ? 'wide' : ''}`}>
      <div className="extract-label">{label}</div>
      <div className="extract-control">{children}</div>
    </div>
  );
}

function Options({ list }: { list: Option[] }) {
  return (
    <>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {o.code ? `${o.code} · ${o.name}` : o.name}
        </option>
      ))}
    </>
  );
}
