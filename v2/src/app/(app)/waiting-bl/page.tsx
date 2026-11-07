import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireUserReady, roleAllows } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { cancelWaitingBl, importWaitingBls, saveWaitingBl } from '@/lib/actions/waiting-bl';
import { PASTE_COLUMNS, WAITING_CHANNELS } from '@/lib/waiting-bl';
import { ConfirmSubmit } from '@/components/Interactions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'open', label: 'รอ Arrival Notice' },
  { key: 'done', label: 'เข้าตารางหลักแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
] as const;

type Row = {
  id: string; bl_no: string; customer: string | null; shipper: string | null; vessel: string | null;
  voyage: string | null; eta: string | null; container_nos: string | null; product: string | null;
  channel: string | null; note: string | null; created_at: string; created_by_name: string | null;
  updated_at: string; resolved_at: string | null; cancelled_at: string | null; closed_by_name: string | null;
  job_id: string | null; job_no: string | null; an_status: string | null;
};

/**
 * Waiting BL — BL ที่ลูกค้าแจ้งมาทางอื่นก่อน Arrival Notice จากสายเรือ
 *
 * NAMKANG / FAH กรอกคร่าว ๆ ไว้ (ทีละใบ หรือวางจาก Excel ทีละหลายใบ)
 * PAINT รับ AN ที่ BL ตรงกันเมื่อไร หน้ารับงานเตือนพร้อมโชว์ข้อมูลที่กรอกไว้
 * NAMKANG อนุมัติ AN แล้วรายการย้ายไปแท็บ "เข้าตารางหลักแล้ว" เอง
 */
export default async function WaitingBlPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUserReady(['NAMKANG', 'FAH', 'PAINT']);
  const canEdit = roleAllows(user.role, ['NAMKANG', 'FAH']);
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'open';
  const q = one('q');

  const state = tab === 'open' ? sql`w.resolved_at is null and w.cancelled_at is null`
    : tab === 'done' ? sql`w.resolved_at is not null` : sql`w.cancelled_at is not null and w.resolved_at is null`;
  const search = q ? sql`and (w.bl_no ilike ${`%${q}%`} or w.customer ilike ${`%${q}%`} or w.shipper ilike ${`%${q}%`}
                              or w.container_nos ilike ${`%${q.replace(/\s+/g, '')}%`} or w.vessel ilike ${`%${q}%`})` : sql``;

  /*
   * งานในตารางหลักที่ BL ตรงกัน หาสด ๆ ทุกครั้ง — PAINT อาจรับ AN แล้วแต่ยังรอ NAMKANG อนุมัติ
   * ถ้าปิดรายการไปแล้วใช้งานที่ปิดให้ (resolved_job_id) ไม่ต้องหาใหม่
   */
  const [rows, counts] = await Promise.all([
    db.execute<Row>(sql`
      select w.id, w.bl_no, w.customer, w.shipper, w.vessel, w.voyage, w.eta::text as eta, w.container_nos,
             w.product, w.channel, w.note, w.created_at::text as created_at, cu.display_name as created_by_name,
             w.updated_at::text as updated_at, w.resolved_at::text as resolved_at, w.cancelled_at::text as cancelled_at,
             coalesce(uu.display_name, cc.display_name) as closed_by_name,
             m.id as job_id, m.job_no, m.an_status
        from waiting_bls w
        left join users cu on cu.id = w.created_by
        left join users uu on uu.id = w.updated_by and w.resolved_at is not null
        left join users cc on cc.id = w.cancelled_by
        left join lateral (
          select j.id, j.job_no,
                 (select a.status from approvals a where a.job_id = j.id and a.approval_type = 'AN'
                   order by a.requested_at desc limit 1) as an_status
            from jobs j
           where (w.resolved_job_id is not null and j.id = w.resolved_job_id)
              or (w.resolved_job_id is null and j.is_archived = false
                  and (upper(regexp_replace(coalesce(j.bl_no, ''), '[[:space:]]', '', 'g')) = w.bl_key
                       or exists (select 1 from bls b where b.job_id = j.id
                                    and upper(regexp_replace(coalesce(b.bl_no, ''), '[[:space:]]', '', 'g')) = w.bl_key)))
           order by j.created_at desc limit 1
        ) m on true
       where ${state} ${search}
       order by ${tab === 'open' ? sql`w.eta nulls last, w.created_at` : sql`coalesce(w.resolved_at, w.cancelled_at) desc`}
       limit 1000`),
    db.execute<{ open: number; done: number; cancelled: number }>(sql`
      select count(*) filter (where resolved_at is null and cancelled_at is null)::int as open,
             count(*) filter (where resolved_at is not null)::int as done,
             count(*) filter (where cancelled_at is not null and resolved_at is null)::int as cancelled
        from waiting_bls`),
  ]);
  const list = [...rows];
  const count = [...counts][0] ?? { open: 0, done: 0, cancelled: 0 };
  const editId = one('edit');
  const editing = editId ? list.find((r) => r.id === editId) : undefined;

  const href = (changes: Record<string, string>) => {
    const p = new URLSearchParams({ ...(tab !== 'open' ? { tab } : {}), ...(q ? { q } : {}), ...changes });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `/waiting-bl?${s}` : '/waiting-bl';
  };

  const status = (r: Row) => {
    if (r.resolved_at) return <span className="badge approved">เข้าตารางหลัก {formatDateTime(r.resolved_at)}</span>;
    if (r.cancelled_at) return <span className="badge neutral">ยกเลิก {formatDateTime(r.cancelled_at)}</span>;
    if (!r.job_id) return <span className="badge pending">ยังไม่มี AN</span>;
    return (
      <span className="badge neutral">
        PAINT รับ AN แล้ว · {r.an_status === 'PENDING' ? 'รอ NAMKANG อนุมัติ' : r.an_status === 'REJECTED' ? 'AN ถูกตีกลับ' : 'ยังไม่ส่ง AN'}
      </span>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Waiting BL</h1>
        <p>
          BL ที่ลูกค้าแจ้งมาทางอื่น (LINE / โทร / อีเมลลูกค้า) ก่อน Arrival Notice จากสายเรือ · PAINT รับ AN ที่ BL ตรงกันจะเห็นคำเตือน ·
          อนุมัติ AN เข้าตารางหลักแล้วรายการหายจากรายการรอเอง
        </p>
      </div>

      {canEdit ? (
        <div className="wbl-forms">
          <details className="wbl-card" open={Boolean(editing) || count.open === 0}>
            <summary>{editing ? `แก้ไข BL ${editing.bl_no}` : '+ เพิ่ม BL ทีละรายการ'}</summary>
            <form action={saveWaitingBl} className="wbl-form" key={editing?.id ?? 'new'}>
              {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
              <label className="wide">เลข BL *<input name="blNo" required defaultValue={editing?.bl_no ?? ''} placeholder="เช่น AMP0561328B" autoComplete="off" /></label>
              <label>ลูกค้า / Client<input name="customer" defaultValue={editing?.customer ?? ''} /></label>
              <label>Shipper<input name="shipper" defaultValue={editing?.shipper ?? ''} /></label>
              <label>เรือ<input name="vessel" defaultValue={editing?.vessel ?? ''} /></label>
              <label>Voyage<input name="voyage" defaultValue={editing?.voyage ?? ''} /></label>
              <label>ETA<input name="eta" defaultValue={editing?.eta ? formatDate(editing.eta) : ''} placeholder="วว/ดด/ปปปป" /></label>
              <label>ช่องทางที่ได้ข้อมูล
                <input name="channel" list="wbl-channels" defaultValue={editing?.channel ?? ''} />
              </label>
              <label className="wide">เลขตู้ (คั่นด้วยช่องว่างหรือจุลภาค)<input name="containerNos" defaultValue={editing?.container_nos ?? ''} /></label>
              <label className="wide">สินค้า<input name="product" defaultValue={editing?.product ?? ''} /></label>
              <label className="full">หมายเหตุ<textarea name="note" rows={2} defaultValue={editing?.note ?? ''} /></label>
              <div className="full wbl-actions">
                <button className="button primary" type="submit">{editing ? 'บันทึกการแก้ไข' : 'บันทึก'}</button>
                {editing ? <Link className="button" href={href({ edit: '' })}>ยกเลิกการแก้ไข</Link> : null}
              </div>
            </form>
            <datalist id="wbl-channels">{WAITING_CHANNELS.map((c) => <option key={c} value={c} />)}</datalist>
          </details>

          <details className="wbl-card">
            <summary>⇪ วางจาก Excel ทีละหลายรายการ</summary>
            <form action={importWaitingBls} className="wbl-form">
              <p className="full wbl-hint">
                คัดลอกแถวจาก Excel แล้ววางด้านล่าง บรรทัดละ BL · คอลัมน์เรียงตามนี้ (ว่างได้ ยกเว้น BL):{' '}
                <b>{PASTE_COLUMNS.join(' · ')}</b> · BL ที่รออยู่แล้วหรือเข้าตารางหลักแล้วจะถูกข้าม
              </p>
              <label className="full"><textarea name="paste" rows={6} required placeholder={'AMP0561328B\tASHRAF ALI\tKTK TRADING\tHUA XIANG 936\tJTX040S\t30/10/2569\tTCNU3365522 UETU8895265'} /></label>
              <label>ช่องทางที่ได้ข้อมูล (ทุกแถว)<input name="channel" list="wbl-channels" /></label>
              <div className="wbl-actions"><button className="button primary" type="submit">นำเข้า</button></div>
            </form>
          </details>
        </div>
      ) : (
        <p className="notice">ดูได้อย่างเดียว — NAMKANG หรือ FAH เป็นคนเพิ่มและแก้รายการ</p>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key === 'open' ? '' : t.key, edit: '' })} aria-current={t.key === tab ? 'page' : undefined}>
            {t.label} <small className="count">{count[t.key]}</small>
          </Link>
        ))}
      </div>

      <form className="filter-bar" method="get" action="/waiting-bl">
        {tab !== 'open' ? <input type="hidden" name="tab" value={tab} /> : null}
        <input className="wbl-search" type="search" name="q" defaultValue={q} placeholder="ค้นหา BL / ลูกค้า / Shipper / ตู้ / เรือ" />
        <button className="button tiny" type="submit">ค้นหา</button>
        {q ? <Link className="button tiny" href={href({ q: '' })}>ล้าง</Link> : null}
      </form>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-no">No.</th>
              <th>BL No.</th><th>ลูกค้า</th><th>Shipper</th><th>เรือ / Voyage</th><th>ETA</th>
              <th>เลขตู้</th><th>ช่องทาง / หมายเหตุ</th><th>สถานะ</th><th>บันทึกโดย</th>
              {canEdit && tab === 'open' ? <th className="col-actions">จัดการ</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td className="empty" colSpan={11}>{tab === 'open' ? 'ไม่มี BL ที่รอ Arrival Notice' : 'ไม่มีรายการ'}</td></tr>
            ) : list.map((r, i) => (
              <tr key={r.id} className={r.id === editId ? 'row-picked' : undefined}>
                <td className="col-no">{i + 1}</td>
                <td><b>{r.bl_no}</b></td>
                <td>{r.customer ?? '-'}</td>
                <td className="col-wrap">{r.shipper ?? '-'}</td>
                <td>{[r.vessel, r.voyage].filter(Boolean).join(' / ') || '-'}</td>
                <td>{formatDate(r.eta)}</td>
                <td className="col-wrap">{r.container_nos ?? '-'}</td>
                <td className="col-wrap">
                  {r.channel ? <span className="badge neutral">{r.channel}</span> : null} {r.product ? `${r.product} · ` : ''}{r.note ?? (r.channel ? '' : '-')}
                </td>
                <td className="col-wrap">
                  {status(r)}
                  {r.job_id ? <> <Link className="cell-link" href={`/job/${r.job_id}`}>{r.job_no}</Link></> : null}
                </td>
                <td><small>{r.created_by_name ?? '-'}<br />{formatDateTime(r.created_at)}</small></td>
                {canEdit && tab === 'open' ? (
                  <td className="col-actions">
                    <div className="row-actions">
                      <Link className="button tiny" href={href({ edit: r.id })}>แก้ไข</Link>
                      <form action={cancelWaitingBl}>
                        <input type="hidden" name="id" value={r.id} />
                        <ConfirmSubmit label="ยกเลิก" tone="danger" confirm={`ยกเลิก BL ${r.bl_no} ออกจาก Waiting BL?`}
                          detail="ใช้เมื่อลูกค้ายกเลิกหรือกรอกผิด รายการย้ายไปแท็บยกเลิก ไม่ได้ลบทิ้ง" />
                      </form>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta"><b>{list.length}</b> รายการ</p>
    </>
  );
}
