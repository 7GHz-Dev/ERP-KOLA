'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BLANK, describe, distinctValues, isActive, isDateColumn, parseSaved, rowPasses,
  type ColumnFilter, type TableFilters,
} from '@/lib/table-filter';

/**
 * ตัวกรองตารางในหน้าเว็บ — ปุ่มกรวยที่หัวคอลัมน์ (ติ๊กค่า / ช่วงวันที่) และเลือกคอลัมน์ที่จะแสดง
 *
 * ตารางเรนเดอร์ที่เซิร์ฟเวอร์ครบทุกรายการแล้ว ตัวนี้แค่ซ่อนแถว/คอลัมน์ในเบราว์เซอร์ จึงกรองได้ทันทีไม่ต้องโหลดใหม่
 * ค่าของช่อง = ข้อความที่เห็นในช่องนั้น ใช้ได้กับทุกตารางที่ใส่ data-col ไว้ที่หัวคอลัมน์
 *
 * ซ่อนแถวด้วยแอตทริบิวต์ hidden และติดป้ายหัวคอลัมน์ด้วย data-filtered — React ไม่ได้คุมสองค่านี้
 * ตารางเรนเดอร์ใหม่ (ค้นหา · กดปุ่มในแถว) ก็ทาตัวกรองซ้ำให้หลังทุกการเรนเดอร์
 * จำค่าแยกตามหน้า/แท็บไว้ในเบราว์เซอร์ของเครื่องนั้น (localStorage)
 */

type Option = { value: string; count: number };
type Ctx = {
  filters: TableFilters;
  setFilter: (col: string, f: ColumnFilter | null) => void;
  hidden: string[];
  setHidden: (cols: string[]) => void;
  /** ค่าที่ติ๊กได้ของคอลัมน์ (นับจากแถวที่ผ่านตัวกรองคอลัมน์อื่น) และเป็นคอลัมน์วันที่ไหม */
  options: (col: string) => { date: boolean; values: Option[] };
};

const FilterContext = createContext<Ctx | null>(null);

/** แถวข้อมูลของตาราง (ไม่นับแถว "ไม่มีรายการ") กับตำแหน่งของแต่ละคอลัมน์ตาม data-col */
function scan(root: HTMLElement) {
  const head = root.querySelector<HTMLTableRowElement>('table.data > thead > tr');
  const index = new Map<string, number>();
  Array.from(head?.cells ?? []).forEach((th, i) => {
    const col = th.dataset.col;
    if (col && !index.has(col)) index.set(col, i);
  });
  // แถว "ไม่มีรายการ" เป็นช่องเดียวกินทั้งแถว (colSpan) — ไม่ใช่ข้อมูล ไม่นับและไม่กรอง
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>('table.data > tbody > tr'))
    .filter((tr) => !(tr.cells.length === 1 && tr.cells[0].colSpan > 1));
  return { head, index, rows };
}

const text = (tr: HTMLTableRowElement, i: number) => tr.cells[i]?.textContent ?? '';

function load(key: string) {
  try { return parseSaved(localStorage.getItem(key)); } catch { return parseSaved(null); }
}

export function TableFilterScope({ storageKey, children }: { storageKey: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const scope = useId().replace(/[^a-zA-Z0-9]/g, '');
  const key = `kola-table:${storageKey}`;
  const [filters, setFilters] = useState<TableFilters>({});
  const [hidden, setHiddenState] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [counts, setCounts] = useState({ visible: 0, total: 0 });
  const [hiddenIdx, setHiddenIdx] = useState<number[]>([]);

  // ค่าที่จำไว้ของหน้านี้ — โหลดหลัง mount (เซิร์ฟเวอร์ไม่รู้ค่าในเบราว์เซอร์)
  useEffect(() => {
    const saved = load(key);
    setFilters(saved.filters);
    setHiddenState(saved.hidden);
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify({ filters, hidden })); } catch { /* เก็บไม่ได้ก็ใช้ได้แค่รอบนี้ */ }
  }, [filters, hidden, key, loadedKey]);

  // ทาตัวกรองลงตารางหลังทุกการเรนเดอร์ — แถวใหม่จากการค้นหาหรือรีเฟรชก็ถูกกรองด้วย
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { head, index, rows } = scan(el);
    const active = Object.fromEntries(Object.entries(filters).filter(([c, f]) => isActive(f) && index.has(c)));
    let visible = 0;
    for (const tr of rows) {
      const values = Object.fromEntries(Object.keys(active).map((c) => [c, text(tr, index.get(c)!)]));
      const ok = rowPasses(values, active);
      if (tr.hidden === ok) tr.hidden = !ok;
      if (ok) visible += 1;
    }
    for (const [c, i] of index) head?.cells[i]?.toggleAttribute('data-filtered', c in active);

    const cols = [...index.keys()];
    setColumns((cur) => (cur.join('\u0000') === cols.join('\u0000') ? cur : cols));
    setCounts((cur) => (cur.visible === visible && cur.total === rows.length ? cur : { visible, total: rows.length }));
    const idx = hidden.map((c) => index.get(c)).filter((i): i is number => i !== undefined).sort((a, b) => a - b);
    setHiddenIdx((cur) => (cur.join() === idx.join() ? cur : idx));
    // แถบเลือกหลายรายการ (BulkBar) ทิ้งรายการที่ถูกกรองออก ไม่ให้ส่งของที่มองไม่เห็นไปด้วย
    el.dispatchEvent(new CustomEvent('kola:table-filtered', { bubbles: true }));
  });

  const setFilter = useCallback((col: string, f: ColumnFilter | null) => {
    setFilters((cur) => {
      const next = { ...cur };
      if (f && isActive(f)) next[col] = f; else delete next[col];
      return next;
    });
  }, []);

  const options = useCallback((col: string) => {
    const el = root.current;
    if (!el) return { date: false, values: [] };
    const { index, rows } = scan(el);
    const i = index.get(col);
    if (i === undefined) return { date: false, values: [] };
    const active = Object.fromEntries(Object.entries(filters).filter(([c, f]) => isActive(f) && index.has(c)));
    const all = rows.map((tr) => text(tr, i));
    const shown = rows.filter((tr) => rowPasses(
      Object.fromEntries(Object.keys(active).map((c) => [c, text(tr, index.get(c)!)])), active, col,
    )).map((tr) => text(tr, i));
    return { date: isDateColumn(all), values: distinctValues(shown) };
  }, [filters]);

  const ctx = useMemo<Ctx>(() => ({ filters, setFilter, hidden, setHidden: setHiddenState, options }),
    [filters, setFilter, hidden, options]);

  const activeCols = Object.keys(filters).filter((c) => columns.includes(c) && isActive(filters[c]));
  const css = hiddenIdx.length
    ? `[data-tf="${scope}"] table.data tr > :nth-child(${hiddenIdx.map((i) => i + 1).join('), [data-tf="' + scope + '"] table.data tr > :nth-child(')}) { display: none; }`
    : '';

  return (
    <FilterContext.Provider value={ctx}>
      <div ref={root} data-tf={scope} className="tf-scope">
        {css ? <style>{css}</style> : null}
        {columns.length ? (
          <div className="tf-bar">
            <ColumnsButton columns={columns} />
            {activeCols.map((c) => (
              <span key={c} className="tf-chip">
                <b>{c}:</b> {describe(filters[c])}
                <button type="button" aria-label={`ล้างตัวกรอง ${c}`} onClick={() => setFilter(c, null)}>✕</button>
              </span>
            ))}
            {activeCols.length > 1 ? (
              <button type="button" className="button tiny" onClick={() => setFilters({})}>ล้างตัวกรองทั้งหมด</button>
            ) : null}
            {activeCols.length ? (
              <span className="tf-count" role="status">แสดง <b>{counts.visible}</b> จาก {counts.total} รายการ</span>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </FilterContext.Provider>
  );
}

/** เมนูลอยที่วางไว้ใต้ปุ่ม — portal ไปที่ body เพราะกรอบตาราง (overflow) ตัดของที่ล้นออกนอกกรอบ */
function Floating({ anchor, onClose, children, wide }: {
  anchor: DOMRect; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const width = wide ? 300 : 270;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 120);
  return createPortal(
    <div ref={box} className="tf-menu" style={{ left, top, width, maxHeight: window.innerHeight - top - 12 }} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

/** ปุ่มกรวยในหัวคอลัมน์ — ติ๊กค่าที่มีในคอลัมน์ หรือช่วงวันที่ถ้าเป็นคอลัมน์วันที่ */
export function ColumnFilterButton({ col }: { col: string }) {
  const ctx = useContext(FilterContext);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  if (!ctx) return null;
  const on = isActive(ctx.filters[col]);
  return (
    <>
      <button
        type="button"
        className={`tf-btn${on ? ' on' : ''}`}
        aria-label={`กรอง ${col}`}
        title={on ? `กรองอยู่: ${describe(ctx.filters[col])}` : `กรอง ${col}`}
        // กดปุ่มเดิมซ้ำเพื่อปิด — ไม่ให้ตัวดักคลิกนอกเมนูปิดก่อนแล้วปุ่มเปิดกลับขึ้นมาใหม่
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect());
        }}
      >
        {/* รูปกรวย — ไม่ใช้ลูกศร เพราะหัวคอลัมน์มีลูกศรเรียงลำดับ ▲▼ อยู่แล้ว */}
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 2h13l-5 6.2V13l-3 1.5V8.2z" fill="currentColor" />
        </svg>
      </button>
      {anchor ? <Floating anchor={anchor} onClose={close}><FilterMenu col={col} ctx={ctx} onClose={close} /></Floating> : null}
    </>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function FilterMenu({ col, ctx, onClose }: { col: string; ctx: Ctx; onClose: () => void }) {
  const [{ date, values }] = useState(() => ctx.options(col));
  const current = ctx.filters[col];
  const [picked, setPicked] = useState<Set<string>>(() => new Set(
    current?.kind === 'values' ? current.values : values.map((v) => v.value),
  ));
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(current?.kind === 'date' ? current.from ?? '' : '');
  const [to, setTo] = useState(current?.kind === 'date' ? current.to ?? '' : '');

  const apply = (f: ColumnFilter | null) => { ctx.setFilter(col, f); onClose(); };

  if (date) {
    const today = new Date();
    const quick = (a: Date, b: Date) => { setFrom(iso(a)); setTo(iso(b)); };
    return (
      <>
        <b className="tf-title">{col} — ช่วงวันที่</b>
        <label className="mini"><span>ตั้งแต่</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="mini"><span>ถึง</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="tf-quick">
          <button type="button" className="button tiny" onClick={() => quick(today, today)}>วันนี้</button>
          <button type="button" className="button tiny" onClick={() => quick(today, addDays(today, 6))}>7 วันข้างหน้า</button>
          <button type="button" className="button tiny" onClick={() => quick(addDays(today, -6), today)}>7 วันที่ผ่านมา</button>
          <button type="button" className="button tiny"
            onClick={() => quick(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0))}>
            เดือนนี้
          </button>
        </div>
        <div className="tf-actions">
          <button type="button" className="button tiny" onClick={() => apply(null)}>ล้าง</button>
          <button type="button" className="button tiny primary" onClick={() => apply({ kind: 'date', from: from || undefined, to: to || undefined })}>
            ตกลง
          </button>
        </div>
      </>
    );
  }

  const term = q.trim().toLowerCase();
  const list = term ? values.filter((v) => v.value.toLowerCase().includes(term)) : values;
  const allPicked = values.every((v) => picked.has(v.value));
  const toggle = (value: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  return (
    <>
      <b className="tf-title">{col}</b>
      <input type="search" placeholder="ค้นหาในรายการ" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      <div className="tf-quick">
        <button type="button" className="button tiny" onClick={() => setPicked(new Set([...picked, ...list.map((v) => v.value)]))}>เลือกทั้งหมด</button>
        <button type="button" className="button tiny"
          onClick={() => setPicked(new Set([...picked].filter((v) => !list.some((x) => x.value === v))))}>ไม่เลือกเลย</button>
      </div>
      <div className="tf-list">
        {list.length ? list.map((v) => (
          <label key={v.value} className={v.value === BLANK ? 'tf-blank' : undefined}>
            <input type="checkbox" checked={picked.has(v.value)} onChange={() => toggle(v.value)} />
            <span>{v.value}</span><small>{v.count}</small>
          </label>
        )) : <small className="tf-empty">ไม่มีค่าที่ตรง</small>}
      </div>
      <div className="tf-actions">
        <button type="button" className="button tiny" onClick={() => apply(null)}>ล้าง</button>
        <button
          type="button"
          className="button tiny primary"
          // ติ๊กครบทุกค่า = ไม่ได้กรองอะไร ไม่ต้องจำไว้เป็นตัวกรอง
          onClick={() => apply(allPicked ? null : { kind: 'values', values: [...picked] })}
        >
          ตกลง
        </button>
      </div>
    </>
  );
}

/** ปุ่ม "คอลัมน์" เหนือตาราง — ติ๊กคอลัมน์ที่จะแสดง */
function ColumnsButton({ columns }: { columns: string[] }) {
  const ctx = useContext(FilterContext)!;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const hiddenHere = ctx.hidden.filter((c) => columns.includes(c));
  const toggle = (col: string) => ctx.setHidden(
    ctx.hidden.includes(col) ? ctx.hidden.filter((c) => c !== col) : [...ctx.hidden, col],
  );
  return (
    <>
      <button type="button" className={`button tiny${hiddenHere.length ? ' tf-on' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>
        คอลัมน์{hiddenHere.length ? ` (ซ่อน ${hiddenHere.length})` : ''} ▾
      </button>
      {anchor ? (
        <Floating anchor={anchor} onClose={close} wide>
          <b className="tf-title">คอลัมน์ที่แสดง</b>
          <div className="tf-list">
            {columns.map((c) => (
              <label key={c}>
                <input type="checkbox" checked={!ctx.hidden.includes(c)} onChange={() => toggle(c)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
          <div className="tf-actions">
            <button type="button" className="button tiny"
              onClick={() => ctx.setHidden(ctx.hidden.filter((c) => !columns.includes(c)))}>แสดงทั้งหมด</button>
            <button type="button" className="button tiny primary" onClick={close}>เสร็จ</button>
          </div>
        </Floating>
      ) : null}
    </>
  );
}

/**
 * หัวคอลัมน์สำเร็จรูปสำหรับตารางที่ไม่ได้ใช้ JobTable (คิว Automation · แพลนลากตู้ ฯลฯ)
 * data-col ให้ตัวกรองรู้จักคอลัมน์ · filter={false} = เลือกซ่อนได้แต่ไม่มีปุ่มกรอง (เช่นคอลัมน์ปุ่ม)
 */
export function FilterTh({ label, filter = true, className }: { label: string; filter?: boolean; className?: string }) {
  return (
    <th data-col={label} className={className}>
      <div className="th-cell">
        <span>{label}</span>
        {filter ? <ColumnFilterButton col={label} /> : null}
      </div>
    </th>
  );
}
