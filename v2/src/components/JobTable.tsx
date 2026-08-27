import Link from 'next/link';
import { LiveSearch } from '@/components/LiveSearch';
import { TableInteractions } from '@/components/TableInteractions';
import type { JobRow } from '@/lib/queries/jobs';

/**
 * ตารางงานกลาง — ค้นหารายคอลัมน์และคลิกหัวคอลัมน์เพื่อเรียงลำดับ
 *
 * ทำงานด้วย URL query ล้วน ๆ ไม่มี JavaScript ฝั่งเบราว์เซอร์เลย
 * การกรองและเรียงเกิดที่ฐานข้อมูล หน้าเว็บได้ HTML ที่เสร็จแล้วมาเลย
 *
 * ฟอร์มค้นหาต้องอยู่ "นอก" ตาราง เพราะ HTML ห้าม <form> ซ้อน <form>
 * ถ้าครอบตารางไว้ เบราว์เซอร์จะทิ้งแท็กฟอร์มด้านในทั้งหมด ปุ่มในแถวจึงกลาย
 * เป็นปุ่มส่งฟอร์มค้นหาแทน กดแล้วหน้าโหลดใหม่เฉย ๆ ไม่มีอะไรเกิดขึ้น
 * ช่องค้นหาในหัวตารางผูกกลับมาที่ฟอร์มด้วยแอตทริบิวต์ form="..." แทน
 */

export type Column = {
  label: string;
  /** ชื่อพารามิเตอร์ค้นหา ต้องตรงกับ SEARCHABLE ใน queries/jobs.ts */
  searchKey?: string;
  /** ชื่อคอลัมน์สำหรับเรียงลำดับ ต้องตรงกับ SORTABLE */
  sortKey?: string;
  align?: 'left' | 'center' | 'right';
  /** actions = คอลัมน์ปุ่ม ดันไปไว้ท้ายตาราง · wrap = ยอมให้ข้อความขึ้นบรรทัดใหม่ */
  kind?: 'text' | 'actions' | 'wrap';
  render: (row: JobRow) => React.ReactNode;
};

type Props = {
  basePath: string;
  columns: Column[];
  rows: JobRow[];
  total: number;
  /** ค่าที่ต้องติดไปกับทุกลิงก์ เช่นแท็บที่เลือกอยู่ และคำค้นปัจจุบัน */
  carry: Record<string, string>;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  empty?: string;
  hint?: string;
};

function href(basePath: string, carry: Record<string, string>, changes: Record<string, string | undefined>) {
  const params = new URLSearchParams(carry);
  Object.entries(changes).forEach(([k, v]) => {
    if (v === undefined || v === '') params.delete(k);
    else params.set(k, v);
  });
  const q = params.toString();
  return q ? `${basePath}?${q}` : basePath;
}

export function JobTable({
  basePath, columns, rows, total, carry, sortBy, sortDir, empty, hint,
}: Props) {
  const searchKeys = columns.map((c) => c.searchKey).filter(Boolean) as string[];
  const hasSearch = searchKeys.length > 0;
  const activeSearch = searchKeys.filter((k) => carry[k]);
  const formId = `q${basePath.replace(/[^a-z0-9]+/gi, '-')}`;

  return (
    <>
      {/*
        ฟอร์มค้นหาอยู่นอกตาราง เพราะ <form> ซ้อน <form> ไม่ได้
        ปุ่มค้นหาต้องมีจริง ๆ ด้วย ไม่ใช่แค่ให้กด Enter — HTML กำหนดว่าถ้าฟอร์มไม่มี
        ปุ่ม submit และมีช่องข้อความมากกว่าหนึ่งช่อง การกด Enter จะไม่ส่งฟอร์มเลย
        ตารางนี้มีช่องค้นหาหลายช่อง ก่อนหน้านี้จึงกด Enter แล้วเงียบ
      */}
      <form id={formId} method="get" action={basePath} className="search-form">
        {Object.entries(carry)
          .filter(([key]) => !searchKeys.includes(key))
          .map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        {hasSearch ? (
          <>
            {/*
              ปุ่มส่งฟอร์มยังต้องมีอยู่แม้จะซ่อนไว้ — HTML กำหนดว่าถ้าฟอร์มไม่มีปุ่ม submit
              และมีช่องข้อความหลายช่อง การกด Enter จะไม่ส่งฟอร์มเลย
              ปกติค้นหาให้เองตั้งแต่พิมพ์อยู่แล้ว ปุ่มนี้ไว้เผื่อเบราว์เซอร์ที่ปิด JavaScript
            */}
            <button className="visually-hidden" type="submit" tabIndex={-1}>ค้นหา</button>
            {activeSearch.length ? (
              <Link
                className="button tiny"
                href={href(
                  basePath,
                  carry,
                  Object.fromEntries(activeSearch.map((k) => [k, undefined])),
                )}
              >
                ล้างคำค้นทั้งหมด ({activeSearch.length})
              </Link>
            ) : null}
          </>
        ) : null}
      </form>

      {hasSearch ? <LiveSearch formId={formId} basePath={basePath} /> : null}

      {/* ดับเบิลคลิกแถวเพื่อเปิด Drawer และเก็บลำดับแถวให้ปุ่ม ◀ ▶ ใช้ */}
      <TableInteractions ids={rows.map((r) => r.id)} />

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-no">No.</th>
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={c.kind === 'actions' ? 'col-actions' : undefined}
                  style={c.align ? { textAlign: c.align } : undefined}
                >
                  {c.sortKey ? (
                    <Link
                      className="sort-link"
                      href={href(basePath, carry, {
                        sortBy: c.sortKey,
                        sortDir: sortBy === c.sortKey && sortDir === 'asc' ? 'desc' : 'asc',
                      })}
                    >
                      <span>{c.label}</span>
                      <i className="arrow">
                        {sortBy === c.sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </i>
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
            {hasSearch ? (
              <tr className="filters">
                <th />
                {columns.map((c) => (
                  <th key={c.label}>
                    {c.searchKey ? (
                      <input
                        form={formId}
                        type="search"
                        name={c.searchKey}
                        defaultValue={carry[c.searchKey] ?? ''}
                        placeholder="ค้นหา"
                        aria-label={`ค้นหา ${c.label}`}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="empty" colSpan={columns.length + 1}>
                  {empty ?? 'ไม่มีรายการ'}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.id}
                  data-open-job={row.id}
                  className={row.hasInvoiceAlert ? 'alert' : undefined}
                >
                  <td className="col-no">
                    {/* ยังเป็นลิงก์อยู่ เผื่อเบราว์เซอร์ที่ปิด JavaScript จะได้ยังเปิดสรุปงานได้ */}
                    <Link className="row-open" href={`/job/${row.id}`} title={`เปิดสรุปงาน ${row.jobNo}`}>
                      {index + 1}
                    </Link>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.label}
                      className={
                        c.kind === 'actions' ? 'col-actions'
                          : c.kind === 'wrap' ? 'col-wrap'
                            : undefined
                      }
                      style={c.align ? { textAlign: c.align } : undefined}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="meta">
        <b>{total}</b> รายการ
        {' · ดับเบิลคลิกแถวเพื่อดู Container, File และ Timeline ใน Drawer'}
        {hasSearch ? ' · พิมพ์ในช่องใต้หัวคอลัมน์เพื่อค้นหาทันที' : ''}
        {' · คลิกหัวคอลัมน์เพื่อเรียงลำดับ'}
        {hint ? ` · ${hint}` : ''}
      </p>
    </>
  );
}

/* ---------- ชิ้นส่วนที่ใช้ซ้ำในหลายหน้า ---------- */

export function Tabs({
  basePath, items, active, carry,
}: {
  basePath: string;
  items: Array<{ key: string; label: string; count?: number }>;
  active: string;
  carry?: Record<string, string>;
}) {
  return (
    <div className="tabs">
      {items.map((item) => (
        <Link
          key={item.key}
          href={href(basePath, carry ?? {}, { tab: item.key })}
          prefetch
          aria-current={item.key === active ? 'page' : undefined}
        >
          {item.label}
          {item.count === undefined ? null : <small className="count">{item.count}</small>}
        </Link>
      ))}
    </div>
  );
}

export function ApprovalBadge({ status }: { status: string | null }) {
  if (!status) return <span className="badge pending">รอส่งอนุมัติ</span>;
  if (status === 'APPROVED') return <span className="badge approved">อนุมัติแล้ว</span>;
  if (status === 'REJECTED') return <span className="badge rejected">ไม่อนุมัติ</span>;
  return <span className="badge pending">รออนุมัติ</span>;
}

export function FileChip({ file }: { file?: { id: string; fileName: string } }) {
  if (!file) return <span className="badge pending">รอดำเนินการ</span>;
  // เปิดผ่านเส้นทางของแอปเสมอ เพราะ bucket เป็นแบบส่วนตัว
  return (
    <a
      className="badge approved file-link"
      href={`/files/${file.id}`}
      target="_blank"
      rel="noreferrer"
      title={file.fileName}
    >
      {file.fileName}
    </a>
  );
}
