import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';
import { col, readParams } from '@/lib/columns';
import { fileLabel } from '@/lib/file-categories';
import { formatDateTime } from '@/lib/format';
import { JobTable, type Column } from '@/components/JobTable';
import { PickAllBox, PickBox } from '@/components/BulkBar';
import { LibraryDownload, type ZipEntry } from '@/components/LibraryDownload';
import { listJobs } from '@/lib/queries/jobs';
import {
  LIBRARY_GROUPS, groupCategories, hasFilesIn, libraryCategoryCounts, libraryFiles, resolveFilter, sortCategories,
  type LibraryFile,
} from '@/lib/queries/library';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['jobNo', 'blNo', 'person', 'shipper', 'vessel', 'container'];

/** ชื่อไฟล์/โฟลเดอร์ใน ZIP ห้ามมีอักขระพวกนี้ (Windows เข้มที่สุด) */
const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();

/**
 * ลิงก์เปิดไฟล์ (กางแผงดูไฟล์ทับหน้าเดิม) — แสดงเป็นชื่อหมวด ชื่อไฟล์จริงอยู่ใน tooltip
 * งานหนึ่งมีหลายไฟล์ ชื่อไฟล์ยาวทำให้แถวสูงจนอ่านยาก
 */
function FileChips({ byCat }: { byCat?: Map<string, LibraryFile[]> }) {
  if (!byCat?.size) return <span className="muted">-</span>;
  return (
    <div className="lib-chips">
      {sortCategories([...byCat.keys()]).flatMap((c) => {
        const list = byCat.get(c) ?? [];
        return list.map((f, i) => (
          <Link
            key={f.id}
            className="lib-file"
            href={`/file/${f.id}`}
            title={`${f.fileName} · อัปโหลด ${formatDateTime(f.uploadedAt)}${f.version > 1 ? ` · ฉบับที่ ${f.version}` : ''}`}
          >
            {fileLabel(c)}{list.length > 1 ? ` ${i + 1}` : ''}
          </Link>
        ));
      })}
    </div>
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
  const counts = await libraryCategoryCounts();

  // แท็บ (กลุ่มหมวด) + หมวดย่อยในแท็บนั้น — ค่าที่ไม่รู้จักถือว่าไม่ได้เลือก
  const tabs = [
    ...LIBRARY_GROUPS.map((g) => ({ key: g.key, label: g.label })),
    { key: 'other', label: 'อื่น ๆ' },
  ]
    .map((t) => ({ ...t, cats: groupCategories(t.key, counts.present) }))
    .filter((t) => t.cats.length);
  const group = tabs.some((t) => t.key === one('g')) ? one('g') : '';
  const tab = tabs.find((t) => t.key === group);
  const filter = resolveFilter(group, one('cat'), counts.present);
  const cat = filter?.length === 1 && tab && tab.cats.length > 1 ? filter[0] : '';
  if (group) carry.g = group;
  if (cat) carry.cat = cat;

  const { rows, total } = await listJobs({ where: () => [hasFilesIn(filter)], search, sortBy, sortDir });
  const filesByJob = await libraryFiles(rows.map((r) => r.id), filter);

  // ไฟล์ที่จะลง ZIP ของแต่ละงาน — โฟลเดอร์ละงาน ตั้งชื่อด้วย Job No. กับ BL ให้หาเจอในเครื่อง
  const zipFiles: Record<string, ZipEntry[]> = {};
  for (const r of rows) {
    const folder = clean([r.jobNo, r.blNo].filter(Boolean).join(' '));
    const byCat = filesByJob.get(r.id);
    zipFiles[r.id] = byCat
      ? sortCategories([...byCat.keys()]).flatMap((c) => (byCat.get(c) ?? []).map((f) => ({
          id: f.id, size: f.sizeBytes ?? 0, path: `${folder}/${clean(`${fileLabel(c)} - ${f.fileName}`)}`,
        })))
      : [];
  }

  const linkTo = (g: string, c = '') => {
    const params = new URLSearchParams({ ...carry });
    params.delete('g'); params.delete('cat');
    if (g) params.set('g', g);
    if (c) params.set('cat', c);
    const q = params.toString();
    return q ? `/library?${q}` : '/library';
  };

  const scopeLabel = cat ? fileLabel(cat) : tab ? tab.label : 'ทุกหมวด';

  const columns: Column[] = [
    {
      label: '', kind: 'actions', className: 'col-pick', header: <PickAllBox />,
      render: (r) => <PickBox id={r.id} />,
    },
    col.jobNo(), col.blNo(),
    {
      label: 'ไฟล์', kind: 'wrap', className: 'col-lib',
      render: (r) => <FileChips byCat={filesByJob.get(r.id)} />,
    },
    { label: 'จำนวน', align: 'center', render: (r) => zipFiles[r.id]?.length || '-' },
    col.clientInCharge(), col.shipper(), col.vessel(), col.eta(),
    { label: 'Container', searchKey: 'container', kind: 'wrap', render: (r) => r.containerNos?.replaceAll(',', ', ') || '-' },
  ];

  return (
    <>
      <div className="page-head">
        <h1>IMPORT DOC FILES</h1>
        <p>ติ๊กเลือกงาน แล้วกด <b>ดาวน์โหลด ZIP</b> ที่แถบด้านล่าง · ได้ไฟล์เดียว แยกโฟลเดอร์ตาม Job · กดชื่อไฟล์เพื่อเปิดดูทีละไฟล์</p>
      </div>

      {/* ตัวกรองชั้นเดียว: แท็บตามขั้นงาน · ตัวเลข = จำนวนงานที่มีไฟล์ในแท็บนั้น */}
      <nav className="tabs lib-tabs" aria-label="หมวดไฟล์">
        <Link href={linkTo('')} prefetch={false} aria-current={!group ? 'page' : undefined}>
          ทุกหมวด <small className="count">{counts.all}</small>
        </Link>
        {tabs.map((t) => (
          <Link key={t.key} href={linkTo(t.key)} prefetch={false} aria-current={group === t.key ? 'page' : undefined}>
            {t.label} <small className="count">{counts.jobsIn(t.cats)}</small>
          </Link>
        ))}
      </nav>

      {/* หมวดย่อย — โผล่เฉพาะตอนเลือกแท็บที่มีมากกว่าหนึ่งหมวด ไม่บังคับเลือก */}
      {tab && tab.cats.length > 1 ? (
        <div className="lib-sub">
          <span className="filter-label">เฉพาะ</span>
          <Link className={`chip-toggle small${!cat ? ' on' : ''}`} href={linkTo(tab.key)} prefetch={false}>
            ทุกไฟล์ใน {tab.label}
          </Link>
          {tab.cats.map((c) => (
            <Link key={c} className={`chip-toggle small${cat === c ? ' on' : ''}`} href={linkTo(tab.key, c)} prefetch={false}>
              {fileLabel(c)} <small>{counts.perCategory.get(c) ?? 0}</small>
            </Link>
          ))}
        </div>
      ) : null}

      <LibraryDownload files={zipFiles} scopeLabel={scopeLabel}>
        <JobTable
          basePath="/library"
          columns={columns}
          rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
          empty="ไม่มีงานที่มีไฟล์ในหมวดนี้"
          hint={`ZIP จะมีเฉพาะไฟล์ "${scopeLabel}" ตามแท็บที่เลือก · นับเฉพาะไฟล์ฉบับปัจจุบัน`}
        />
      </LibraryDownload>
    </>
  );
}
