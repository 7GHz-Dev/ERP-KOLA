import { requireUserReady } from '@/lib/auth';
import { readParams } from '@/lib/columns';
import { JobTable, Tabs } from '@/components/JobTable';
import { signedColumns } from '@/components/SignedColumns';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'Upload ชุดปล่อย / ส่ง Partner' },
  { key: 'sent', label: 'ส่ง Partner แล้ว' },
];
const SEARCH_KEYS = ['person', 'shipper', 'blNo', 'consignee', 'refNo', 'entryNo'];

export default async function PaintEofficeSignedPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['PAINT']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';

  const { rows, total } = await listJobs({ where: QUEUE.eofficeSigned(tab as 'wait' | 'sent'), search, sortBy, sortDir });
  const sent = tab === 'sent';
  const columns = await signedColumns(sent);

  return (
    <>
      <div className="page-head">
        <h1>Submit (Signed) E-office Doc</h1>
        <p>
          รายการมาจาก งานคงค้าง → 4. เตรียมเอกสารเดิน E หลังกด &quot;ส่งมอบคนเดินเอกสาร&quot; ·
          สแกนชุดที่เซ็นแล้วอัปโหลดให้ตรงรายการ แล้วกดส่ง Partner
        </p>
      </div>
      <Tabs basePath="/paint/eoffice-signed" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/paint/eoffice-signed"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={sent ? 'ยังไม่มีงานที่ส่ง Partner แล้ว' : 'ไม่มีงานรออัปโหลดชุดปล่อย — ส่งมอบคนเดินเอกสารจากแท็บ 4 ก่อน'}
        hint="อัปโหลดแล้วกดส่ง Partner ได้ในแถวเดียวกัน · Partner ที่ผูก Email/LINE ไว้ได้รับไฟล์ที่เซ็นแล้วทันที · ส่งแล้วรายการไปที่ NAMKANG → จัดการลากตู้สินค้า (ยกเว้นงาน MUO ที่ Partner ลากเอง)"
      />
    </>
  );
}
