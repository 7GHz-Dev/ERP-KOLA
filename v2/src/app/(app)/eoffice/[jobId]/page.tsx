import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { eofficeRequests } from '@/db/schema';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** เอกสารราชการใช้ พ.ศ. และเดือนภาษาไทย ต่างจากที่อื่นในระบบที่ใช้ ค.ศ. */
function thaiDate(value: string | null) {
  if (!value) return { day: '', month: '', year: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { day: '', month: '', year: '' };
  return {
    day: String(d.getUTCDate()),
    month: THAI_MONTHS[d.getUTCMonth()],
    year: String(d.getUTCFullYear() + 543),
  };
}

export default async function EofficeRequestPage({
  params,
}: { params: Promise<{ jobId: string }> }) {
  await requireUser(['PAINT']);
  const { jobId } = await params;

  const [req] = await db.select().from(eofficeRequests)
    .where(eq(eofficeRequests.jobId, jobId)).limit(1);
  if (!req) notFound();

  const date = thaiDate(req.requestDate);
  const [book, running] = (req.requestNo ?? '/').split('/');

  return (
    <>
      {/* แถบนี้ไม่ถูกพิมพ์ */}
      <div className="print-bar">
        <Link className="button" href="/pending?tab=edoc">← กลับ</Link>
        <span>คำร้อง {req.requestNo} · {req.jobNo}</span>
        <a className="button primary" href="?print=1" target="_blank" rel="noreferrer">พิมพ์</a>
      </div>

      <div className="a4">
        <h1 className="doc-title">คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร</h1>

        <div className="doc-no">
          เลขที่ <u>{book}</u> / <u>{running}</u>
        </div>

        <div className="doc-date">
          วันที่ <u>{date.day}</u> เดือน <u>{date.month}</u> พ.ศ. <u>{date.year}</u>
        </div>

        <div className="doc-row"><b>เรื่อง</b><span>ขอนำของที่นำเข้ามาในราชอาณาจักรเข้าเขตปลอดอากร</span></div>
        <div className="doc-row"><b>เรียน</b><span>นายด่านศุลกากรแม่สอด</span></div>

        <p className="indent">
          ด้วยข้าพเจ้า บริษัท <u>แม่สอดฟรีโซน จำกัด</u>
        </p>
        <p>
          ถือใบรับรองเป็นผู้ประกอบกิจการในเขตปลอดอากร <u>97-2567</u> ตั้งอยู่เลขที่ <u>888/2</u>{' '}
          หมู่ที่ <u>7</u> ตำบลท่า<u>สายลวด</u> อำเภอ <u>แม่สอด</u> จังหวัด<u>ตาก</u>{' '}
          รหัสไปรษณีย์ <u>63110</u>
        </p>
        <p className="indent">
          มีความประสงค์จะนำของที่เข้ามาในราชอาณาจักรเข้าเขตปลอดอากร แม่สอดฟรีโซน ตามใบขน
        </p>
        <p>
          สินค้าขาเข้า เลขที่ <u>{req.entryNo}</u> เพื่อปรับสภาพก่อนส่งออกไปต่างประเทศ รายละเอียด ดังนี้
        </p>

        <table className="doc-table">
          <thead>
            <tr>
              <th>จำนวนหีบห่อ</th>
              <th>น้ำหนักสุทธิ</th>
              <th>ราคาของ</th>
              <th>ชนิดของ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{req.packageCount}</td>
              <td>{req.netWeight}</td>
              <td>{req.goodsValue}</td>
              <td className="left">{req.goodsType}</td>
            </tr>
          </tbody>
        </table>

        <p className="indent">จึงเรียนมาเพื่อโปรดพิจารณา</p>

        <div className="sign-area">
          <div className="sign-left">
            <div>เรียน เรือตรี ชุมพล</div>
            <div className="indent">เพื่อดำเนินการตามระเบียบ</div>
          </div>
          <div className="sign-right">
            <div>ขอแสดงความนับถือ</div>
            <div className="sign-line">( ลงชื่อ ) ..................................... ตัวแทน/ผู้จัดการ</div>
            <div className="sign-name">( นายอัครเดช ตาสะหลี ) ประทับตรา</div>
          </div>
        </div>

        <table className="doc-table officer">
          <thead>
            <tr>
              <th>บันทึกการอนุญาตของพนักงานศุลกากร</th>
              <th>บันทึกการตรวจสอบพนักงานศุลกากร</th>
            </tr>
          </thead>
          <tbody>
            <tr><td /><td /></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
