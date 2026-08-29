import { requireUser } from '@/lib/auth';
import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, ApprovalBadge, FileChip, type Column } from '@/components/JobTable';
import {
  AcknowledgeInvoice, DraftActions, EditBlForm, EofficeRequestForm, MergeEofficeButton,
  RequestApproval, ShowReason, UploadForm,
} from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { pendingTabCounts } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'bl', label: '1. งานใส่ข้อมูล BL' },
  { key: 'fn', label: '2. Final Invoice' },
  { key: 'draft', label: '3. Draft ใบขน' },
  { key: 'edoc', label: '4. เตรียมเอกสารเดิน E' },
] as const;

const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

function columnsFor(tab: string, sub: 'wait' | 'approve'): Column[] {
  const base = [col.clientInCharge(), col.shipper(), col.blNo(), col.consignee(),
    col.eta(), col.lastDem(), col.lastDet()];

  if (tab === 'bl') {
    return [col.clientInCharge(), col.source(), col.shipper(), col.blNo(), col.consignee(),
      col.eta(), col.demDet(),
      {
        label: 'สถานะ / จัดการ', kind: 'actions',
        render: (r) => (
          <div className="row-actions">
            <ApprovalBadge status={r.anStatus} />
            <ShowReason reason={r.anStatus === 'REJECTED' ? r.anReason : null} />
            {sub === 'wait' ? (
              <>
                <EditBlForm
                  jobId={r.id}
                  blNo={r.blNo}
                  vessel={r.vessel}
                  voyage={r.voyage}
                  eta={r.eta}
                  transportDate={r.transportDate}
                  demDays={r.demDays}
                  detDays={r.detDays}
                  product={r.product}
                />
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
      col.consignee(), col.eta(), col.lastDem(), col.lastDet(),
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
  await requireUser(['PAINT']);
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);

  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'bl';
  const sub: 'wait' | 'approve' = one('sub') === 'approve' ? 'approve' : 'wait';

  const where =
    tab === 'bl' ? QUEUE.pendingBl(sub)
    : tab === 'fn' ? QUEUE.pendingFn(sub)
    : tab === 'draft' ? QUEUE.pendingDraft(sub)
    : QUEUE.pendingEdoc();

  const [{ rows, total }, counts] = await Promise.all([
    listJobs({ where, search, sortBy, sortDir }),
    pendingTabCounts(),
  ]);

  // แท็บ 1-3 เตือนจำนวนที่รอกดส่งอนุมัติ แท็บ 4 เตือนจำนวนที่ยังไม่ได้รวมชุด
  const tabsWithCount = TABS.map((t) => ({ ...t, count: counts[t.key] || undefined }));

  const fullCarry = { ...carry, tab, sub };

  return (
    <>
      <div className="page-head">
        <h1>งานคงค้าง</h1>
        <p>BL → Final Invoice → Draft ใบขน → เตรียมเอกสารเดิน E</p>
      </div>

      <Tabs basePath="/pending" items={tabsWithCount} active={tab} carry={carry} />

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

      <JobTable
        basePath="/pending"
        columns={columnsFor(tab, sub)}
        rows={rows}
        total={total}
        carry={fullCarry}
        sortBy={sortBy}
        sortDir={sortDir}
      />
    </>
  );
}
