import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';
import { col, readParams } from '@/lib/columns';
import { formatDateTime } from '@/lib/format';
import { AutoRefresh } from '@/components/AutoRefresh';
import { JobTable, type Column } from '@/components/JobTable';
import { listJobs } from '@/lib/queries/jobs';
import { dashboardSummary } from '@/lib/queries/dashboard';
import {
  OWNERS, STAGES, overviewStats, stageByKey, viewCondition, type StageStat,
} from '@/lib/queries/overview';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['jobNo', 'blNo', 'person', 'shipper', 'consignee', 'vessel'];

const ownerColor = (owner: string) => OWNERS.find((o) => o.key === owner)?.color ?? '#697784';

/** "12 งาน · 20 ตู้" — ตู้แสดงเฉพาะเมื่อมี เพราะงานที่ยังไม่ได้ใส่ตู้มีอยู่จริง */
function StatLine({ stat }: { stat: StageStat }) {
  return (
    <small>
      งาน{stat.containers ? ` · ${stat.containers} ตู้` : ''}
    </small>
  );
}

export default async function OverviewPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  /*
   * ภาพรวมงานเป็นมุมของฝั่ง KOLA ที่ดูแลงานทั้งระบบ
   * ANN · MAY · ACCOUNT ไม่มีเมนูนี้อยู่แล้ว ถ้าเผลอเปิด URL ตรงก็พากลับหน้างานตัวเอง
   */
  const user = await requireUserReady();
  const home = homePageFor(user.role);
  if (home !== '/overview') redirect(home);

  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  // มุมที่เลือก: ขั้นใดขั้นหนึ่ง · ทั้งแผนก (PAINT / FAH) · ว่าง = ทุกงานที่ค้าง
  const rawView = one('view');
  const view = stageByKey(rawView) || rawView === 'PAINT' || rawView === 'FAH' ? rawView : '';
  if (view) carry.view = view;
  const stage = stageByKey(view);

  const [stats, summary, { rows, total }] = await Promise.all([
    overviewStats(),
    dashboardSummary(),
    listJobs({ where: viewCondition(view), search, sortBy: sortBy ?? 'eta', sortDir: sortBy ? sortDir : 'asc' }),
  ]);

  // ลิงก์เปลี่ยนมุม — คงคำค้นไว้ แต่เปลี่ยน view
  const viewHref = (next: string) => {
    const params = new URLSearchParams({ ...carry });
    if (next) params.set('view', next); else params.delete('view');
    const q = params.toString();
    return q ? `/overview?${q}` : '/overview';
  };

  const columns: Column[] = [
    {
      label: 'ค้างที่', kind: 'wrap', className: 'col-stuck',
      render: (r) => (
        <div className="ov-tags">
          {(stats.stagesOf.get(r.id) ?? []).map((key) => {
            const s = stageByKey(key);
            if (!s) return null;
            return (
              <span
                key={key}
                className={`ov-tag${s.passive ? ' passive' : ''}`}
                style={{ '--owner': ownerColor(s.owner) } as React.CSSProperties}
                title={s.hint}
              >
                <b>{s.owner}</b> {s.label}
              </span>
            );
          })}
        </div>
      ),
    },
    col.jobNo(), col.blNo(), col.clientInCharge(), col.shipper(), col.consignee(), col.vessel(), col.eta(),
    { label: 'ตู้', align: 'center', render: (r) => r.containerCount || '-' },
  ];

  const viewLabel = stage
    ? `${stage.owner} · ${stage.label}`
    : view ? `ค้างที่ ${view} ทุกขั้น` : 'งานค้างทั้งหมด (PAINT + FAH)';

  return (
    <>
      {/* ตัวเลขเปลี่ยนตามที่คนอื่นทำงาน — ดึงใหม่ทุกนาที (ไม่รีเฟรชระหว่างพิมพ์ค้นหา) */}
      <AutoRefresh active seconds={60} />

      <div className="page-head with-action">
        <div>
          <h1>ภาพรวมงาน</h1>
          <p>งานที่ค้างอยู่ที่ PAINT และ FAH แยกตามขั้น · กดที่ขั้นเพื่อดูรายการงาน</p>
        </div>
        <span className="ov-updated">อัปเดต {formatDateTime(new Date())}</span>
      </div>

      <div className="ov-boards">
        {OWNERS.map((owner) => {
          const ownerStat = stats.owners[owner.key];
          const steps = STAGES.filter((s) => s.owner === owner.key);
          let no = 0;
          return (
            <section
              key={owner.key}
              className="ov-board"
              style={{ '--owner': owner.color } as React.CSSProperties}
              aria-label={`งานค้างที่ ${owner.label}`}
            >
              <Link
                className={`ov-board-head${view === owner.key ? ' on' : ''}`}
                href={viewHref(view === owner.key ? '' : owner.key)}
                prefetch={false}
              >
                <span className="ov-owner"><i />{owner.label}</span>
                <span className="ov-total">
                  <b>{ownerStat.jobs}</b>
                  <StatLine stat={ownerStat} />
                </span>
                {ownerStat.overdue ? <span className="ov-late">เลย ETA {ownerStat.overdue}</span> : null}
              </Link>

              <ol className="ov-steps">
                {steps.map((s) => {
                  const stat = stats.stages[s.key];
                  if (!s.passive) no += 1;
                  const on = view === s.key;
                  return (
                    <li key={s.key}>
                      <Link
                        className={['ov-step', stat.jobs ? null : 'zero', s.passive ? 'passive' : null, on ? 'on' : null]
                          .filter(Boolean).join(' ')}
                        href={viewHref(on ? '' : s.key)}
                        prefetch={false}
                        aria-current={on ? 'true' : undefined}
                      >
                        <span className="ov-step-no">{s.passive ? '⏳' : no}</span>
                        <span className="ov-step-text">
                          <b>{s.label}</b>
                          <small>{s.hint}</small>
                        </span>
                        <span className="ov-step-count">
                          {stat.jobs ? (
                            <>
                              <b>{stat.jobs}</b>
                              <StatLine stat={stat} />
                              {stat.overdue ? <span className="ov-late">เลย ETA {stat.overdue}</span> : null}
                            </>
                          ) : (
                            <span className="ov-clear">✓ ไม่มีค้าง</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              {steps.some((s) => s.passive) ? (
                <p className="ov-note">⏳ = รอระบบ ไม่นับรวมเป็นงานค้างของ {owner.label}</p>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="filter-bar">
        <span className="filter-label">แสดง</span>
        <div className="chip-group">
          {[
            { key: '', label: `ทั้งหมด ${stats.all.jobs}` },
            ...OWNERS.map((o) => ({ key: o.key, label: `${o.label} ${stats.owners[o.key].jobs}` })),
          ].map((c) => (
            <Link
              key={c.key || 'all'}
              // เลือกขั้นอยู่ก็ไฮไลต์แผนกของขั้นนั้น จะได้รู้ว่ากำลังดูของใคร
              className={`chip-toggle${(stage ? stage.owner : view) === c.key ? ' on' : ''}`}
              href={viewHref(c.key)}
              prefetch={false}
            >
              {c.label}
            </Link>
          ))}
        </div>
        <span className="filter-note">
          <b>{viewLabel}</b>
          {stage ? (
            <>
              {' · '}<Link href={viewHref(stage.owner)} prefetch={false}>ดูทุกขั้นของ {stage.owner}</Link>
              {roleAllows(user.role, [stage.owner]) ? (
                <>{' · '}<Link href={stage.href} prefetch={false}>เปิดหน้างานของขั้นนี้ →</Link></>
              ) : null}
            </>
          ) : null}
        </span>
      </div>

      <JobTable
        basePath="/overview"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy ?? 'eta'} sortDir={sortBy ? sortDir : 'asc'}
        empty={stage ? `ไม่มีงานค้างที่ขั้น "${stage.label}"` : 'ไม่มีงานค้าง'}
        hint="เรียงตาม ETA เก่าสุดก่อน"
      />

      {/* ตัวเลขทั้งระบบชุดเดิม ย่อเหลือบรรทัดเดียว — ยังมีคนใช้ดูเรื่องที่ต้องตามด่วน */}
      <p className="ov-system">
        ทั้งระบบ: งานทั้งหมด <b>{summary.total}</b>
        {' · '}ปล่อยสินค้าแล้ว <b>{summary.released}</b>
        {' · '}รอ NAMKANG อนุมัติ AN <b>{summary.waitingAn}</b>
        {summary.invoiceAlerts ? <> · <span className="text-red">Invoice เปลี่ยนใหม่ <b>{summary.invoiceAlerts}</b></span></> : null}
        {summary.surrenderIssue ? <> · <span className="text-red">Surrender มีปัญหา <b>{summary.surrenderIssue}</b></span></> : null}
      </p>
    </>
  );
}
