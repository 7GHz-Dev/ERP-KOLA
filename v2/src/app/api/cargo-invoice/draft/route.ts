import { logActivity } from '@/lib/actions/common';
import { cargoReader, cargoUser, json } from '@/lib/cargo-invoice/http';
import { jobById } from '@/lib/cargo-invoice/jobs';
import { cleanDraft, deleteFnDraft, loadFnDraft, saveFnDraft } from '@/lib/cargo-invoice/fn-draft';

export const dynamic = 'force-dynamic';

/**
 * Draft FN Invoice (NORMAL) ของงาน — งานละหนึ่งชุด
 *   GET    ?jobId=   Draft ที่บันทึกไว้ (null = ไม่มี)
 *   POST   {jobId, draft}  บันทึก/ทับ Draft
 *   DELETE ?jobId=   ทิ้ง Draft
 */
export async function GET(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
  if (!jobId) return json({ draft: null });
  return json({ draft: await loadFnDraft(jobId) });
}

export async function POST(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { jobId?: unknown; draft?: unknown } | null;
  const job = body?.jobId ? await jobById(String(body.jobId)) : null;
  if (!job) return json({ error: 'เลือกงานก่อน — Draft เก็บไว้กับงาน' }, 400);
  const draft = cleanDraft(body?.draft);
  if (!draft.cars.length) return json({ error: 'ยังไม่มีรายการรถ' }, 400);
  const savedAt = await saveFnDraft(job.id, job.jobNo, user.id, draft);
  await logActivity(user.id, 'SAVE_FN_DRAFT', 'JOB', job.id, { cars: draft.cars.length, invoiceNo: draft.invoiceNo });
  return json({ ok: true, savedAt, jobNo: job.jobNo });
}

export async function DELETE(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
  if (!jobId) return json({ error: 'ไม่ระบุงาน' }, 400);
  await deleteFnDraft(jobId);
  await logActivity(user.id, 'DELETE_FN_DRAFT', 'JOB', jobId);
  return json({ ok: true });
}
