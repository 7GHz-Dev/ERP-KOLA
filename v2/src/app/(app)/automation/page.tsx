import { and, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
import { FileChip, Tabs } from '@/components/JobTable';
import { CustomsMonitorBar } from '@/components/CustomsMonitor';
import { formatDate, formatDateTime } from '@/lib/format';
import { netbayStatusLabel, netbayStatusTone } from '@/lib/customs-status';
import { CUSTOMS_WORKER_MODE, DRAFT_WORKER_MODE, onlineWorkers } from '@/lib/worker-status';

export const dynamic = 'force-dynamic';

/*
 * รอสร้างใบขน = FAH กด SEND TO CUSTOMS แล้ว ตัว monitor กำลังเช็กใน NETBAY
 * ใบขนที่เสร็จแล้ว = ACCEPT แล้ว ได้เลขใบขน + PDF งานไปที่ งานคงค้าง > 4. เตรียมเอกสารเดิน E แล้ว
 */
const TABS = [
  { key: 'draft', label: 'รอสร้าง Draft ใบขน' },
  { key: 'customs', label: 'รอสร้างใบขน' },
  { key: 'done', label: 'ใบขนที่เสร็จแล้ว' },
];

function statusBadge(status: string) {
  const tone = status === 'DONE' ? 'approved' : status === 'ERROR' ? 'rejected' : 'pending';
  return <span className={`badge ${tone}`}>{status}</span>;
}

function RefLink({ refNo }: { refNo: string | null | undefined }) {
  if (!refNo) return <>-</>;
  return (
    <a className="badge neutral file-link" href={`kola-netbay://open?ref=${encodeURIComponent(refNo)}`}
      title="เปิดใบขนนี้ใน NETBAY (ต้องติดตั้งตัวเปิดของ ERP-KOLA ในเครื่อง)">
      {refNo} ↗
    </a>
  );
}

export default async function AutomationPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['PAINT', 'FAH']);
  const params = await searchParams;
  const raw = typeof params.tab === 'string' ? params.tab : '';
  const tab = TABS.some((t) => t.key === raw) ? raw : 'draft';
  const type = tab === 'draft' ? 'DRAFT_ENTRY' : 'CUSTOMS_ENTRY';

  const rows = await db
    .select({
      id: automationTasks.id,
      status: automationTasks.status,
      payload: automationTasks.payload,
      inputFileName: automationTasks.inputFileName,
      resultRefNo: automationTasks.resultRefNo,
      resultEntryNo: automationTasks.resultEntryNo,
      resultFileName: automationTasks.resultFileName,
      externalStatus: automationTasks.externalStatus,
      checkedAt: automationTasks.checkedAt,
      error: automationTasks.error,
      attempts: automationTasks.attempts,
      claimedBy: automationTasks.claimedBy,
      createdAt: automationTasks.createdAt,
      completedAt: automationTasks.completedAt,
      jobId: jobs.id,
      jobNo: jobs.jobNo,
      draftRefNo: jobs.draftRefNo,
      // ไฟล์ใบขนปัจจุบันของงาน — เปิดดูได้จากแท็บใบขนที่เสร็จแล้ว
      entryFileId: sql<string | null>`(select f.id from files f where f.job_id = ${jobs.id}
        and f.category = 'CUSTOMS_ENTRY_DOC' and f.is_current = true limit 1)`,
    })
    .from(automationTasks)
    .leftJoin(jobs, eq(jobs.id, automationTasks.jobId))
    .where(and(
      eq(automationTasks.type, type),
      // งานที่คืน FAH (ใบขนถูกยกเลิก) แสดงต่ออีก 7 วันให้เห็นว่าหายไปไหน แล้วค่อยหลุดจากแท็บ
      tab === 'customs' ? and(ne(automationTasks.status, 'DONE'),
        or(ne(automationTasks.status, 'ERROR'), gt(automationTasks.updatedAt, sql`now() - interval '7 days'`)))
        : tab === 'done' ? eq(automationTasks.status, 'DONE') : undefined,
    ))
    .orderBy(tab === 'done' ? desc(automationTasks.completedAt) : desc(automationTasks.createdAt))
    .limit(100);

  const pending = rows.filter((r) => r.status === 'QUEUED' || r.status === 'PROCESSING').length;
  const [drafters, monitors] = await Promise.all([
    tab === 'draft' ? onlineWorkers({ mode: DRAFT_WORKER_MODE }) : Promise.resolve([]),
    tab === 'customs' ? onlineWorkers({ mode: CUSTOMS_WORKER_MODE }) : Promise.resolve([]),
  ]);

  const payloadRef = (payload: string | null) => {
    try { return (JSON.parse(payload ?? '{}') as { refNo?: string }).refNo ?? null; } catch { return null; }
  };

  return (
    <>
      <div className="page-head">
        <h1>คิวงาน Automation</h1>
        <p>งานที่รอโปรแกรม automate ประมวลผล{tab === 'done' ? '' : ` · ค้างอยู่ ${pending} รายการ`}</p>
      </div>

      <Tabs basePath="/automation" items={TABS} active={tab} />

      {tab === 'draft' ? (
        <div className="notice">
          งานในแถบนี้ทำโดย worker สร้าง Draft (npm run worker:draft) บนเครื่องที่เปิด NETBAY ได้
          — ตรวจ Final Invoice ออกเลขเครื่อง สร้างใบขน และ Import CSV ให้ (ไม่กด Save) ·{' '}
          {drafters.length
            ? <b>worker ออนไลน์ · {drafters[0].busy ?? 'ว่าง รอรับงาน'}</b>
            : <b>worker ออฟไลน์ — งานจะรอในคิวจนกว่าจะเปิด worker (ปุ่มเปิดอยู่ที่แท็บ Draft ใบขน)</b>}
          {' '}· ทำซ้ำหรือแก้ไฟล์แล้วสร้างใหม่ ให้กด &quot;สร้าง Draft&quot; ที่หน้างานคงค้าง
        </div>
      ) : tab === 'customs' ? (
        <>
          <div className="notice">
            FAH กด SEND TO CUSTOMS ใน NETBAY แล้วกด &quot;สร้างใบขนแล้ว&quot; — ตัว monitor บนเครื่องที่กดล่าสุด
            เช็กสถานะใน NETBAY ทุก 5 นาที · <b>ACCEPT</b> แล้วดึงเลขใบขน + PDF ให้ งานย้ายไปแท็บใบขนที่เสร็จแล้ว
            และ งานคงค้าง → 4. เตรียมเอกสารเดิน E · สถานะแดง (Reject ฯลฯ) ให้แก้ใน NETBAY แล้วส่งใหม่ ระบบเช็กต่อเอง
            · ใบขนที่ถูกยกเลิกคืนไปแท็บตรวจ Draft ของ FAH · ACCEPT ครบทุกรายการแล้วตัว monitor ปิดตัวเอง
          </div>
          <CustomsMonitorBar initial={monitors} pending={pending} />
        </>
      ) : null}

      <div className="table-wrap">
        <table className="data">
          {tab === 'draft' ? (
            <>
              <thead>
                <tr>
                  <th className="col-no">No.</th><th>เวลา</th><th>Job No.</th><th>ไฟล์ Final Invoice</th>
                  <th>สถานะ</th><th>Ref No.</th><th>ครั้งที่</th><th>ทำโดย</th><th>ข้อผิดพลาด</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="empty" colSpan={9}>ยังไม่มีงานในแถบนี้</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>{r.jobNo ?? '-'}</td>
                    <td>{r.inputFileName ?? '-'}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td><b>{r.resultRefNo || '-'}</b></td>
                    <td>{r.attempts}</td>
                    <td>{r.claimedBy ?? '-'}</td>
                    <td>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : tab === 'customs' ? (
            <>
              <thead>
                <tr>
                  <th className="col-no">No.</th><th>เวลาที่กด</th><th>Job No.</th><th>Ref No.</th>
                  <th>สถานะใน NETBAY</th><th>เช็กล่าสุด</th><th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="empty" colSpan={7}>ไม่มีใบขนรอ ACCEPT</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{r.jobId ? <a href={`/job/${r.jobId}`}>{r.jobNo}</a> : '-'}</td>
                    <td><RefLink refNo={r.draftRefNo ?? payloadRef(r.payload)} /></td>
                    <td>
                      {r.status === 'ERROR'
                        ? <span className="badge rejected">คืน FAH แล้ว</span>
                        : <span className={`badge ${netbayStatusTone(r.externalStatus)}`}>{netbayStatusLabel(r.externalStatus)}</span>}
                    </td>
                    <td>{r.checkedAt ? formatDateTime(r.checkedAt) : '-'}</td>
                    <td>{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  <th className="col-no">No.</th><th>ACCEPT เมื่อ</th><th>Job No.</th><th>Ref No.</th>
                  <th>Customs No.</th><th>ไฟล์ใบขนสินค้า</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>ยังไม่มีใบขนที่เสร็จ</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{formatDateTime(r.completedAt)}</td>
                    <td>{r.jobId ? <a href={`/job/${r.jobId}`}>{r.jobNo}</a> : '-'}</td>
                    <td><RefLink refNo={r.draftRefNo ?? payloadRef(r.payload)} /></td>
                    <td><b>{r.resultEntryNo || '-'}</b></td>
                    <td>
                      {r.entryFileId
                        ? <FileChip file={{ id: r.entryFileId, fileName: r.resultFileName ?? `${r.resultEntryNo}.pdf` }} />
                        : (r.error ?? '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
    </>
  );
}
