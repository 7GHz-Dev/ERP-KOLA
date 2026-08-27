import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { runTaskSimulation } from '@/lib/actions/automation';
import { SubmitButton } from '@/components/ActionForms';
import { Tabs } from '@/components/JobTable';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'draft', label: 'รอสร้าง Draft ใบขน' },
  { key: 'customs', label: 'รอสร้างใบขน' },
];

function statusBadge(status: string) {
  const tone = status === 'DONE' ? 'approved' : status === 'ERROR' ? 'rejected' : 'pending';
  return <span className={`badge ${tone}`}>{status}</span>;
}

export default async function AutomationPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['PAINT', 'FAH']);
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
      error: automationTasks.error,
      attempts: automationTasks.attempts,
      createdAt: automationTasks.createdAt,
      jobNo: jobs.jobNo,
    })
    .from(automationTasks)
    .leftJoin(jobs, eq(jobs.id, automationTasks.jobId))
    .where(eq(automationTasks.type, type))
    .orderBy(desc(automationTasks.createdAt))
    .limit(100);

  const pending = rows.filter((r) => r.status === 'QUEUED' || r.status === 'PROCESSING').length;

  return (
    <>
      <div className="page-head">
        <h1>คิวงาน Automation</h1>
        <p>งานที่รอโปรแกรม automate ประมวลผล · ค้างอยู่ {pending} รายการ</p>
      </div>

      <Tabs basePath="/automation" items={TABS} active={tab} />

      <div className="notice">
        ปุ่ม &quot;เริ่มสร้าง&quot; เป็นตัวจำลองไว้ทดสอบทั้งเส้นก่อนโปรแกรม Python จะพร้อม
        ผลลัพธ์ออกมาในรูปแบบเดียวกับที่ worker ตัวจริงจะส่ง
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-no">No.</th>
              <th>เวลา</th>
              <th>Job No.</th>
              <th>{tab === 'draft' ? 'ไฟล์ Final Invoice' : 'Ref No. ที่ส่งมา'}</th>
              <th>สถานะ</th>
              <th>{tab === 'draft' ? 'Ref No.' : 'เลขใบขน'}</th>
              {tab === 'customs' ? <th>ไฟล์ผล</th> : null}
              <th>ครั้งที่</th>
              <th>ข้อผิดพลาด</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="empty" colSpan={tab === 'customs' ? 10 : 9}>ยังไม่มีงานในแถบนี้</td></tr>
            ) : rows.map((r, i) => {
              let data: { refNo?: string } = {};
              try { data = JSON.parse(r.payload ?? '{}'); } catch { data = {}; }
              const canStart = r.status === 'QUEUED' || r.status === 'ERROR';
              return (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{r.jobNo ?? '-'}</td>
                  <td>{tab === 'draft' ? (r.inputFileName ?? '-') : (data.refNo ?? '-')}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td><b>{(tab === 'draft' ? r.resultRefNo : r.resultEntryNo) || '-'}</b></td>
                  {tab === 'customs' ? <td>{r.resultFileName ?? '-'}</td> : null}
                  <td>{r.attempts}</td>
                  <td>{r.error ?? ''}</td>
                  <td>
                    {canStart ? (
                      <form action={runTaskSimulation} className="inline-form">
                        <input type="hidden" name="taskId" value={r.id} />
                        <SubmitButton label="เริ่มสร้าง" tone="ok" />
                      </form>
                    ) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
