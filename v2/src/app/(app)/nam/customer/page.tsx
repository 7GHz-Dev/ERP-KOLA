import { requireUser } from '@/lib/auth';
import { readParams, surrenderBadge } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import {
  ConfirmCustomerButton, RequestEditButton, SurrenderForm, UploadForm,
} from '@/components/ActionForms';
import { ClientInChargeCell } from '@/components/ClientInChargeCell';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { listMaster } from '@/lib/queries/master';

export const dynamic = 'force-dynamic';
const TABS = [
  { key: 'wait', label: 'รออัปเดต/อัปโหลด' },
  { key: 'done', label: 'อัปเดต/อัปโหลดแล้ว' },
];
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee', 'person'];

export default async function NamCustomerPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['NAMKANG']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';

  const [{ rows, total }, peopleRows] = await Promise.all([
    listJobs({ where: QUEUE.namCustomer(tab as 'wait' | 'done'), search, sortBy, sortDir }),
    listMaster('people'),
  ]);
  const people = peopleRows
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, code: p.code, name: p.name }));

  const done = tab === 'done';

  const columns: Column[] = [
    {
      // อยู่ต้นตารางถัดจากคอลัมน์ No. เพราะเป็นสิ่งแรกที่ NAMKANG ต้องกรอก
      label: 'Client in Charge', searchKey: 'person', kind: 'wrap', className: 'col-client',
      render: (r) => (
        <ClientInChargeCell jobId={r.id} personId={r.personId} people={people} disabled={done} />
      ),
    },
    { label: 'Shipper', searchKey: 'shipper', render: (r) => r.shipperName ?? '-' },
    { label: 'BL No.', searchKey: 'blNo', sortKey: 'blNo', render: (r) => r.blNo ?? '-' },
    { label: 'Consignee', searchKey: 'consignee', render: (r) => r.consigneeName ?? '-' },
    {
      // รับได้ทั้ง PDF · รูป · Excel · Word
      label: 'Invoice สินค้า', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.INVOICE_GOODS;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {r.hasInvoiceAlert ? <span className="badge rejected">เปลี่ยนใหม่</span> : null}
            {/* ยืนยันแล้วล็อกไฟล์ไว้ ต้องขออนุมัติก่อนจึงแก้ได้ */}
            {done ? null : (
              <UploadForm jobId={r.id} category="INVOICE_GOODS"
                label={file ? 'เปลี่ยนไฟล์' : 'อัปโหลด'} requireReason={Boolean(file)} />
            )}
          </div>
        );
      },
    },
    {
      label: 'สถานะ Surrender', kind: 'actions',
      render: (r) => (
        <div className="row-actions">
          {surrenderBadge(r.surrenderStatus)}
          {done ? null : <SurrenderForm jobId={r.id} current={r.surrenderStatus} />}
        </div>
      ),
    },
    {
      label: done ? 'จัดการ' : 'ยืนยันข้อมูล', kind: 'actions',
      render: (r) => {
        // แถบที่ยืนยันแล้วแก้อะไรไม่ได้ เหลือทางเดียวคือขออนุมัติแก้ไข
        if (done) return <RequestEditButton jobId={r.id} />;
        const missing: string[] = [];
        if (!r.personId) missing.push('Client in Charge');
        if (!r.currentFiles?.INVOICE_GOODS) missing.push('Invoice สินค้า');
        if (r.surrenderStatus === 'PENDING') missing.push('สถานะ Surrender');
        return (
          <ConfirmCustomerButton
            jobId={r.id}
            missing={missing}
            confirmed={Boolean(r.customerConfirmedAt)}
          />
        );
      },
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>ใส่ Client in Charge / ติดตาม Invoice สินค้า & Surrender</h1>
        <p>เลือก Client in Charge · อัปโหลด Invoice สินค้า · ระบุสถานะ Surrender BL แล้วกดยืนยันข้อมูล</p>
      </div>
      <Tabs basePath="/nam/customer" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/nam/customer"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={done ? 'ยังไม่มีงานที่ยืนยันข้อมูลแล้ว' : 'ไม่มีงานรออัปเดต'}
        hint="Invoice สินค้ารับได้ทั้ง PDF · รูป · Excel · Word · ครบสามอย่างแล้วจึงกดยืนยันข้อมูลได้"
      />
    </>
  );
}
