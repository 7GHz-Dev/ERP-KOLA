import { requireUser } from '@/lib/auth';
import { listMaster, masterCounts, MASTER_TYPES } from '@/lib/queries/master';
import { MasterRecordForm } from '@/components/ActionForms';
import { MasterMenu } from '@/components/MasterMenu';

export const dynamic = 'force-dynamic';

export default async function MasterPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['ADMIN']);
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');

  const type = MASTER_TYPES.some((t) => t.key === one('type')) ? one('type') : 'shippers';
  const q = one('q');
  const [rows, counts] = await Promise.all([listMaster(type, q), masterCounts()]);
  const isSettings = type === 'settings';
  const typeLabel = MASTER_TYPES.find((t) => t.key === type)?.label ?? type;

  return (
    <>
      <div className="page-head">
        <h1>Master Data</h1>
        <p>ข้อมูลอ้างอิงกลางของทั้งระบบ</p>
      </div>

      <div className="master-layout">
        <MasterMenu current={type} counts={counts} />

        <div>
          <div className="toolbar">
            <form method="get" action="/master" className="toolbar-search">
              <input type="hidden" name="type" value={type} />
              <input name="q" defaultValue={q} placeholder={`ค้นหา ${typeLabel}`} />
              <button className="button" type="submit">ค้นหา</button>
            </form>
            <MasterRecordForm type={type} typeLabel={typeLabel} isSettings={isSettings} />
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-no">No.</th>
                  <th>รหัส</th>
                  <th>ชื่อ</th>
                  <th>{isSettings ? 'ค่า' : 'รายละเอียด'}</th>
                  <th>สถานะ</th>
                  <th className="col-actions">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>ยังไม่มีข้อมูล กดปุ่มเพิ่มด้านบนได้เลย</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.code ?? '-'}</td>
                    <td>{r.name}</td>
                    <td>{isSettings ? <b>{r.value ?? '-'}</b> : (r.description ?? r.country ?? r.roleName ?? '-')}</td>
                    <td>
                      {r.isActive
                        ? <span className="badge approved">ACTIVE</span>
                        : <span className="badge rejected">INACTIVE</span>}
                    </td>
                    <td className="col-actions">
                      <MasterRecordForm
                        type={type}
                        typeLabel={typeLabel}
                        isSettings={isSettings}
                        record={{
                          id: r.id, code: r.code, name: r.name,
                          description: r.description, value: r.value, isActive: r.isActive,
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">{rows.length} รายการ</p>
        </div>
      </div>
    </>
  );
}
