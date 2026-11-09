import { jobsForBl } from '@/lib/cargo-invoice/jobs';
import { cargoReader, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';

/** ค้นงานเองด้วย BL / Job No. — ใช้ตอนหางานจาก Invoice ไม่เจอ หรือเจอหลายงาน */
export async function GET(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.replace(/[\s-]/g, '').length < 4) return json({ jobs: [] });
  return json({ jobs: await jobsForBl(q) });
}
