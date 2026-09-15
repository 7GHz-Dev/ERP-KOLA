import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable } from '@/components/JobTable';
import { ApproveReject } from '@/components/ActionForms';
import { ExportTemplateButton } from '@/components/ExportTemplateButton';
import { BulkBar, PickAllBox, PickBox } from '@/components/BulkBar';
import { decideApprovalMany } from '@/lib/actions/jobs';
import Link from 'next/link';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee', 'vessel'];

export default async function NamApprovePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['NAMKANG']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.namApprove(), search, sortBy, sortDir });

  return (
    <>
      {/*
        ปุ่ม Export อยู่หน้านี้เพราะ NAMKANG เป็นคนอนุมัติเข้าตารางหลัก
        อนุมัติเสร็จแล้วส่งตารางต่อได้เลยในหน้าเดียวกัน ไม่ต้องเปลี่ยนหน้า
      */}
      <div className="page-head with-action">
        <div>
          <h1>อนุมัติข้อมูล BL เข้าตารางหลัก</h1>
          <p>ตรวจข้อมูล BL ที่ PAINT ส่งมา · อนุมัติแล้ว Export ตารางงานได้ที่ปุ่มขวา</p>
        </div>
        <ExportTemplateButton label="Export ตารางงาน (อนุมัติแล้ว)" />
      </div>
      {/*
        เลือกหลายรายการแล้วอนุมัติทีเดียว — ช่วงเรือเข้าพร้อมกันหลายลำมีรออนุมัติทีละสิบใบ
        ตรวจไฟล์ก่อนได้ที่ปุ่ม "ดูเอกสาร" ซึ่งเปิดแผงไฟล์ AN/BL คู่กับข้อมูลที่กรอกไว้
      */}
      <BulkBar
        action={decideApprovalMany}
        idName="approvalIds"
        label="อนุมัติ {n} รายการ"
        confirmText="อนุมัติ {n} รายการเข้าตารางหลักใช่ไหม"
      >
        <JobTable
          basePath="/nam/approve"
          columns={[
            {
              label: '', kind: 'actions', className: 'col-pick',
              header: <PickAllBox />,
              // ติ๊กด้วย id ของรายการอนุมัติ ไม่ใช่ id งาน เพราะตรรกะอนุมัติยึดจากตรงนั้น
              render: (r) => (r.anId ? <PickBox id={r.anId} /> : null),
            },
            col.shipper(), col.blNo(), col.vessel(), col.eta(), col.consignee(),
            { label: 'DEM', align: 'right', sortKey: 'demDays', render: (r) => r.demDays },
            { label: 'DET', align: 'right', sortKey: 'detDays', render: (r) => r.detDays },
            {
              label: 'จัดการ', kind: 'actions',
              render: (r) => (
                <div className="row-actions">
                  <Link className="button tiny" href={`/bl-review/${r.id}`}>ดูเอกสาร</Link>
                  {r.anId ? <ApproveReject approvalId={r.anId} /> : null}
                </div>
              ),
            },
          ]}
          rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
          empty="ไม่มีรายการรออนุมัติ"
          hint="ติ๊กเลือกหลายรายการแล้วกดอนุมัติทีเดียวได้ · กด ดูเอกสาร เพื่อตรวจไฟล์ AN/BL คู่กับข้อมูลที่กรอก"
        />
      </BulkBar>
    </>
  );
}
