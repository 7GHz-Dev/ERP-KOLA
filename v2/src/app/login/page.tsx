import { redirect } from 'next/navigation';
import { AppError, currentUser, login } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function signIn(formData: FormData) {
  'use server';
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await login(username, password);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'เข้าสู่ระบบไม่สำเร็จ';
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  redirect('/overview');
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect('/overview');
  const { error } = await searchParams;

  return (
    <main className="login-wrap">
      <form className="login-card" action={signIn}>
        <h1>KOLA Import ERP</h1>
        <p className="sub">เข้าสู่ระบบเพื่อใช้งาน</p>

        {error ? <div className="error">{error}</div> : null}

        <label className="field">
          <span>ชื่อผู้ใช้</span>
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>

        <button className="button primary" type="submit" style={{ width: '100%', minHeight: 38 }}>
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}
