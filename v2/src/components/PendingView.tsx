import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, ApprovalBadge, FileChip, type Column } from '@/components/JobTable';
import {
  AcknowledgeInvoice, DraftActions, EofficeRequestForm, FileCustomsForm, MergeEofficeButton,
  RequestApproval, ShowReason, UploadForm, DeleteJob } from '@/components/ActionForms';
import { DraftLocalLaunch, SubmitDraftLocal } from '@/components/DraftLocalRun';
import { signedColumns } from '@/components/SignedColumns';
import { BulkBar, PickAllBox, PickBox } from '@/components/BulkBar';
import { requestApprovalMany } from '@/lib/actions/jobs';
import { handoverEoffice } from '@/lib/actions/eoffice-handover';
import { deleteJobs } from '@/lib/actions/job-delete';
import Link from 'next/link';
import { hasArrivalFiles, listJobs, otherQueue, QUEUE, type JobRow } from '@/lib/queries/jobs';
import { queueCounts } from '@/lib/queries/dashboard';
import { priceStatus } from '@/lib/sale/price-store';
import { DRAFT_WORKER_MODE, onlineWorkers } from '@/lib/worker-status';
import { DraftWorkerBar } from '@/components/DraftWorkerBar';

/**
 * ตารางงานคงค้างแบบแท็บตามขั้น — ใช้สองที่
 *   mode 'paint'      Pending jobs ของ Import Officer (PAINT) · ไม่รวมงาน Other cargo
 *   mode 'MO' / 'TO'  Other cargo ของ Head Officer — งานประเภทนั้นเท่านั้น ทำเองทั้งเส้น
 *                     ส่ง AN / FN แล้วอนุมัติอัตโนมัติ · ไม่มีแท็บย่อย "รออนุมัติ" · ขั้น Draft บันทึกเลขใบขนเอง
 *                     มีแท็บ 5 Submit (Signed) E-office ต่อท้าย (แทนหน้า Upload ชุดปล่อยของ PAINT)
 */
export type PendingMode = 'paint' | 'MO' | 'TO';

const TABS = [
  { key: 'bl', label: '1. งานใส่ข้อมูล BL' },
  { key: 'fn', label: '2. Final Invoice' },
  { key: 'draft', label: '3. Draft ใบขน' },
  { key: 'edoc', label: '4. เตรียมเอกสารเดิน E' },
];
const OTHER_TABS = [...TABS, { key: 'signed', label: '5. Submit (Signed) E-office' }];

const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

/*
 * ตัวกรองตามไฟล์เอกสารต้นเรื่อง (Arrival Notice / BL)
 *
 * "ทั้งหมด" อยู่หน้าสุดเพราะเป็นค่าตั้งต้น ปุ่มที่กำลังเลือกอยู่จึงไล่จากซ้ายไปขวา
 * ตามลำดับที่คนใช้ — ดูทั้งหมดก่อน แล้วค่อยแยกดูว่าใบไหนยังขาดไฟล์
 */
const FILE_FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'no', label: 'ไม่มีไฟล์' },
  { key: 'yes', label: 'มีไฟล์' },
] as const;

function columnsFor(
  tab: string,
  sub: 'wait' | 'approve',
  other: boolean,
  signed: Column[] = [],
  /** ราคา Sale ของแถวในแท็บ Draft — null = ไม่รู้ (ยังไม่ได้รัน migrate:sale) ไม่ล็อก */
  prices: Map<string, { confirmed: boolean }> | null = null,
): Column[] {
  const priceLocked = (id: string) => Boolean(prices && !prices.get(id)?.confirmed);
  const lockBadge = <span className="badge rejected" title="Sale ต้องกำหนดและยืนยันราคาเก็บลูกค้าก่อนยิงใบขน">🔒 รอราคาจาก Sale</span>;
  // งาน Other cargo กดแล้วอนุมัติทันที — ใช้คำว่า "ยืนยัน" แทน "ส่งอนุมัติ" ให้ตรงกับที่เกิดขึ้นจริง
  const sendLabel = (type: 'AN' | 'FN', rejected: boolean) =>
    (other ? (type === 'AN' ? 'ยืนยันเข้าตารางหลัก' : 'ยืนยัน Final Invoice') : rejected ? 'ส่งใหม่' : 'ส่งอนุมัติ');
  const base = [col.createdAt(), col.clientInCharge(), col.shipper(), col.blNo(),
    col.consignee(), col.eta(), col.lastDem(), col.lastDet()];

  if (tab === 'bl') {
    /*
     * ส่งอนุมัติได้ต่อเมื่อมีไฟล์ AN หรือ BL แนบแล้ว
     *
     * NAMKANG อนุมัติโดยเปิดไฟล์ดูเทียบกับข้อมูลที่คีย์ไว้ ไม่มีไฟล์ก็ไม่มีอะไรให้ตรวจ
     * ฝั่งเซิร์ฟเวอร์กันไว้อีกชั้นแล้ว ตรงนี้กันไม่ให้กดตั้งแต่แรก จะได้ไม่ต้องเจอ error
     * หลังกดไปแล้ว และบอกไปเลยว่าต้องทำอะไรต่อ
     */
    const hasFile = (r: JobRow) =>
      Boolean(r.currentFiles?.ARRIVAL_NOTICE || r.currentFiles?.BL);

    return [
      // ช่องติ๊กไว้หน้าสุด ใช้เลือกหลายรายการแล้วส่งอนุมัติทีเดียว
      ...(sub === 'wait' ? [{
        label: '', kind: 'actions' as const, className: 'col-pick',
        header: <PickAllBox />,
        // งานที่ยังไม่มีไฟล์ติ๊กไม่ได้ ไม่งั้นกด "ส่งอนุมัติทั้งหมด" แล้วจะติดเป็นใบ ๆ
        render: (r: JobRow) => (hasFile(r) ? <PickBox id={r.id} /> : null),
      }] : []),
      col.createdAt(), col.clientInCharge(), col.source(), col.shipper(), col.blNo(),
      col.consignee(), col.eta(), col.demDet(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            <ApprovalBadge status={r.anStatus} />
            <ShowReason reason={r.anStatus === 'REJECTED' ? r.anReason : null} />
            {/* ยังไม่เข้าตารางหลัก ลบได้ทั้งตอนรอส่ง และตอนส่งไปรอ Head Officer อนุมัติ */}
            {sub === 'approve' ? <DeleteJob jobId={r.id} jobNo={r.jobNo} waiting /> : null}
            {sub === 'wait' ? (
              <>
                {/*
                  เปิดเป็นแผงที่มีไฟล์ AN/BL อยู่ข้าง ๆ แทนแผงเล็กแบบเดิม
                  เป็นลิงก์จริง จึงส่งต่อและกดรีเฟรชได้
                */}
                <Link className="button tiny" href={`/bl-edit/${r.id}`}>แก้ไข</Link>
                <DeleteJob jobId={r.id} jobNo={r.jobNo} />
                {hasFile(r) ? (
                  <RequestApproval jobId={r.id} type="AN" label={sendLabel('AN', r.anStatus === 'REJECTED')} auto={other} />
                ) : other ? (
                  <span className="badge pending">ยังไม่มีไฟล์ AN/BL — แนบที่แผงสรุปงาน</span>
                ) : (
                  /* บอกว่าติดอะไรและไปทำต่อที่ไหน ดีกว่าปุ่มหายไปเฉย ๆ แล้วงงว่าทำไม */
                  <Link className="badge pending file-link" href="/intake/an?tab=attach">
                    ยังไม่มีไฟล์ AN/BL — แนบก่อน
                  </Link>
                )}
              </>
            ) : null}
          </div>
        ),
      }];
  }
  if (tab === 'draft' && other) {
    /*
     * Other cargo: ไม่มีขั้นส่งให้ Senior Officer ตรวจ — สร้าง Draft แล้วบันทึกเลขใบขนเองต่อได้เลย
     * ได้เลขแล้วงานย้ายไปแท็บ 4 เตรียมเอกสารเดิน E
     */
    return [...base, col.refNo(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            {draftBadge(r)}
            <ShowReason reason={r.draftStatus === 'HUB_ERROR' ? r.draftRejectReason : null} />
            {r.draftStatus === 'SENT_TO_HUB' && r.draftTaskId ? <DraftLocalLaunch jobId={r.id} taskId={r.draftTaskId} /> : null}
            {priceLocked(r.id) ? lockBadge : (
              <>
                {r.draftStatus !== 'SENT_TO_HUB' && r.currentFiles?.FINAL_INVOICE ? (
                  <SubmitDraftLocal jobId={r.id} label={r.draftRefNo ? 'สร้าง Draft ใหม่' : 'สร้าง Draft'} />
                ) : null}
                <FileCustomsForm jobId={r.id} />
              </>
            )}
          </div>
        ),
      }];
  }
  if (tab === 'signed') return signed;
  if (tab === 'draft') {
    return [...base, col.refNo(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            {draftBadge(r)}
            <ShowReason reason={r.draftStatus === 'REJECTED' || r.draftStatus === 'HUB_ERROR' ? r.draftRejectReason : null} />
            {sub === 'wait' && priceLocked(r.id) ? lockBadge : sub === 'wait' ? (
              <DraftActions
                jobId={r.id}
                draftStatus={r.draftStatus}
                hasRefNo={Boolean(r.draftRefNo)}
                hasInvoice={Boolean(r.currentFiles?.FINAL_INVOICE)}
                draftTaskId={r.draftTaskId}
              />
            ) : null}
          </div>
        ),
      }];
  }
  if (tab === 'edoc') {
    return [
      /*
       * ติ๊กหลายรายการแล้วกด "ส่งมอบคนเดินเอกสาร" ทีเดียว
       * ติ๊กได้เฉพาะงานที่รวมชุด E-Office แล้ว — ยังไม่มีชุดก็ไม่มีอะไรให้คนเดินเอกสารถือไป
       */
      {
        label: '', kind: 'actions' as const, className: 'col-pick',
        header: <PickAllBox />,
        render: (r: JobRow) => (r.currentFiles?.EOFFICE_MERGED ? <PickBox id={r.id} /> : null),
      },
      col.createdAt(), col.clientInCharge(), col.shipper(), col.blNo(), col.refNo(),
      col.declarationNo(), col.consignee(), col.eta(), col.lastDem(), col.lastDet(),
      {
        label: 'คำร้อง E-Office', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            {r.eofficeRequestNo ? (
              <a className="badge approved file-link" href={`/eoffice/${r.id}`}>
                {r.eofficeRequestNo}
              </a>
            ) : null}
            <EofficeRequestForm
              jobId={r.id}
              unitAmount={r.unitAmount}
              packageType={r.packageType}
              grossWeight={r.grossWeight}
              product={r.product}
              hasRequest={Boolean(r.eofficeRequestNo)}
              attentionName={r.eofficeAttention}
              officer={{
                prefix: r.eofficeOfficerPrefix, surname: r.eofficeOfficerSurname,
                position: r.eofficeOfficerPosition, section: r.eofficeSection,
              }}
              goodsValue={r.goodsValue}
              goodsCurrency={r.goodsCurrency}
            />
          </div>
        ),
      },
      {
        label: 'ชุด E-Office', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            <FileChip file={r.currentFiles?.EOFFICE_MERGED} />
            <MergeEofficeButton jobId={r.id} />
          </div>
        ),
      }];
  }
  return [...base,
    {
      label: 'Invoice สินค้า', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          <FileChip file={r.currentFiles?.INVOICE_GOODS} />
          {r.hasInvoiceAlert ? <AcknowledgeInvoice jobId={r.id} /> : null}
        </div>
      ),
    },
    {
      label: 'Final Invoice', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          <FileChip file={r.currentFiles?.FINAL_INVOICE} />
          {sub === 'wait' ? (
            <UploadForm jobId={r.id} category="FINAL_INVOICE"
              label={r.currentFiles?.FINAL_INVOICE ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} />
          ) : null}
        </div>
      ),
    },
    {
      label: 'สถานะ / จัดการ', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          <ApprovalBadge status={r.fnStatus} />
          <ShowReason reason={r.fnStatus === 'REJECTED' ? r.fnReason : null} />
          {/* อัปโหลดไฟล์แล้วยังไม่ย้ายเอง ต้องกดส่งอนุมัติก่อน รายการจึงจะไปหา FAH */}
          {sub === 'wait' && r.currentFiles?.FINAL_INVOICE ? (
            <RequestApproval
              jobId={r.id}
              type="FN"
              label={sendLabel('FN', r.fnStatus === 'REJECTED')}
              auto={other}
            />
          ) : null}
        </div>
      ),
    }];
}

export async function PendingView({
  searchParams, mode, basePath, title, subtitle, actions,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  mode: PendingMode; basePath: string; title: string; subtitle: string;
  /** ปุ่มมุมขวาบน เช่น "+ เพิ่ม Job" ของหน้า Other cargo */
  actions?: React.ReactNode;
}) {
  const other = mode !== 'paint';
  const Q = other ? otherQueue(mode) : QUEUE;
  const tabs = other ? OTHER_TABS : TABS;
  const { one, search, sortBy, sortDir, carry } = readParams(searchParams, SEARCH_KEYS);

  const tab = tabs.some((t) => t.key === one('tab')) ? one('tab') : 'bl';
  // Other cargo อนุมัติอัตโนมัติ ไม่มีรายการ "รออนุมัติ" ให้ดู
  const sub: 'wait' | 'approve' = !other && one('sub') === 'approve' ? 'approve' : 'wait';

  /*
   * กรองตามว่ามีไฟล์ AN/BL แนบอยู่หรือยัง
   *
   * งานที่นำเข้าจากไฟล์ตารางมีข้อมูลครบแต่ยังไม่มีไฟล์แนบ เลือก "ไม่มีไฟล์"
   * แล้วจะเหลือเฉพาะชุดนั้น เอาไปไล่อัปที่หน้าแนบไฟล์ AN/BL ได้ครบในรอบเดียว
   * ส่วน "มีไฟล์" ใช้ดูว่าอัปไปแล้วเท่าไหร่ เป็นฝั่งตรงข้ามกันพอดี
   */
  /*
   * มีเฉพาะแท็บ 1 งานใส่ข้อมูล BL
   *
   * ไฟล์ AN/BL เป็นเรื่องของขั้นรับงานซึ่งจบไปตั้งแต่แท็บนี้ พอถึงแท็บถัด ๆ ไป
   * (Final Invoice · Draft ใบขน · เตรียมเอกสารเดิน E) งานผ่านการอนุมัติ AN มาแล้ว
   * ซึ่งบังคับว่าต้องมีไฟล์ ตัวกรองจึงไม่เหลืออะไรให้แยก
   *
   * บังคับเป็น all ตรงนี้จุดเดียว ทั้งเงื่อนไข query และลิงก์ที่พาค่าต่อจึงถูกตามไปเอง
   * ไม่ต้องไปไล่เช็กแท็บซ้ำในแต่ละที่ แล้วเสี่ยงลืมที่ใดที่หนึ่ง
   */
  const canFilterFiles = tab === 'bl';
  const files = canFilterFiles
    ? (FILE_FILTERS.find((f) => f.key === one('files')) ?? FILE_FILTERS[0]).key
    : 'all';

  /*
   * ไม่ได้สั่งเรียง = เรียงตามวันที่สร้างงาน ใหม่สุดอยู่บนสุด
   *
   * listJobs() เรียงแบบนี้เป็นค่าตั้งต้นอยู่แล้ว แต่ต้องบอกซ้ำตรงนี้เพื่อให้หัวตาราง
   * ขึ้นลูกศรว่ากำลังเรียงด้วยคอลัมน์ไหน ไม่งั้นจะขึ้น "↕" เหมือนยังไม่ได้เรียงอะไร
   * ทั้งที่เรียงอยู่ แล้วกดครั้งแรกจะสลับเป็นเก่าสุดขึ้นก่อน ซึ่งสวนกับที่เห็นตรงหน้า
   */
  const sortKey = sortBy ?? 'createdAt';
  const sortWay = sortBy ? sortDir : 'desc';

  const queue =
    tab === 'bl' ? Q.pendingBl(sub)
    : tab === 'fn' ? Q.pendingFn(sub)
    : tab === 'draft' ? Q.pendingDraft(sub)
    : tab === 'signed' ? Q.eofficeSigned('wait')
    : Q.pendingEdoc();

  const where = (ctx: Parameters<typeof queue>[0]) => [
    ...queue(ctx),
    ...(files === 'all' ? [] : [hasArrivalFiles(files === 'yes')]),
  ];

  const [{ rows, total }, counts, draftWorkers, signed] = await Promise.all([
    listJobs({ where, search, sortBy: sortKey, sortDir: sortWay }),
    /*
     * ตัวเลขบนแท็บ — เงื่อนไขชุดเดียวกับตาราง (Q) ตัวเลขจึงเท่ากับจำนวนแถวเสมอ
     * แท็บ 1-3 นับรายการที่รอกดส่ง · แท็บ 4 ที่ยังไม่ส่งมอบคนเดินเอกสาร · แท็บ 5 ที่ยังไม่ส่ง Partner
     */
    queueCounts({
      bl: Q.pendingBl('wait'), fn: Q.pendingFn('wait'), draft: Q.pendingDraft('wait'), edoc: Q.pendingEdoc(),
      ...(other ? { signed: Q.eofficeSigned('wait') } : {}),
    } as Record<string, ReturnType<typeof Q.pendingEdoc>>),
    // worker ที่สร้าง Draft ใน NETBAY — บอกว่ากดแล้วจะมีคนรับงานไหม
    tab === 'draft' ? onlineWorkers({ mode: DRAFT_WORKER_MODE }) : Promise.resolve([]),
    tab === 'signed' ? signedColumns(false) : Promise.resolve([] as Column[]),
  ]);

  // แท็บ Draft: งานที่ Sale ยังไม่ยืนยันราคา ยิงใบขนไม่ได้ — ซ่อนปุ่มแล้วขึ้นป้าย 🔒 แทน
  const prices = tab === 'draft' ? await priceStatus(rows.map((r) => r.id)) : null;

  const tabsWithCount = tabs.map((t) => ({ ...t, count: counts[t.key] || undefined }));

  /*
   * ตัวกรองต้องติดไปกับทุกลิงก์ในหน้า (สลับแท็บ · เรียงลำดับ · ค้นหา)
   * ไม่งั้นกดอะไรก็ตามแล้วตัวกรองหลุด ซึ่งงงกว่าไม่มีตัวกรองเลย
   */
  const filterCarry = { ...carry, ...(files === 'all' ? {} : { files }) };
  const fullCarry = { ...filterCarry, tab, sub };

  const table = (
    <JobTable
      basePath={basePath}
      columns={columnsFor(tab, sub, other, signed, prices)}
      rows={rows}
      total={total}
      carry={fullCarry}
      sortBy={sortKey}
      sortDir={sortWay}
    />
  );

  return (
    <>
      <div className={actions ? 'page-head with-action' : 'page-head'}>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {actions ? <div className="row-actions">{actions}</div> : null}
      </div>

      {/* ตัวกรองติดไปตอนสลับแท็บด้วย เพราะเป็นเรื่องเดียวกันทุกแท็บ ไม่ใช่ของแท็บใดแท็บหนึ่ง */}
      <Tabs basePath={basePath} items={tabsWithCount} active={tab} carry={filterCarry} />

      {!other && tab !== 'edoc' ? (
        <div className="tabs">
          {(['wait', 'approve'] as const).map((value) => {
            const params = new URLSearchParams({ ...carry, tab, sub: value });
            return (
              <a
                key={value}
                href={`${basePath}?${params.toString()}`}
                aria-current={value === sub ? 'page' : undefined}
              >
                {value === 'wait' ? 'รอส่งอนุมัติ' : 'รออนุมัติรายการ'}
              </a>
            );
          })}
        </div>
      ) : null}

      {/*
        ตัวกรองไฟล์ AN/BL — มีเฉพาะแท็บ 1 ซึ่งเป็นขั้นที่ยังตามหาไฟล์กันอยู่
        เป็นลิงก์เปลี่ยน URL ไม่ใช่ช่องติ๊กที่ต้องกดส่ง เพราะหน้านี้เป็น server component
        ทั้งหน้า จึงส่งต่อและกดรีเฟรชได้ เหมือนแท็บอื่นในหน้านี้
      */}
      {canFilterFiles ? (
      <div className="filter-bar">
        <span className="filter-label">ไฟล์ AN / BL</span>
        <div className="chip-group">
          {FILE_FILTERS.map((f) => {
            const next = new URLSearchParams({ ...carry, tab, sub });
            // "ทั้งหมด" เป็นค่าตั้งต้น จึงไม่ต้องใส่ลง URL ให้รกและกลายเป็นลิงก์คนละเส้น
            if (f.key !== 'all') next.set('files', f.key);
            return (
              <a
                key={f.key}
                className={`chip-toggle${f.key === files ? ' on' : ''}`}
                href={`${basePath}?${next.toString()}`}
                aria-current={f.key === files ? 'true' : undefined}
              >
                {f.label}
              </a>
            );
          })}
        </div>
        {files === 'no' ? (
          <span className="filter-note">
            {total} งานยังไม่มีไฟล์ AN และ BL · ส่งอนุมัติไม่ได้จนกว่าจะแนบไฟล์
            {other ? null : <>{' · '}<Link href="/intake/an?tab=attach">ไปหน้าแนบไฟล์ AN/BL เข้างาน</Link></>}
          </span>
        ) : null}
      </div>
      ) : null}

      {/* กด "สร้าง Draft" แล้ว worker ตรวจ Final Invoice ออกเลขเครื่อง สร้างใบขนใน NETBAY และ Import CSV ให้ */}
      {tab === 'draft' ? <DraftWorkerBar initial={draftWorkers} /> : null}

      {tab === 'edoc' ? (
        <BulkBar
          action={handoverEoffice}
          idName="jobIds"
          label="ส่งมอบคนเดินเอกสาร {n} รายการ"
          confirmText={'ส่งมอบชุดเอกสารเดิน E {n} รายการให้คนเดินเอกสารใช่ไหม\n\n'
            + (other ? 'รายการจะย้ายไปรออัปโหลดชุดที่เซ็นแล้วที่แท็บ 5' : 'รายการจะไปรออัปโหลดชุดที่เซ็นแล้วที่หน้า Submit (Signed) E-office Doc')}
        >
          {table}
        </BulkBar>
      ) : tab === 'bl' && sub === 'wait' ? (
        <BulkBar
          action={requestApprovalMany}
          idName="jobIds"
          label={other ? 'ยืนยันเข้าตารางหลัก {n} รายการ' : 'ส่งอนุมัติ {n} รายการ'}
          confirmText={other
            ? 'ยืนยัน {n} รายการเข้าตารางหลักใช่ไหม · Other cargo อนุมัติให้ทันที'
            : 'ส่งอนุมัติ {n} รายการใช่ไหม · ส่งแล้วแก้ไขไม่ได้จนกว่าจะมีผลตัดสิน'}
          extra={{
            action: deleteJobs,
            label: 'ลบ {n} รายการ',
            danger: true,
            confirmText:
              'ลบ {n} รายการถาวรใช่ไหม\n\n'
              + 'ข้อมูลงาน ไฟล์ AN/BL รายการตู้ และประวัติจะถูกลบทั้งหมด กู้คืนไม่ได้',
          }}
        >
          {table}
        </BulkBar>
      ) : table}
    </>
  );
}
