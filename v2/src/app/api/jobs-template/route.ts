import { currentUser, roleAllows } from '@/lib/auth';
import { templateCsv, templateFileName, templateRows } from '@/lib/job-template';

export const dynamic = 'force-dynamic';

/**
 * ดาวน์โหลดตารางงานตามแบบฟอร์มที่ทีมใช้กันอยู่
 *
 * ?scope=approved  เฉพาะงานที่ผ่านอนุมัติ AN เข้าตารางหลักแล้ว (ค่าตั้งต้น)
 * ?scope=all       ทุกงานที่ยังไม่ถูกเก็บเข้ากรุ
 * ?jobId=...       เฉพาะงานที่ระบุ ใส่ซ้ำได้หลายตัว
 *
 * NAMKANG เป็นคนอนุมัติเข้าตารางหลัก จึงเป็นคนที่ต้องส่งตารางนี้ต่อ
 * PAINT กับ FAH เปิดได้ด้วยเพราะใช้ข้อมูลชุดเดียวกันในการติดตามงาน
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new Response('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (!roleAllows(user.role, ['NAMKANG', 'PAINT', 'FAH'])) {
    return new Response('คุณไม่มีสิทธิ์ดำเนินการนี้', { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const jobIds = params.getAll('jobId').filter(Boolean);
  const scope = params.get('scope') ?? 'approved';

  const rows = await templateRows({
    jobIds: jobIds.length ? jobIds : undefined,
    // ระบุงานมาเองแล้วไม่ต้องกรองซ้ำ คนกดเลือกเองว่าจะเอาใบไหน
    anApprovedOnly: !jobIds.length && scope !== 'all',
  });

  const name = templateFileName();
  return new Response(templateCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
