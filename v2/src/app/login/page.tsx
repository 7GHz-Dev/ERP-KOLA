import { redirect } from 'next/navigation';
import { AppError, currentUser, login } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';

export const dynamic = 'force-dynamic';

async function signIn(formData: FormData) {
  'use server';
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  let user;
  try {
    user = await login(username, password);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'เข้าสู่ระบบไม่สำเร็จ';
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  redirect(homePageFor(user.role));
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const signedIn = await currentUser();
  if (signedIn) redirect(homePageFor(signedIn.role));
  const { error } = await searchParams;

  return (
    <main className="login-wrap">
      <form className="login-card" action={signIn}>
        {/*
          โลโก้เต็ม (มีชื่อแบรนด์ในตัว) จึงไม่ต้องมี <h1> ซ้ำอีก
          เหลือไว้เป็น sr-only ให้โปรแกรมอ่านหน้าจอและ SEO ยังเห็นชื่อระบบ
        */}
        <img className="login-logo" src="/logo.png" alt="" width={160} height={160} />
        <h1 className="visually-hidden">KOLA Import ERP</h1>
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
