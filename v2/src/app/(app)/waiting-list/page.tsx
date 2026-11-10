import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { FileChip, JobTable, Tabs, type Column } from '@/components/JobTable';
import { DeleteJob } from '@/components/ActionForms';
import { IntakeForm } from '@/components/IntakeForm';
import { IntakeBatch } from '@/components/IntakeBatch';
import { ShipmentImport } from '@/components/ShipmentImport';
import { ShowReason } from '@/components/ActionForms';
import { createJobFromIntake } from '@/lib/actions/intake';
import { importShipmentCsv, previewShipmentCsv } from '@/lib/actions/shipment-import';
import { queueCounts } from '@/lib/queries/dashboard';
import { batchDefaults, intakeSetup } from '@/lib/queries/intake-setup';
import { listJobs, QUEUE, type JobRow } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'vessel'];

const TABS = [
  { key: 'open', label: 'รอ Arrival Notice' },
  { key: 'done', label: 'เข้าตารางหลักแล้ว' },
] as const;

/** ทางนำเข้า — ชุดเดียวกับหน้า Arrival notice upload แต่งานที่ได้เป็นงานจาก BL (รอ AN) */
const MODES = [
  { key: 'one', label: '📄 ทีละใบ', hint: 'อัปโหลด PDF ของ BL → ระบบอ่านข้อมูลและเติมฟอร์ม → ตรวจสอบ → บันทึก' },
  { key: 'batch', label: '📚 หลายใบพร้อมกัน', hint: 'เลือก PDF หลายไฟล์ → ระบบอ่านให้ทุกใบ → ตรวจในตาราง → บันทึกทีเดียว' },
  { key: 'import', label: '⇪ นำเข้า Excel (Shipment Detail)', hint: 'เลือกไฟล์ตารางงาน (Excel หรือ .csv) → ระบบตรวจทั้งแผ่นให้ดูก่อน → ยืนยันนำเข้าทีเดียว' },
] as const;

/**
 * Waiting list (Senior / Head Officer) — งานที่เพิ่มจาก BL ก่อน Arrival Notice จากสายเรือมา
 *
 * หน้าเดียวจบ: นำเข้างานจาก BL ด้านบน (PDF ทีละใบ · หลายใบ · Excel) แล้วดูรายการที่รอ AN ด้านล่าง
 * แทนเมนู Waiting BL เดิม (รายการ BL คร่าว ๆ ที่ไม่ใช่งานจริง) — ตอนนี้ทุกรายการเป็นงานจริงตั้งแต่ต้น
 * PAINT รับ AN ที่ BL ตรงกันจะเห็นเตือน "BL ซ้ำกับงานที่มีอยู่" แล้วแนบ AN เข้างานเดิมแทนการสร้างใหม่
 * Head Officer อนุมัติ AN แล้วงานย้ายไปแท็บ "เข้าตารางหลักแล้ว" เอง
 * ระหว่างรอ แก้ข้อมูลหรือลบงาน (คีย์ผิด / ลูกค้ายกเลิก) ได้จากตาราง
 */
export default async function WaitingListPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['FAH', 'NAMKANG']);
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');
  const tab = one('tab') === 'done' ? 'done' : 'open';
  const mode = MODES.find((m) => m.key === one('add'))?.key ?? '';
  const { search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);

  const [{ rows, total }, counts, setup] = await Promise.all([
    listJobs({
      where: tab === 'done' ? QUEUE.waitingListDone() : QUEUE.waitingList(),
      search,
      // รอ AN: ETA ใกล้สุดขึ้นก่อน · เข้าตารางหลักแล้ว: ล่าสุดขึ้นก่อน
      sortBy: sortBy ?? (tab === 'open' ? 'eta' : 'createdAt'),
      sortDir: sortBy ? sortDir : tab === 'open' ? 'asc' : 'desc',
    }),
    queueCounts({ open: QUEUE.waitingList(), done: QUEUE.waitingListDone() }),
    mode && mode !== 'import' ? intakeSetup() : Promise.resolve(null),
  ]);

  const tabCarry = { ...carry, ...(tab !== 'open' ? { tab } : {}) };
  const addHref = (key: string) => {
    const p = new URLSearchParams({ ...tabCarry, ...(key ? { add: key } : {}) });
    const s = p.toString();
    return s ? `/waiting-list?${s}` : '/waiting-list';
  };

  const status = (r: JobRow) => {
    if (r.anStatus === 'APPROVED') return <span className="badge approved">เข้าตารางหลักแล้ว</span>;
    if (r.anStatus === 'PENDING') return <span className="badge neutral">รอ Head Officer อนุมัติ AN</span>;
    if (r.anStatus === 'REJECTED') return <><span className="badge rejected">AN ถูกตีกลับ</span><ShowReason reason={r.anReason} /></>;
    if (r.currentFiles?.ARRIVAL_NOTICE) return <span className="badge neutral">มี AN แล้ว · รอ Import Officer ส่งอนุมัติ</span>;
    return <span className="badge pending">ยังไม่มี AN</span>;
  };

  const columns: Column[] = [
    col.createdAt(), col.clientInCharge(), col.shipper(), col.blNo(), col.consignee(), col.vessel(),
    col.eta(), col.demDet(),
    { label: 'เลขตู้', kind: 'wrap', render: (r) => r.containerNos ?? (r.containerCount ? `${r.containerCount} ตู้` : '-') },
    { label: 'ไฟล์ BL', kind: 'wrap', className: 'col-file', render: (r) => <FileChip file={r.currentFiles?.BL} /> },
    {
      label: 'Arrival Notice', kind: 'wrap', className: 'col-file',
      render: (r) => (r.currentFiles?.ARRIVAL_NOTICE ? <FileChip file={r.currentFiles.ARRIVAL_NOTICE} /> : <span className="muted">-</span>),
    },
    { label: 'สถานะ', kind: 'wrap', render: (r) => <div className="row-actions">{status(r)}</div> },
    ...(tab === 'open' ? [{
      label: 'จัดการ', kind: 'actions' as const,
      render: (r: JobRow) => (
        <div className="row-actions">
          <Link className="button tiny" href={`/bl-edit/${r.id}`}>แก้ไข</Link>
          <DeleteJob jobId={r.id} jobNo={r.jobNo} waiting={r.anStatus === 'PENDING'} />
        </div>
      ),
    }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>Waiting list</h1>
        <p>
          งานที่ได้ BL มาก่อน Arrival Notice จากสายเรือ (ลูกค้าส่ง BL มาทาง LINE / อีเมล) · นำเข้าได้แบบเดียวกับ Arrival notice upload ·
          Head Officer อนุมัติ AN แล้วงานย้ายไปแท็บ “เข้าตารางหลักแล้ว” เอง
        </p>
      </div>

      {/* ---------- นำเข้างานจาก BL ---------- */}
      <section className="wbl-card wl-import">
        <div className="wl-import-head">
          <b>+ นำเข้างานจาก BL</b>
          <div className="chip-group">
            {MODES.map((m) => (
              <Link key={m.key} className={`chip-toggle${mode === m.key ? ' on' : ''}`} href={addHref(mode === m.key ? '' : m.key)} scroll={false}>
                {m.label}
              </Link>
            ))}
          </div>
          {mode ? <Link className="button tiny" href={addHref('')} scroll={false}>ปิด</Link> : null}
        </div>
        {mode ? <p className="wbl-hint">{MODES.find((m) => m.key === mode)!.hint}</p> : (
          <p className="wbl-hint">เลือกวิธีนำเข้าด้านบน — งานที่บันทึกจะขึ้นในรายการ “รอ Arrival Notice” ด้านล่างทันที</p>
        )}

        {mode === 'import' ? (
          <ShipmentImport sourceType="BL" preview={previewShipmentCsv} confirm={importShipmentCsv} />
        ) : mode === 'batch' && setup ? (
          <IntakeBatch
            sourceType="BL"
            templates={setup.templates}
            options={{ shippers: setup.options.shippers }}
            defaults={batchDefaults(setup.defaults)}
            action={createJobFromIntake}
          />
        ) : mode === 'one' && setup ? (
          <IntakeForm
            sourceType="BL"
            templates={setup.templates}
            options={setup.options}
            defaults={setup.defaults}
            action={createJobFromIntake}
          />
        ) : null}
      </section>

      {/* ---------- รายการ ---------- */}
      <Tabs
        basePath="/waiting-list"
        items={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        carry={carry}
      />
      <JobTable
        basePath="/waiting-list"
        columns={columns}
        rows={rows} total={total} carry={tabCarry} sortBy={sortBy} sortDir={sortDir}
        empty={tab === 'open' ? 'ไม่มีงานที่รอ Arrival Notice' : 'ยังไม่มีงานจาก BL ที่เข้าตารางหลัก'}
      />
    </>
  );
}
