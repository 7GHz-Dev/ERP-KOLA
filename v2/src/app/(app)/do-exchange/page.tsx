import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import {
  MergeEofficeButton, SendDoExchangedButton, UploadForm,
} from '@/components/ActionForms';
import { DoLetterButton } from '@/components/DoLetterButton';
import { formatDateTime } from '@/lib/format';
import { matchShippingLine } from '@/lib/do-letter';
import { doQueueArrivalDates, listJobs, QUEUE } from '@/lib/queries/jobs';
import { QueueFilter } from '@/components/VesselFilter';
import { DoBundleSelection, DoBundleCheckbox } from '@/components/DoBundleSelection';
import { DoAttachments } from '@/components/DoAttachments';
import { doAttachmentsFor } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'wait', label: 'รอทำชุดแลก' },
  { key: 'sent', label: 'ส่งแลก DO แล้ว' },
];
const SEARCH_KEYS = ['blNo', 'consignee', 'refNo', 'arrivedOn'];

export default async function DoExchangePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ANN']);
  const params = readParams(await searchParams, SEARCH_KEYS);
  const { one, search, carry } = params;
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';
  const sent = tab === 'sent';
  /*
   * ค่าตั้งต้นเรียงตามเวลาที่รายการส่งเข้ามา ใหม่สุดอยู่บน
   * ฝั่งที่ส่งแลกแล้วเรียงตามเวลาที่กดส่ง เพราะเป็นลำดับที่ใช้ตามงานย้อนหลัง
   */
  const sortBy = params.sortBy ?? (sent ? 'doExchangedAt' : 'arrivedAt');
  const sortDir = params.sortDir;

  const [{ rows, total }, arrivalDates] = await Promise.all([
    listJobs({
      where: QUEUE.doExchange(tab as 'wait' | 'sent'),
      search, sortBy, sortDir,
    }),
    /*
     * ตัวเลือกวันตามแท็บที่เปิดอยู่
     * แท็บรอทำ = วันที่ยังเหลืองาน · แท็บส่งแลกแล้ว = วันที่เคยส่งไปแล้ว
     */
    doQueueArrivalDates(sent ? 'sent' : 'wait'),
  ]);
  // สลิปกับเอกสารมีหลายใบต่องาน ดึงแยกเพราะ currentFiles เก็บได้ใบเดียวต่อหมวด
  const attachments = await doAttachmentsFor(rows.map((r) => r.id));

  const columns: Column[] = [
    {
      // เวลาที่ PAINT หรือ FAH กดส่งรายการมาให้ ANN — ใช้ดูว่าค้างมานานแค่ไหน
      label: 'วันที่ส่งรายการมา', sortKey: 'arrivedAt', kind: 'wrap',
      render: (r) => formatDateTime(r.arrivedAt),
    },
    // ANN ดูจากวันเรือเข้ากับวันสุดท้ายของ DEM ว่าใบไหนต้องแลกก่อน จึงวางไว้ต้นแถว
    col.eta(), col.lastDem(),
    col.blNo(), col.consignee(),
    {
      // สายเรือมาจาก SHIPLINE ของงาน ไม่ต้องเลือกซ้ำที่นี่
      label: 'SHIPLINE', kind: 'wrap', className: 'col-shipline',
      render: (r) => {
        const matched = matchShippingLine(r.shipline);
        return (
          <div className="shipline-cell">
            <b>{r.shipline ?? '-'}</b>
            {r.shipline && !matched ? (
              <small className="client-cell-note bad">ยังไม่มีแบบฟอร์ม</small>
            ) : null}
          </div>
        );
      },
    },
    // ท่าที่ต้องไปรับ DO จริง อยู่ติดสายเรือเพราะใช้คู่กันตอนวางแผนเดินเอกสาร
    col.terminal(),
    {
      label: 'จดหมายแลก DO', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.DO_LETTER} />
          {/* ฉบับประทับตราเป็นคนละไฟล์ จึงต้องเห็นคู่กันว่ามีอันไหนแล้วบ้าง */}
          <FileChip file={r.currentFiles?.DO_LETTER_SIGNED} />
          {r.currentFiles?.DO_LETTER_UPLOADED ? <FileChip file={r.currentFiles.DO_LETTER_UPLOADED} /> : null}
          <DoLetterButton
            jobId={r.id}
            ready={Boolean(matchShippingLine(r.shipline))}
            done={Boolean(r.currentFiles?.DO_LETTER)}
            signedDone={Boolean(r.currentFiles?.DO_LETTER_SIGNED)}
          />
          {/* สายเรือที่ยังไม่มีแบบฟอร์ม หรือจดหมายที่ทำมาจากข้างนอก ก็แนบเข้ามาเองได้ */}
          <UploadForm
            jobId={r.id}
            category="DO_LETTER_UPLOADED"
            label="อัปโหลดเอง"
            stayHere
          />
        </div>
      ),
    },
    {
      label: 'Invoice DO', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.INVOICE_DO} />
        </div>
      ),
    },
    {
      /*
       * Slip หลายใบต่องาน แต่ละใบมีหัวข้อ — ค่า DO เป็นหลัก เพิ่มมัดจำตู้ · DEM · DET · ล่าช้าได้
       * อัปเสร็จแล้วเปิดแผงเทียบยอดกับ Invoice DO ให้เลย
       * ส่งแลกแล้วเหลือไว้ดูอย่างเดียว เพราะชุดที่ส่งไปรวมใบเหล่านี้ไว้แล้ว
       */
      label: 'Slip โอนเงิน', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <DoAttachments
          jobId={r.id}
          kind="slip"
          files={attachments.get(r.id)?.slips ?? []}
          canEdit={!sent}
          thenOpen={`/do-exchange/${r.id}`}
        />
      ),
    },
    {
      // Invoice มัดจำตู้ · DEM · DET · DO ล่าช้า และอื่น ๆ — เพิ่มได้หลายหัวข้อ
      label: 'เอกสารอื่น ๆ', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <DoAttachments
          jobId={r.id}
          kind="doc"
          files={attachments.get(r.id)?.docs ?? []}
          canEdit={!sent}
        />
      ),
    },
    {
      // สายเรือแต่ละเจ้ารับคนละแบบ จึงให้เลือกเองว่าจะรวมด้วยจดหมายฉบับไหน
      label: 'รวมชุดแลก DO', kind: 'actions',
      render: (r) => (
        <div className="row-actions do-bundle-actions">
          <FileChip file={r.currentFiles?.DO_MERGED} />
          {/* ส่งแลกไปแล้วเหลือไว้ให้โหลดดูอย่างเดียว รวมชุดใหม่ทับของที่ส่งไปแล้วไม่ได้ */}
          {sent ? null : (
            <>
              <MergeEofficeButton jobId={r.id} kind="do" />
              <MergeEofficeButton jobId={r.id} kind="doPlain" />
              <MergeEofficeButton jobId={r.id} kind="doUploaded" />
            </>
          )}
        </div>
      ),
    },
    sent
      ? {
          // ฝั่งที่ส่งแล้วดูได้อย่างเดียวว่าส่งไปเมื่อไหร่
          label: 'ส่งแลกเมื่อ', sortKey: 'doExchangedAt', kind: 'wrap',
          render: (r) => formatDateTime(r.doExchangedAt),
        }
      : {
          // รวมชุดแล้วจึงกดส่งได้ ในแถวเดียวกับที่เพิ่งรวมชุดเสร็จ
          label: 'จัดการ', kind: 'actions',
          render: (r) => (
            <SendDoExchangedButton jobId={r.id} ready={Boolean(r.currentFiles?.DO_MERGED)} />
          ),
        },
  ];
  if (!sent) columns.unshift({ label: 'เลือก', render: r => <DoBundleCheckbox id={r.id} label={r.blNo ?? r.jobNo} /> });

  return (
    <>
      <div className="page-head">
        <h1>จัดการแลก DO</h1>
        <p>
          งานที่ส่ง Partner แล้วจะเข้ามาที่นี่ · สายเรือใช้ SHIPLINE ของงาน ·
          ออกจดหมาย · อัปโหลด Slip · รวมเป็นชุดเดียว แล้วกดส่งแลก DO
        </p>
      </div>
      <Tabs basePath="/do-exchange" items={TABS} active={tab} carry={carry} />

      {/*
        กรองทั้งตารางด้วยวันที่รายการส่งเข้ามา — เลือกจากวันที่ยังมีงานค้างจริง
        อยู่เหนือตารางเพราะกรองทั้งหน้า ไม่ใช่ค้นเฉพาะคอลัมน์เดียวแบบช่องในหัวตาราง
      */}
      <QueueFilter
        options={arrivalDates}
        value={one('arrivedOn')}
        basePath="/do-exchange"
        carry={{ ...carry, tab }}
        paramKey="arrivedOn"
        label="วันที่ส่งรายการมา"
        unitLabel="ใบ"
        groupLabel="วัน"
        emptyNote={sent ? 'ยังไม่มีงานที่ส่งแลก DO แล้ว' : 'ไม่มีงานค้างรอแลก DO'}
      />
      <DoBundleSelection key={`${tab}:${JSON.stringify(search)}`} ids={rows.map(row => row.id)} readyIds={rows.filter(row => row.currentFiles?.DO_MERGED).map(row => row.id)} enabled={!sent}>
      <JobTable
        basePath="/do-exchange"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={sent ? 'ยังไม่มีงานที่ส่งแลก DO แล้ว' : 'ยังไม่มีงานที่ต้องแลก DO'}
        hint={sent
          ? 'รายการที่ส่งแลกไปแล้ว · ไฟล์ทั้งหมดยังโหลดดูย้อนหลังได้'
          : 'แบบฟอร์มจดหมายแต่ละสายเรือตั้งได้ที่ Master Data → ฟอร์มจดหมายแลก DO · รวมชุดแล้วกด "ส่งแลก DO แล้ว" เพื่อย้ายไปแท็บถัดไป'}
      />
      </DoBundleSelection>
    </>
  );
}
