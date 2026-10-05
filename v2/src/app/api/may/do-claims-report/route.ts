import { currentUser, roleAllows } from '@/lib/auth';
import { validJobDate } from '@/lib/job-created-date';
import { claimReportFileName, claimReportRows, claimReportXlsx } from '@/lib/do-claim-report';

export const dynamic = 'force-dynamic';

/**
 * ดาวน์โหลดรายงานงานที่ตั้งเบิกแล้วเป็น Excel
 *
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD  ช่วงวันที่ตั้งเบิก (รวมทั้งสองวัน ตามเวลาไทย) ว่างคือทั้งหมด
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (!roleAllows(user.role, ['MAY'])) return new Response('คุณไม่มีสิทธิ์ดำเนินการนี้', { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = validJobDate(params.get('from'));
  const to = validJobDate(params.get('to'));
  if ((params.get('from') && !from) || (params.get('to') && !to) || (from && to && from > to)) {
    return new Response('ช่วงวันที่ตั้งเบิกไม่ถูกต้อง', { status: 400 });
  }

  const body = await claimReportXlsx(await claimReportRows(from, to));
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(claimReportFileName(from, to))}`,
      'Cache-Control': 'no-store',
    },
  });
}
