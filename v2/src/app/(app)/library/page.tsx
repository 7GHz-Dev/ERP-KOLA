import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';
import { col, readParams } from '@/lib/columns';
import { fileLabel } from '@/lib/file-categories';
import { formatDateTime } from '@/lib/format';
import { JobTable, type Column } from '@/components/JobTable';
import { listJobs } from '@/lib/queries/jobs';
import {
  LIBRARY_GROUPS, groupOf, hasFilesIn, libraryCategoryCounts, libraryFiles, parseCategories, sortCategories,
  type LibraryFile,
} from '@/lib/queries/library';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['jobNo', 'blNo', 'person', 'shipper', 'consignee', 'vessel', 'container'];
/** เลือกไม่เกินเท่านี้ แยกหมวดละคอลัมน์ให้ไล่ดูเป็นตารางได้ เกินกว่านั้นรวมเป็นคอลัมน์เดียว ไม่งั้นตารางกว้างล้นจอ */
const SPLIT_LIMIT = 6;

/**
 * ลิงก์เปิดไฟล์ (กางแผงดูไฟล์ทับหน้าเดิม)
 * `label` = ใช้ชื่อหมวดแทนชื่อไฟล์ — มุมดูทุกหมวดมีหลายไฟล์ต่องาน ชื่อไฟล์ยาวทำให้แถวสูงจนอ่านยาก
 * ชื่อไฟล์จริงยังอยู่ใน tooltip
 */
function FileLinks({ list, label }: { list: LibraryFile[]; label?: string }) {
  return (
    <>
      {list.map((f, i) => (
        <Link
          key={f.id}
          className={`lib-file${label ? ' by-cat' : ''}`}
          href={`/file/${f.id}`}
          title={`${f.fileName} · อัปโหลด ${formatDateTime(f.uploadedAt)}${f.version > 1 ? ` · ฉบับที่ ${f.version}` : ''}`}
        >
          {label ? `${label}${list.length > 1 ? ` ${i + 1}` : ''}` : f.fileName}
          {f.version > 1 ? <small> v{f.version}</small> : null}
        </Link>
      ))}
    </>
  );
}

export default async function LibraryPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // มุมของฝั่ง KOLA เหมือนภาพรวมงาน — ANN · MAY · ACCOUNT ไม่มีเมนูนี้ เปิด URL ตรงก็พากลับหน้าตัวเอง
  const user = await requireUserReady();
  const home = homePageFor(user.role);
  if (home !== '/overview') redirect(home);

  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const selected = sortCategories(parseCategories(one('cat')));
  if (selected.length) carry.cat = selected.join(',');

  const [counts, { rows, total }] = await Promise.all([
    libraryCategoryCounts(),
    listJobs({ where: () => [hasFilesIn(selected)], search, sortBy, sortDir }),
  ]);
  const filesByJob = await libraryFiles(rows.map((r) => r.id), selected);

  // หมวดที่มีไฟล์จริง จัดเข้ากลุ่ม · หมวดที่เลือกไว้แต่ไม่มีไฟล์ยังต้องโชว์ ไม่งั้นกดเอาออกไม่ได้
  const present = sortCategories([...new Set([...counts.keys(), ...selected])]);
  const groups = [
    ...LIBRARY_GROUPS,
    { key: 'other', label: 'อื่น ๆ', categories: [] as string[] },
  ]
    .map((g) => ({ ...g, cats: present.filter((c) => groupOf(c) === g.key) }))
    .filter((g) => g.cats.length);

  const catHref = (next: string[]) => {
    const params = new URLSearchParams({ ...carry });
    if (next.length) params.set('cat', sortCategories(next).join(',')); else params.delete('cat');
    const q = params.toString();
    return q ? `/library?${q}` : '/library';
  };
  const toggle = (c: string) =>
    catHref(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  const toggleGroup = (cats: string[]) =>
    catHref(cats.every((c) => selected.includes(c))
      ? selected.filter((c) => !cats.includes(c))
      : [...new Set([...selected, ...cats])]);

  const split = selected.length > 0 && selected.length <= SPLIT_LIMIT;
  const fileColumns: Column[] = split
    ? selected.map((c): Column => ({
        label: fileLabel(c), kind: 'wrap', className: 'col-lib',
        render: (r) => {
          const list = filesByJob.get(r.id)?.get(c);
          return list?.length ? <div className="lib-files"><FileLinks list={list} /></div> : <span className="muted">-</span>;
        },
      }))
    : [{
        label: 'ไฟล์', kind: 'wrap', className: 'col-lib-all',
        render: (r) => {
          const byCat = filesByJob.get(r.id);
          if (!byCat) return '-';
          return (
            <div className="lib-chips">
              {sortCategories([...byCat.keys()]).map((c) => (
                <FileLinks key={c} list={byCat.get(c) ?? []} label={fileLabel(c)} />
              ))}
            </div>
          );
        },
      }];

  // ไฟล์คือสิ่งที่มาหา จึงวางต่อจาก Job / BL ทันที ข้อมูลงานที่เหลือไว้ช่วยค้นอยู่ด้านขวา
  const columns: Column[] = [
    col.jobNo(), col.blNo(),
    ...fileColumns,
    col.clientInCharge(), col.shipper(), col.consignee(), col.vessel(), col.eta(),
    { label: 'Container', searchKey: 'container', kind: 'wrap', render: (r) => r.containerNos?.replaceAll(',', ', ') || '-' },
  ];

  return (
    <>
      <div className="page-head">
        <h1>คลังไฟล์ข้อมูล</h1>
        <p>ไฟล์ปัจจุบันของทุกงาน แถวละ Job · เลือกหมวดเพื่อดูเฉพาะงานที่มีไฟล์หมวดนั้น · กดชื่อไฟล์เพื่อเปิดดู</p>
      </div>

      <div className="lib-filter">
        <div className="lib-filter-head">
          <span className="filter-label">หมวดไฟล์</span>
          {selected.length ? (
            <>
              <span className="filter-note">เลือก {selected.length} หมวด</span>
              <Link className="button tiny" href={catHref([])} prefetch={false}>ล้างหมวด (ดูทุกหมวด)</Link>
            </>
          ) : (
            <span className="filter-note">ยังไม่ได้เลือก = แสดงทุกหมวด · เลือกได้หลายหมวด</span>
          )}
        </div>
        {groups.map((g) => {
          const all = g.cats.every((c) => selected.includes(c));
          return (
            <div key={g.key} className="lib-filter-row">
              <Link
                className={`lib-group-toggle${all ? ' on' : ''}`}
                href={toggleGroup(g.cats)}
                prefetch={false}
                title={all ? 'เอาทั้งกลุ่มออก' : 'เลือกทั้งกลุ่ม'}
              >
                {g.label}
              </Link>
              <div className="lib-chips">
                {g.cats.map((c) => (
                  <Link
                    key={c}
                    className={`chip-toggle small${selected.includes(c) ? ' on' : ''}`}
                    href={toggle(c)}
                    prefetch={false}
                    aria-pressed={selected.includes(c)}
                  >
                    {fileLabel(c)} <small>{counts.get(c) ?? 0}</small>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <JobTable
        basePath="/library"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty={selected.length ? 'ไม่มีงานที่มีไฟล์ในหมวดที่เลือก' : 'ยังไม่มีไฟล์'}
        hint={selected.length > SPLIT_LIMIT
          ? `เลือกเกิน ${SPLIT_LIMIT} หมวดจึงรวมไฟล์ไว้คอลัมน์เดียว`
          : 'นับเฉพาะไฟล์ฉบับปัจจุบัน ฉบับเก่าดูได้ใน Drawer ของงาน'}
      />
    </>
  );
}
