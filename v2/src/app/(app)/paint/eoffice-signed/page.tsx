import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RequestEditButton, SendEofficeButton, UndoHandoverButton, UploadForm } from '@/components/ActionForms';
import { formatDateTime } from '@/lib/format';
import { listJobs, QUEUE } from '@/lib/queries/jobs';
import { listMaster } from '@/lib/queries/master';
import { isPartnerRelease } from '@/lib/job-types';
import { isShipmePartner, parseEmails } from '@/lib/partner-message';

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

  const [{ rows, total }, partnerRows] = await Promise.all([
    listJobs({ where: QUEUE.eofficeSigned(tab as 'wait' | 'sent'), search, sortBy, sortDir }),
    listMaster('partners'),
  ]);
  const sent = tab === 'sent';
  /*
   * ช่องทางที่ผูกไว้กับ Partner ของแต่ละงาน (Master Data → Port Release Partner)
   * กดส่ง Partner แล้วชุดปล่อยที่เซ็นแล้วออกไปทางนี้ทันที — บอกไว้ในแถวให้รู้ก่อนกด
   */
  const channelsOf = (name: string | null) => {
    // SHIPME ส่งผ่าน ERP SHIPME (เชื่อมภายหลัง) — ยังไม่มีอะไรออกไปตอนกดส่ง
    if (isShipmePartner(name)) return [];
    const p = partnerRows.find((x) => x.name.trim().toUpperCase() === (name ?? '').trim().toUpperCase());
    return [
      parseEmails(p?.email).length ? 'Email' : null,
      p?.lineGroupId ? 'LINE' : null,
    ].filter((v): v is string => Boolean(v));
  };

  const columns: Column[] = [
    {
      // เวลาที่ PAINT กดส่งมอบคนเดินเอกสารที่แท็บ 4 — ใช้ดูว่าชุดไหนออกไปนานแล้วยังไม่กลับ
      label: 'ส่งมอบคนเดินเอกสาร', kind: 'wrap',
      render: (r) => (r.eofficeHandoverAt ? formatDateTime(r.eofficeHandoverAt) : '-'),
    },
    col.clientInCharge(), col.shipper(), col.blNo(), col.refNo(),
    col.declarationNo(), col.consignee(),
    {
      label: 'Port Release Partner', kind: 'wrap',
      render: (r) => {
        const channels = channelsOf(r.releasePartner);
        return (
          <span className="chip-row">
            <span>{r.releasePartner ?? '-'}</span>
            {isPartnerRelease(r.jobTypeCode) ? <span className="badge neutral">MUO</span> : null}
            {channels.map((c) => <span key={c} className="badge approved">{c}</span>)}
            {isShipmePartner(r.releasePartner) ? <span className="badge neutral">ERP SHIPME (เชื่อมภายหลัง)</span> : null}
          </span>
        );
      },
    },
    {
      // ชุดที่รวมไว้แล้ว เอาไว้ให้โหลดไปเดินพิธีการ
      label: 'ชุด E-Office รวม', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.EOFFICE_MERGED} />
        </div>
      ),
    },
    {
      label: 'ชุดปล่อย (เซ็นแล้ว)', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.EOFFICE_SIGNED;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {/* ส่ง Partner แล้วล็อกไฟล์ไว้ ต้องขออนุมัติก่อนจึงแก้ได้ */}
            {sent || file ? null : (
              <UploadForm jobId={r.id} category="EOFFICE_SIGNED" label="อัปโหลด" />
            )}
          </div>
        );
      },
    },
    {
      label: 'จัดการ', kind: 'actions',
      // ส่งแล้วแก้เองไม่ได้ ต้องขออนุมัติก่อน · ยังไม่ส่งและมีไฟล์แล้วจึงกดส่งได้
      render: (r) =>
        (sent
          ? <RequestEditButton jobId={r.id} />
          : r.currentFiles?.EOFFICE_SIGNED
            ? <SendEofficeButton jobId={r.id} ready partner={r.releasePartner} channels={channelsOf(r.releasePartner)} />
            : r.eofficeHandoverAt
              ? <UndoHandoverButton jobId={r.id} />
              : null),
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Upload ชุดปล่อย E-Office / ส่ง Partner</h1>
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
