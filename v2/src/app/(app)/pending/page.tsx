import { requireUserReady } from '@/lib/auth';
import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, ApprovalBadge, FileChip, type Column } from '@/components/JobTable';
import {
  AcknowledgeInvoice, DraftActions, EditBlForm, EofficeRequestForm, MergeEofficeButton,
  RequestApproval, ShowReason, UploadForm,
} from '@/components/ActionForms';
import { BulkBar, PickAllBox, PickBox } from '@/components/BulkBar';
import { requestApprovalMany } from '@/lib/actions/jobs';
import { deleteJobs } from '@/lib/actions/job-delete';
import Link from 'next/link';
import { listJobs, missingArrivalFiles, QUEUE, type JobRow } from '@/lib/queries/jobs';
import { pendingTabCounts } from '@/lib/queries/dashboard';
import { intakeOptions } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'bl', label: '1. งานใส่ข้อมูล BL' },
  { key: 'fn', label: '2. Final Invoice' },
  { key: 'draft', label: '3. Draft ใบขน' },
  { key: 'edoc', label: '4. เตรียมเอกสารเดิน E' },
] as const;

const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

function columnsFor(
  tab: string,
  sub: 'wait' | 'approve',
  options: Awaited<ReturnType<typeof intakeOptions>>,
): Column[] {
  const base = [col.clientInCharge(), col.shipper(), col.blNo(), col.consignee(),
    col.eta(), col.lastDem(), col.lastDet(), col.createdAt()];

  if (tab === 'bl') {
    return [
      // ช่องติ๊กไว้หน้าสุด ใช้เลือกหลายรายการแล้วส่งอนุมัติทีเดียว
      ...(sub === 'wait' ? [{
        label: '', kind: 'actions' as const, className: 'col-pick',
        header: <PickAllBox />,
        render: (r: JobRow) => <PickBox id={r.id} />,
      }] : []),
      col.clientInCharge(), col.source(), col.shipper(), col.blNo(), col.consignee(),
      col.eta(), col.demDet(), col.createdAt(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            <ApprovalBadge status={r.anStatus} />
            <ShowReason reason={r.anStatus === 'REJECTED' ? r.anReason : null} />
            {sub === 'wait' ? (
              <>
                {/*
                  เปิดเป็นแผงที่มีไฟล์ AN/BL อยู่ข้าง ๆ แทนแผงเล็กแบบเดิม
                  เป็นลิงก์จริง จึงส่งต่อและกดรีเฟรชได้
                */}
                <Link className="button tiny" href={`/bl-edit/${r.id}`}>แก้ไข</Link>
                <RequestApproval jobId={r.id} type="AN" label={r.anStatus === 'REJECTED' ? 'ส่งใหม่' : 'ส่งอนุมัติ'} />
              </>
            ) : null}
          </div>
        ),
      }];
  }
  if (tab === 'draft') {
    return [...base, col.refNo(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            {draftBadge(r)}
            <ShowReason reason={r.draftStatus === 'REJECTED' ? r.draftRejectReason : null} />
            {sub === 'wait' ? (
              <DraftActions
                jobId={r.id}
                draftStatus={r.draftStatus}
                hasRefNo={Boolean(r.draftRefNo)}
                hasInvoice={Boolean(r.currentFiles?.FINAL_INVOICE)}
              />
            ) : null}
          </div>
        ),
      }];
  }
  if (tab === 'edoc') {
    return [col.clientInCharge(), col.shipper(), col.blNo(), col.refNo(), col.declarationNo(),
      col.consignee(), col.eta(), col.lastDem(), col.lastDet(), col.createdAt(),
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
              label={r.fnStatus === 'REJECTED' ? 'ส่งใหม่' : 'ส่งอนุมัติ'}
            />
          ) : null}
        </div>
      ),
    }];
}

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['PAINT']);
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);

  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'bl';
  const sub: 'wait' | 'approve' = one('sub') === 'approve' ? 'approve' : 'wait';

  /*
   * กรองเฉพาะงานที่ยังไม่มีไฟล์ AN และ BL เลยสักใบ
   *
   * งานที่นำเข้าจากไฟล์ตารางมีข้อมูลครบแต่ยังไม่มีไฟล์แนบ ติ๊กช่องนี้แล้วจะเหลือ
   * เฉพาะชุดนั้น เอาไปไล่อัปไฟล์ที่หน้า "แนบไฟล์ AN/BL เข้างาน" ได้ครบในรอบเดียว
   */
  const noFiles = one('noFiles') === '1';

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
    tab === 'bl' ? QUEUE.pendingBl(sub)
    : tab === 'fn' ? QUEUE.pendingFn(sub)
    : tab === 'draft' ? QUEUE.pendingDraft(sub)
    : QUEUE.pendingEdoc();

  const where = (ctx: Parameters<typeof queue>[0]) => [
    ...queue(ctx),
    ...(noFiles ? [missingArrivalFiles()] : []),
  ];

  const [{ rows, total }, counts, options] = await Promise.all([
    listJobs({ where, search, sortBy: sortKey, sortDir: sortWay }),
    pendingTabCounts(),
    // ตัวเลือก master สำหรับฟอร์มแก้ BL — ดึงรอบเดียวแล้วส่งต่อให้ทุกแถวใช้ร่วมกัน
    intakeOptions(),
  ]);

  // แท็บ 1-3 เตือนจำนวนที่รอกดส่งอนุมัติ แท็บ 4 เตือนจำนวนที่ยังไม่ได้รวมชุด
  const tabsWithCount = TABS.map((t) => ({ ...t, count: counts[t.key] || undefined }));

  /*
   * ตัวกรองต้องติดไปกับทุกลิงก์ในหน้า (สลับแท็บ · เรียงลำดับ · ค้นหา)
   * ไม่งั้นกดอะไรก็ตามแล้วตัวกรองหลุด ซึ่งงงกว่าไม่มีตัวกรองเลย
   */
  const filterCarry = { ...carry, ...(noFiles ? { noFiles: '1' } : {}) };
  const fullCarry = { ...filterCarry, tab, sub };

  const table = (
    <JobTable
      basePath="/pending"
      columns={columnsFor(tab, sub, options)}
      rows={rows}
      total={total}
      carry={fullCarry}
      sortBy={sortKey}
      sortDir={sortWay}
    />
  );

  return (
    <>
      <div className="page-head">
        <h1>งานคงค้าง</h1>
        <p>BL → Final Invoice → Draft ใบขน → เตรียมเอกสารเดิน E</p>
      </div>

      {/* ตัวกรองติดไปตอนสลับแท็บด้วย เพราะเป็นเรื่องเดียวกันทุกแท็บ ไม่ใช่ของแท็บใดแท็บหนึ่ง */}
      <Tabs basePath="/pending" items={tabsWithCount} active={tab} carry={filterCarry} />

      {tab !== 'edoc' ? (
        <div className="tabs">
          {(['wait', 'approve'] as const).map((value) => {
            const params = new URLSearchParams({ ...carry, tab, sub: value });
            return (
              <a
                key={value}
                href={`/pending?${params.toString()}`}
                aria-current={value === sub ? 'page' : undefined}
              >
                {value === 'wait' ? 'รอส่งอนุมัติ' : 'รออนุมัติรายการ'}
              </a>
            );
          })}
        </div>
      ) : null}

      {/*
        ตัวกรองงานที่ยังไม่มีไฟล์ AN/BL — เป็นลิงก์สลับเปิด/ปิด ไม่ใช่ช่องติ๊กที่ต้องกดส่ง
        หน้านี้เป็น server component ทั้งหน้า การเปลี่ยนตัวกรองจึงเป็นการเปลี่ยน URL
        ซึ่งส่งต่อและกดรีเฟรชได้ เหมือนแท็บอื่นในหน้านี้
      */}
      <div className="filter-bar">
        <a
          className={`chip-toggle${noFiles ? ' on' : ''}`}
          href={`/pending?${new URLSearchParams({
            ...carry, tab, sub, ...(noFiles ? {} : { noFiles: '1' }),
          }).toString()}`}
        >
          {noFiles ? '✓ ' : ''}เฉพาะงานที่ยังไม่ได้แนบไฟล์ AN / BL
        </a>
        {noFiles ? (
          <span className="filter-note">
            แสดง {total} งานที่ยังไม่มีไฟล์ AN และ BL ·{' '}
            <Link href="/intake/an?tab=attach">ไปหน้าแนบไฟล์ AN/BL เข้างาน</Link>
          </span>
        ) : null}
      </div>

      {tab === 'bl' && sub === 'wait' ? (
        <BulkBar
          action={requestApprovalMany}
          idName="jobIds"
          label="ส่งอนุมัติ {n} รายการ"
          confirmText="ส่งอนุมัติ {n} รายการใช่ไหม · ส่งแล้วแก้ไขไม่ได้จนกว่าจะมีผลตัดสิน"
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
