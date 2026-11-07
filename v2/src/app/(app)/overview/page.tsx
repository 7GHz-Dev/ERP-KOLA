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
  LEVELS, OWNERS, STAGES, levelCondition, overviewStats, stageByKey, viewCondition, type StageStat,
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

/**
 * ภาพรวมงาน — สำหรับ NAMKANG ดูว่างานติดอยู่ที่ PAINT / FAH กี่งาน
 *
 * บนสุดเป็นการ์ด Urgent (ETA ถึงแล้ว) กับ Priority (ETA ภายใน 7 วัน) บอกยอดรวมก่อน
 * ถัดมาเป็นบอร์ด PAINT / FAH แยกตามขั้นเหมือนเดิม
 * ตารางยังไม่แสดงจนกว่าจะกดการ์ดหรือขั้นในบอร์ด แล้วกรองขั้นต่อได้ด้วยชิปเหนือตาราง
 *
 * พารามิเตอร์ใน URL: level = urgent | priority (ว่าง = ทุกระดับ)
 *                     view  = รหัสขั้น | PAINT | FAH (ว่าง = ทุกขั้น)
 */
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
  const rawView = one('view');
  const view = stageByKey(rawView) || rawView === 'PAINT' || rawView === 'FAH' ? rawView : '';
  const level = LEVELS.some((l) => l.key === one('level')) ? one('level') : '';
  if (view) carry.view = view;
  if (level) carry.level = level;
  const stage = stageByKey(view);
  // ตารางโผล่เมื่อเลือกอะไรสักอย่างแล้ว — เปิดหน้ามาเห็นแต่ยอดรวมก่อน
  const showTable = Boolean(view || level);

  const [stats, summary, { rows, total }] = await Promise.all([
    overviewStats(),
    dashboardSummary(),
    showTable
      ? listJobs({
          where: (ctx) => [...viewCondition(view)(ctx), levelCondition(level)],
          search, sortBy: sortBy ?? 'eta', sortDir: sortBy ? sortDir : 'asc',
        })
      : Promise.resolve({ rows: [], total: 0 }),
  ]);
  // ตัวเลขบนตัวกรองขั้นนับภายในระดับที่เลือกอยู่
  const scope = level ? stats.levels[level as 'urgent' | 'priority'] : stats;

  /** ลิงก์เปลี่ยนมุม — คงคำค้นไว้ เปลี่ยนเฉพาะค่าที่ส่งมา */
  const hrefWith = (changes: { view?: string; level?: string }) => {
    const params = new URLSearchParams({ ...carry });
    for (const [k, v] of Object.entries(changes)) {
      if (v) params.set(k, v); else params.delete(k);
    }
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

  const levelLabel = LEVELS.find((l) => l.key === level)?.label;
  const viewOwner = OWNERS.find((o) => o.key === view);
  const viewLabel = stage ? `${stage.owner} · ${stage.label}`
    : viewOwner ? `${viewOwner.title} : ${viewOwner.label} · ทุกขั้น` : 'ทุกขั้น';

  // ชิปกรองในตาราง: ทุกขั้น · PAINT · FAH · แล้วทีละขั้นที่มีงาน (ขั้นที่เลือกอยู่โชว์เสมอแม้เป็น 0)
  const stepChips = [
    { key: '', label: 'ทุกขั้น', count: scope.all.jobs, color: '' },
    ...OWNERS.map((o) => ({ key: o.key, label: `${o.label} ทั้งหมด`, count: scope.owners[o.key].jobs, color: o.color })),
    ...STAGES
      .filter((s) => scope.stages[s.key].jobs > 0 || s.key === view)
      .map((s) => ({ key: s.key, label: `${s.owner} · ${s.label}${s.passive ? ' ⏳' : ''}`, count: scope.stages[s.key].jobs, color: ownerColor(s.owner) })),
  ];

  return (
    <>
      {/* ตัวเลขเปลี่ยนตามที่คนอื่นทำงาน — ดึงใหม่ทุกนาที (ไม่รีเฟรชระหว่างพิมพ์ค้นหา) */}
      <AutoRefresh active seconds={60} />

      <div className="page-head with-action">
        <div>
          <h1>DASHBOARD</h1>
          <p>งานที่ค้างอยู่ที่ PAINT และ FAH · กดการ์ดหรือขั้นในบอร์ดเพื่อดูรายการงาน</p>
        </div>
        <span className="ov-updated">อัปเดต {formatDateTime(new Date())}</span>
      </div>

      {/*
        ---------- Urgent / Priority แยกตามคน ----------
        กดการ์ดแล้วตารางด้านล่างกรองเป็นระดับนั้นของคนนั้น — หน้าไม่เลื่อน (scroll={false})
        ผู้ใช้ขอให้อยู่ที่เดิม จะได้กดการ์ดใบอื่นต่อได้ทันที
      */}
      <div className="ov-people">
        {OWNERS.map((o) => (
          <section key={o.key} className="ov-person" style={{ '--owner': o.color } as React.CSSProperties}>
            <h2 className="ov-person-name">
              <i />{o.title} : <b>{o.label}</b>
            </h2>
            <div className="ov-person-cards">
              {LEVELS.map((l) => {
                const stat = stats.levels[l.key].owners[o.key];
                const on = level === l.key && view === o.key;
                return (
                  <Link
                    key={l.key}
                    className={`ov-level ${l.key}${on ? ' on' : ''}${stat.jobs ? '' : ' zero'}`}
                    href={hrefWith(on ? { level: '', view: '' } : { level: l.key, view: o.key })}
                    prefetch={false}
                    scroll={false}
                    aria-current={on ? 'true' : undefined}
                  >
                    <span className="ov-level-name">{l.label}</span>
                    <span className="ov-level-hint">{l.hint}</span>
                    <span className="ov-level-total">
                      <b>{stat.jobs}</b>
                      <small>งาน{stat.containers ? ` · ${stat.containers} ตู้` : ''}</small>
                    </span>
                    <span className="ov-level-cta">{on ? 'ซ่อนรายการ ▲' : 'ดูรายการ ▼'}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* ---------- บอร์ด PAINT / FAH (ยอดทุกระดับ) ---------- */}
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
                href={hrefWith({ view: view === owner.key ? '' : owner.key })}
                prefetch={false}
                scroll={false}
              >
                <span className="ov-owner"><i /><small>{owner.title} :</small> {owner.label}</span>
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
                        href={hrefWith({ view: on ? '' : s.key })}
                        prefetch={false}
                        scroll={false}
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

      {/* ---------- ตาราง (โผล่เมื่อเลือกแล้ว) ---------- */}
      {showTable ? (
        <section className={`ov-list${level ? ` ${level}` : ''}`} id="list">
          <div className="ov-list-head">
            <h2>
              {levelLabel ? <span className={`ov-pill ${level}`}>{levelLabel}</span> : null}
              {viewLabel}
              <small> · {total} งาน</small>
            </h2>
            <div className="ov-list-actions">
              {/* สลับระดับได้จากตรงนี้โดยไม่ต้องเลื่อนกลับขึ้นไป */}
              <div className="chip-group">
                {[{ key: '', label: 'ทุกระดับ' }, ...LEVELS].map((l) => (
                  <Link key={l.key || 'all'} className={`chip-toggle small${level === l.key ? ' on' : ''}`}
                    href={hrefWith({ level: l.key })} prefetch={false} scroll={false}>
                    {l.label}
                  </Link>
                ))}
              </div>
              {stage && roleAllows(user.role, [stage.owner]) ? (
                <Link className="button tiny" href={stage.href} prefetch={false}>เปิดหน้างานของขั้นนี้ →</Link>
              ) : null}
              <Link className="button tiny" href="/overview" prefetch={false} scroll={false}>ปิดตาราง ✕</Link>
            </div>
          </div>

          <div className="ov-step-filter" aria-label="กรองขั้นที่ค้าง">
            <span className="filter-label">ขั้นที่ค้าง</span>
            {stepChips.map((c) => (
              <Link
                key={c.key || 'all'}
                className={`ov-chip${view === c.key ? ' on' : ''}${c.count ? '' : ' empty'}`}
                style={c.color ? ({ '--owner': c.color } as React.CSSProperties) : undefined}
                href={hrefWith({ view: c.key })}
                prefetch={false}
                scroll={false}
              >
                {c.label} <b>{c.count}</b>
              </Link>
            ))}
          </div>

          <JobTable
            basePath="/overview"
            columns={columns}
            rows={rows} total={total} carry={carry} sortBy={sortBy ?? 'eta'} sortDir={sortBy ? sortDir : 'asc'}
            empty={`ไม่มีงาน${levelLabel ? ` ${levelLabel}` : ''}ที่ค้าง${stage ? `ขั้น "${stage.label}"` : ''}`}
            hint="เรียงตาม ETA เก่าสุดก่อน"
          />
        </section>
      ) : (
        <p className="ov-pick-hint">กดการ์ด <b className="red">Urgent</b> / <b className="amber">Priority</b> ของแต่ละคน หรือขั้นในบอร์ด เพื่อดูรายการงาน</p>
      )}

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
