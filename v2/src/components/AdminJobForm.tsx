'use client';

import { useState } from 'react';
import Link from 'next/link';
import { adminUpdateJob } from '@/lib/actions/admin-job';
import { OriginPortField } from '@/components/SearchSelect';
import { STATUS_LABELS } from '@/lib/status';
import {
  CUSTOMS_STATUSES, DRAFT_STATUSES, RELEASE_STATUSES, SOURCE_TYPES, SURRENDER_STATUSES, type Choice,
} from '@/lib/admin-job-options';
import type { AdminJob } from '@/lib/queries/admin-job';

type Option = { id: string; code: string | null; name: string };
type Options = Record<
  'shippers' | 'consignees' | 'notify' | 'people' | 'ports' | 'originPorts' | 'terminals'
  | 'jobTypes' | 'loadingTypes' | 'packageTypes' | 'containerTypes' | 'partners',
  Option[]
>;

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`extract-field ${wide ? 'wide' : ''}`}>
      <div className="extract-label">{label}</div>
      <div className="extract-control">{children}</div>
    </div>
  );
}

/** ตัวเลือกจาก Master Data — ค่าเดิมที่ถูกปิดใช้งานไปแล้วยังต้องเลือกค้างไว้ได้ ไม่งั้นบันทึกแล้วหาย */
function MasterSelect({ name, list, value, empty = '— ไม่ระบุ —' }: {
  name: string; list: Option[]; value: string | null; empty?: string;
}) {
  const missing = value && !list.some((o) => o.id === value);
  return (
    <select name={name} defaultValue={value ?? ''}>
      <option value="">{empty}</option>
      {missing ? <option value={value}>(ค่าเดิม — ไม่อยู่ในรายการที่เปิดใช้)</option> : null}
      {list.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ${o.name}` : o.name}</option>)}
    </select>
  );
}

/** สถานะ — ค่าเดิมที่ไม่อยู่ในชุดยังเลือกค้างไว้ได้ ฝั่งเซิร์ฟเวอร์ยอมรับค่าเดิมเช่นกัน */
function ChoiceSelect({ name, list, value }: { name: string; list: Choice[]; value: string | null }) {
  const current = value ?? '';
  const missing = !list.some((c) => c.value === current);
  return (
    <select name={name} defaultValue={current}>
      {missing ? <option value={current}>{current || '-'} (ค่าเดิม)</option> : null}
      {list.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
  );
}

const STATUS_CHOICES: Choice[] = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label: `${label} (${value})` }));
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

type BlRow = { key: string; id: string; blNo: string; shipperId: string };
type CtRow = { key: string; id: string; runningNo: string; containerNo: string; containerType: string; sealNo: string; weight: string };

/**
 * ฟอร์มแก้ไข JOB ของ ADMIN — ทุกหัวข้อของหน้าสรุปงานในหน้าเดียว
 *
 * แบ่งกลุ่มตามหน้าสรุปงาน คนที่เห็นข้อมูลผิดในสรุปจะหาช่องที่ต้องแก้เจอที่ตำแหน่งเดียวกัน
 * BL กับตู้เป็นรายการหลายแถว เพิ่มแถวได้ และติ๊ก "ลบ" แถวที่ไม่ใช้
 * (ติ๊กแทนการลบทันที เผื่อกดพลาดยังเอาติ๊กออกได้ก่อนบันทึก)
 */
export function AdminJobForm({ data, options }: { data: AdminJob; options: Options }) {
  const { job } = data;
  const [blRows, setBlRows] = useState<BlRow[]>(() => data.bls.map((b) => ({
    key: b.id, id: b.id, blNo: b.blNo ?? '', shipperId: b.shipperId ?? '',
  })));
  const [ctRows, setCtRows] = useState<CtRow[]>(() => data.containers.map((c) => ({
    key: c.id, id: c.id, runningNo: c.runningNo ?? '', containerNo: c.containerNo ?? '',
    containerType: c.containerType ?? '', sealNo: c.sealNo ?? '', weight: num(c.weight),
  })));
  const partnerNames = options.partners.map((p) => p.name);
  const partnerMissing = job.releasePartner && !partnerNames.includes(job.releasePartner);

  return (
    <form action={adminUpdateJob} className="admin-job-form">
      <input type="hidden" name="jobId" value={job.id} />

      <section className="admin-job-section">
        <h2>ข้อมูลงาน</h2>
        <div className="extract-grid">
          <Field label="JOB NO."><input name="jobNo" defaultValue={job.jobNo} required /></Field>
          <Field label="ที่มาของงาน"><ChoiceSelect name="sourceType" list={SOURCE_TYPES} value={job.sourceType} /></Field>
          <Field label="JOB TYPE"><MasterSelect name="jobTypeId" list={options.jobTypes} value={job.jobTypeId} /></Field>
          <Field label="LOADING TYPE"><MasterSelect name="loadingTypeId" list={options.loadingTypes} value={job.loadingTypeId} /></Field>
          <Field label="CLIENT IN CHARGE"><MasterSelect name="personId" list={options.people} value={job.personId} /></Field>
          <Field label="CONSIGNEE"><MasterSelect name="consigneeId" list={options.consignees} value={job.consigneeId} /></Field>
          <Field label="NOTIFY PARTY"><MasterSelect name="notifyPartyId" list={options.notify} value={job.notifyPartyId} /></Field>
          <Field label="DESCRIPTION OF GOODS" wide><textarea name="product" rows={2} defaultValue={job.product ?? ''} /></Field>
          <Field label="หมายเหตุถึงลูกค้า" wide><textarea name="customerNote" rows={2} defaultValue={job.customerNote ?? ''} /></Field>
        </div>
      </section>

      <section className="admin-job-section">
        <h2>Bill of Lading และ Shipper</h2>
        {/*
          มี BL รายใบแล้ว ใบแรกคือ BL/Shipper ของงานที่ตารางทุกหน้าใช้
          งานที่ไม่มี BL รายใบ (งานเก่าบางใบ) แก้ที่ช่องระดับงานแทน
        */}
        {blRows.length ? (
          <p className="meta">ใบแรกเป็นเลข BL และ Shipper ที่ตารางทุกหน้าแสดง</p>
        ) : (
          <div className="extract-grid">
            <Field label="B/L NO."><input name="blNo" defaultValue={job.blNo ?? ''} /></Field>
            <Field label="SHIPPER"><MasterSelect name="shipperId" list={options.shippers} value={job.shipperId} /></Field>
          </div>
        )}
        {blRows.length ? (
          <table className="data admin-rows">
            <thead><tr><th>#</th><th>เลข BL</th><th>Shipper</th><th>ลบ</th></tr></thead>
            <tbody>
              {blRows.map((r, i) => (
                <tr key={r.key}>
                  <td>{i + 1}</td>
                  <td>
                    <input type="hidden" name="bl_id" value={r.id} />
                    <input name="bl_no" defaultValue={r.blNo} />
                  </td>
                  <td><MasterSelect name="bl_shipper" list={options.shippers} value={r.shipperId || null} /></td>
                  <td>
                    {r.id ? <input type="checkbox" name="bl_remove" value={r.id} aria-label={`ลบ BL ${r.blNo}`} /> : (
                      <button type="button" className="icon-button" aria-label="เอาแถวนี้ออก"
                        onClick={() => setBlRows((rows) => rows.filter((x) => x.key !== r.key))}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <button type="button" className="button tiny" onClick={() => setBlRows((rows) => [
          ...rows, { key: `new-${Date.now()}`, id: '', blNo: rows.length ? '' : job.blNo ?? '', shipperId: rows.length ? '' : job.shipperId ?? '' },
        ])}>
          + เพิ่ม BL
        </button>
        <div className="extract-grid">
          <Field label="BL TYPE"><input name="blType" defaultValue={job.blType ?? ''} /></Field>
          <Field label="UNIT AMOUNT">
            <span className="pair">
              <input name="unitAmount" inputMode="decimal" defaultValue={num(job.unitAmount)} />
              <MasterSelectByName name="packageType" list={options.packageTypes} value={job.packageType} />
            </span>
          </Field>
          <Field label="GROSS WEIGHT (KG)"><input name="grossWeight" inputMode="decimal" defaultValue={num(job.grossWeight)} /></Field>
          <Field label="มูลค่าสินค้า">
            <span className="pair">
              <input name="goodsValue" inputMode="decimal" defaultValue={num(job.goodsValue)} />
              <input name="goodsCurrency" maxLength={10} defaultValue={job.goodsCurrency ?? ''} />
            </span>
          </Field>
        </div>
      </section>

      <section className="admin-job-section">
        <h2>เรือ ท่าเรือ และวันที่</h2>
        <div className="extract-grid">
          <Field label="SHIP LINE"><input name="shipline" defaultValue={job.shipline ?? ''} /></Field>
          <Field label="VESSEL"><input name="vessel" defaultValue={job.vessel ?? ''} /></Field>
          <Field label="VOYAGE"><input name="voyage" defaultValue={job.voyage ?? ''} /></Field>
          <Field label="ETD"><input type="date" name="etd" defaultValue={job.etd ?? ''} /></Field>
          <Field label="ETA">
            <span className="pair">
              <input type="date" name="eta" defaultValue={job.eta ?? ''} />
              <label className="admin-check">
                <input type="checkbox" name="etaIsOfficial" value="1" defaultChecked={job.etaIsOfficial} /> ETA official (OFC)
              </label>
            </span>
          </Field>
          <Field label="วันที่ขนย้าย"><input type="date" name="transportDate" defaultValue={job.transportDate ?? ''} /></Field>
          <Field label="PORT OF LOADING"><OriginPortField choices={options.originPorts} initial={job.originPort ?? ''} /></Field>
          <Field label="PORT OF DISCHARGE"><MasterSelect name="portId" list={options.ports} value={job.portId} /></Field>
          <Field label="PORT TERMINAL"><MasterSelect name="terminalId" list={options.terminals} value={job.terminalId} /></Field>
          <Field label="DEM FREE (วัน)"><input type="number" min={0} name="demDays" defaultValue={job.demDays} /></Field>
          <Field label="DET FREE (วัน)"><input type="number" min={0} name="detDays" defaultValue={job.detDays} /></Field>
          <Field label="PORT RELEASE PARTNER">
            <select name="releasePartner" defaultValue={job.releasePartner ?? ''}>
              <option value="">— ไม่ระบุ —</option>
              {partnerMissing ? <option value={job.releasePartner!}>{job.releasePartner} (ค่าเดิม)</option> : null}
              {partnerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="admin-job-section">
        <h2>Container no. [ {ctRows.length} ]</h2>
        {ctRows.length ? (
          <table className="data admin-rows">
            <thead><tr><th>เลขประจำตู้</th><th>เลขตู้</th><th>ขนาดตู้</th><th>Seal</th><th>น้ำหนัก</th><th>ลบ</th></tr></thead>
            <tbody>
              {ctRows.map((r) => (
                <tr key={r.key}>
                  <td className="meta">{r.runningNo || 'ออกเลขตอนบันทึก'}</td>
                  <td>
                    <input type="hidden" name="ct_id" value={r.id} />
                    <input name="ct_no" defaultValue={r.containerNo} />
                  </td>
                  <td><MasterSelectByName name="ct_type" list={options.containerTypes} value={r.containerType} /></td>
                  <td><input name="ct_seal" defaultValue={r.sealNo} /></td>
                  <td><input name="ct_weight" inputMode="decimal" defaultValue={r.weight} /></td>
                  <td>
                    {r.id ? <input type="checkbox" name="ct_remove" value={r.id} aria-label={`ลบตู้ ${r.containerNo}`} /> : (
                      <button type="button" className="icon-button" aria-label="เอาแถวนี้ออก"
                        onClick={() => setCtRows((rows) => rows.filter((x) => x.key !== r.key))}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="meta">ยังไม่มีตู้</p>}
        <button type="button" className="button tiny" onClick={() => setCtRows((rows) => [
          ...rows, { key: `new-${Date.now()}`, id: '', runningNo: '', containerNo: '', containerType: '', sealNo: '', weight: '' },
        ])}>
          + เพิ่มตู้
        </button>
      </section>

      <section className="admin-job-section">
        <h2>สถานะงาน</h2>
        <p className="meta">เปลี่ยนสถานะแล้วงานจะย้ายไปอยู่คิวของสถานะนั้นทันที</p>
        <div className="extract-grid">
          <Field label="สถานะงาน"><ChoiceSelect name="status" list={STATUS_CHOICES} value={job.status} /></Field>
          <Field label="SURRENDER"><ChoiceSelect name="surrenderStatus" list={SURRENDER_STATUSES} value={job.surrenderStatus} /></Field>
          <Field label="สถานะใบขน"><ChoiceSelect name="customsStatus" list={CUSTOMS_STATUSES} value={job.customsStatus} /></Field>
          <Field label="สถานะปล่อยของ"><ChoiceSelect name="releaseStatus" list={RELEASE_STATUSES} value={job.releaseStatus} /></Field>
          <Field label="DRAFT REF"><input name="draftRefNo" defaultValue={job.draftRefNo ?? ''} /></Field>
          <Field label="สถานะ DRAFT"><ChoiceSelect name="draftStatus" list={DRAFT_STATUSES} value={job.draftStatus} /></Field>
          <Field label="IM-DCRL NO. (เลขใบขน)"><input name="declarationNo" defaultValue={data.entry?.declarationNo ?? ''} /></Field>
          <Field label="เหตุผลที่ Draft ถูกตีกลับ" wide>
            <textarea name="draftRejectReason" rows={2} defaultValue={job.draftRejectReason ?? ''} />
          </Field>
        </div>
      </section>

      <section className="admin-job-section">
        <h2>ค่าแลก DO</h2>
        <div className="extract-grid">
          <Field label="ยอดค่า DO (บาท)"><input name="doPayAmount" inputMode="decimal" defaultValue={num(job.doPayAmount)} /></Field>
          <Field label="ค่ามัดจำตู้ (บาท)"><input name="doDepositAmount" inputMode="decimal" defaultValue={num(job.doDepositAmount)} /></Field>
        </div>
      </section>

      {/* ปุ่มติดท้ายจอเสมอ ฟอร์มยาวจึงไม่ต้องเลื่อนลงไปหา */}
      <div className="admin-job-actions">
        <Link className="button" href="/master/jobs">กลับ</Link>
        <Link className="button" href={`/job/${job.id}`}>ดูสรุปงาน</Link>
        <button type="submit" className="button primary">บันทึกการแก้ไข</button>
      </div>
    </form>
  );
}

/**
 * ช่องที่เก็บเป็นชื่อ ไม่ใช่ id (หน่วยนับ · ขนาดตู้) — ใช้ชื่อเป็นค่าเหมือนหน้ารับงาน
 * ค่าเดิมที่ไม่อยู่ในรายการยังเลือกค้างไว้ได้ บันทึกแล้วจะได้ไม่ถูกล้างทิ้ง
 */
function MasterSelectByName({ name, list, value }: { name: string; list: Option[]; value: string | null }) {
  const current = value ?? '';
  return (
    <select name={name} defaultValue={current}>
      <option value="">-</option>
      {current && !list.some((o) => o.name === current) ? <option value={current}>{current} (ค่าเดิม)</option> : null}
      {list.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
    </select>
  );
}
