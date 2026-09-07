import { requireUserReady } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import { listUsers } from '@/lib/queries/users';
import { companyLabel, departmentLabel, ROLE_INFO } from '@/lib/org';
import { MasterMenu, USERS_MENU_KEY } from '@/components/MasterMenu';
import {
  CreateUserForm, EditUserForm, ResetPasswordForm, ToggleActiveForm,
} from '@/components/UserForms';

export const dynamic = 'force-dynamic';

/**
 * หน้าจัดการผู้ใช้ — เฉพาะ ADMIN
 *
 * แสดงทั้งสังกัดและสิทธิ์คู่กัน เพราะสองอย่างนี้ไม่ผูกกันอัตโนมัติ
 * ผู้ดูแลจึงต้องเห็นพร้อมกันว่าใครอยู่แผนกไหนแล้วได้สิทธิ์อะไรจริง ๆ
 */
export default async function UsersPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ADMIN']);
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const [rows, counts] = await Promise.all([listUsers(q), masterCounts()]);

  return (
    <>
      <div className="page-head">
        <h1>ผู้ใช้งาน</h1>
        <p>เพิ่มผู้ใช้ กำหนดแผนก ตำแหน่ง และสิทธิ์การใช้งาน</p>
      </div>

      <div className="master-layout">
        <MasterMenu current={USERS_MENU_KEY} counts={counts} />

        <div>
          <CreateUserForm />

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ชื่อผู้ใช้</th>
                  <th>ชื่อที่แสดง</th>
                  <th>สังกัด</th>
                  <th>แผนก / ตำแหน่ง</th>
                  <th>สิทธิ์</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.username}</b></td>
                    <td>{u.displayName}</td>
                    <td>{companyLabel(u.company)}</td>
                    <td>
                      {departmentLabel(u.department)}
                      <small className="do-letter-hint">{u.position ?? '-'}</small>
                    </td>
                    <td>
                      {ROLE_INFO[u.role]?.label ?? u.role}
                      <small className="do-letter-hint">{u.role}</small>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'approved' : 'pending'}`}>
                        {u.isActive ? 'ใช้งาน' : 'ระงับ'}
                      </span>
                      {u.mustChangePassword ? (
                        <small className="do-letter-hint">ต้องเปลี่ยนรหัส</small>
                      ) : null}
                    </td>
                    <td>
                      <div className="row-actions">
                        <EditUserForm user={u} />
                        <ResetPasswordForm user={u} />
                        <ToggleActiveForm user={u} />
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="slip-empty">ไม่พบผู้ใช้</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
