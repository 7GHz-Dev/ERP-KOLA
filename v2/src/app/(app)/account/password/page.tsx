import { requireUser } from '@/lib/auth';
import { changeOwnPassword } from '@/lib/actions/password';

export const dynamic = 'force-dynamic';

/**
 * เปลี่ยนรหัสผ่านของตัวเอง
 *
 * ผู้ใช้ที่ถูกบังคับเปลี่ยน (เพิ่งถูกสร้าง หรือเพิ่งถูกรีเซ็ตรหัส) จะถูกพามาที่นี่
 * จนกว่าจะเปลี่ยนเสร็จ layout ถึงจะปล่อยให้ไปหน้าอื่น
 */
export default async function ChangePasswordPage() {
  const user = await requireUser();
  const forced = user.mustChangePassword;

  return (
    <>
      <div className="page-head">
        <h1>{forced ? 'ตั้งรหัสผ่านของคุณ' : 'เปลี่ยนรหัสผ่าน'}</h1>
        <p>
          {forced
            ? 'บัญชีนี้ยังใช้รหัสผ่านที่ผู้ดูแลตั้งให้ กรุณาตั้งรหัสของคุณเองก่อนใช้งาน'
            : `บัญชี ${user.username}`}
        </p>
      </div>

      <form className="user-form" action={changeOwnPassword}>
        <label className="field">
          <span>รหัสผ่านเดิม</span>
          <input name="current" type="password" required autoComplete="current-password" />
        </label>
        <label className="field">
          <span>รหัสผ่านใหม่</span>
          {/* ไม่มี minLength — กติการหัสผ่านปลดออกแล้ว ตั้งได้อิสระขอแค่ไม่เว้นว่าง */}
          <input name="next" type="password" required autoComplete="new-password" />
          <small className="do-letter-hint">ตั้งได้ตามต้องการ · ต้องไม่ซ้ำกับรหัสเดิม</small>
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input name="confirm" type="password" required autoComplete="new-password" />
        </label>
        <div className="do-letter-actions">
          <button className="button primary" type="submit">บันทึกรหัสผ่านใหม่</button>
        </div>
      </form>
    </>
  );
}
