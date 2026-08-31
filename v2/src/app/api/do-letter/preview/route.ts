import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { SHIPPING_LINES, loadDoLetterForm } from '@/lib/do-letter';
import { renderDoLetterPdf } from '@/lib/do-letter-pdf';

export const dynamic = 'force-dynamic';

/**
 * ตัวอย่างจดหมายแลก D/O ตามค่าที่บันทึกไว้ล่าสุด
 *
 * หน้าตั้งค่ามีแต่ช่องกรอก มองไม่ออกว่าถ้อยคำที่แก้แล้วจะออกมาหน้าตาแบบไหน
 * ใช้ตัววาดตัวเดียวกับจดหมายจริง ต่างแค่ใส่ข้อมูลงานตัวอย่างแทนข้อมูลจริง
 *
 * ?line=<สายเรือ> ดูของสายเรือนั้น ถ้าไม่ส่งมาจะใช้ค่ากลาง
 * ?grid=1 วาดเส้นพิกัดทับให้ด้วย ใช้ตอนตั้งตำแหน่งบล็อกบนกระดาษ
 */
const SAMPLE = {
  blNo: 'AMP0555061',
  vessel: 'HUA XIANG 936',
  voyage: '0QIORS1NC',
  eta: '2026-08-29',
  portName: 'LAEM CHABANG, THAILAND',
  originName: 'NAGOYA',
};

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (user.role !== 'ADMIN') return new NextResponse('คุณไม่มีสิทธิ์ดำเนินการนี้', { status: 403 });

  const params = new URL(request.url).searchParams;
  const grid = params.get('grid') === '1';
  const asked = (params.get('line') ?? '').toUpperCase();
  const line = SHIPPING_LINES.includes(asked as (typeof SHIPPING_LINES)[number])
    ? asked
    : 'ตัวอย่างสายเรือ';

  try {
    const bytes = await renderDoLetterPdf(
      { ...SAMPLE, shippingLine: line },
      await loadDoLetterForm(),
      { grid },
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${
          encodeURIComponent(
            grid ? `ตัวอย่างจดหมายแลก DO ${line} พร้อมเส้นพิกัด.pdf`
                 : `ตัวอย่างจดหมายแลก DO ${line}.pdf`,
          )}`,
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
