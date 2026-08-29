import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { loadEofficeForm } from '@/lib/eoffice-form';
import { renderEofficeRequestPdf } from '@/lib/eoffice-pdf';

export const dynamic = 'force-dynamic';

/**
 * ตัวอย่างปะหน้าตามค่าที่บันทึกไว้ล่าสุด
 *
 * หน้าตั้งค่ามีแต่ช่องกรอก มองไม่ออกว่าขยับระยะแล้วกระดาษจะออกมาหน้าตาแบบไหน
 * เส้นทางนี้ออกไฟล์ด้วยตัวเดียวกับคำร้องจริง ต่างแค่ใส่ข้อมูลตัวอย่างแทนข้อมูลงาน
 *
 * ?grid=1 วาดเส้นพิกัดทับให้ด้วย ใช้ตอนตั้งตำแหน่งค่าบนแบบฟอร์มพื้นหลัง
 */
const SAMPLE = {
  requestNo: '0869/0028',
  bookNo: '0869',
  runningNo: '0028',
  requestDate: new Date().toISOString().slice(0, 10),
  entryNo: 'A26082875462',
  packageCount: '4 UNIT',
  netWeight: '5840 KGM',
  goodsValue: '15 USD',
  goodsType: 'USED CAR (รายละเอียดตามใบขนฯ แนบ)',
  attentionName: 'สมชาย ใจดี',
};

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (user.role !== 'ADMIN') return new NextResponse('คุณไม่มีสิทธิ์ดำเนินการนี้', { status: 403 });

  try {
    const grid = new URL(request.url).searchParams.get('grid') === '1';
    const bytes = await renderEofficeRequestPdf(SAMPLE, await loadEofficeForm(), { grid });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${
          encodeURIComponent(grid ? 'ตัวอย่างปะหน้า พร้อมเส้นพิกัด.pdf' : 'ตัวอย่างปะหน้า E-Office.pdf')}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new NextResponse(
      `ออกตัวอย่างไม่สำเร็จ: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
      { status: 500 },
    );
  }
}
