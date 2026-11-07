import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { FileChip, JobTable } from '@/components/JobTable';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'vessel'];

/**
 * Waiting list (Senior / Head Officer) — งานที่เพิ่มจาก BL ก่อน Arrival Notice จากสายเรือมา
 *
 * ตารางแบบแท็บ "งานใส่ข้อมูล BL" ของ Pending jobs แต่เฉพาะงานที่ที่มาเป็น BL และยังไม่เข้าตารางหลัก
 * ปุ่ม "+ เพิ่ม Job" พาไปหน้า BL Waiting Confirm (รับงานจาก BL) เดิม
 * พอ AN มาถึง Import Officer แนบไฟล์และส่งอนุมัติ — Head Officer อนุมัติแล้วงานหายจากรายการนี้
 */
export default async function WaitingListPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['FAH', 'NAMKANG']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.waitingList(), search, sortBy, sortDir });

  return (
    <>
      <div className="page-head with-action">
        <div>
          <h1>Waiting list</h1>
          <p>งานที่เพิ่มจาก BL รอ Arrival Notice จากสายเรือ · ยังไม่เข้าตารางหลัก (AN ยังไม่ผ่าน)</p>
        </div>
        <Link className="button primary" href="/intake/bl">+ เพิ่ม Job</Link>
      </div>

      <JobTable
        basePath="/waiting-list"
        columns={[
          col.createdAt(), col.clientInCharge(), col.shipper(), col.blNo(), col.consignee(), col.vessel(),
          col.eta(), col.demDet(),
          { label: 'ตู้', align: 'center', render: (r) => r.containerCount || '-' },
          { label: 'ไฟล์ BL', kind: 'wrap', className: 'col-file', render: (r) => <FileChip file={r.currentFiles?.BL} /> },
          {
            label: 'Arrival Notice', kind: 'wrap', className: 'col-file',
            render: (r) => (r.currentFiles?.ARRIVAL_NOTICE
              ? <FileChip file={r.currentFiles.ARRIVAL_NOTICE} />
              : <span className="badge pending">ยังไม่มี AN</span>),
          },
          col.anStatus(),
        ]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ไม่มีงานที่รอ Arrival Notice"
      />
    </>
  );
}
