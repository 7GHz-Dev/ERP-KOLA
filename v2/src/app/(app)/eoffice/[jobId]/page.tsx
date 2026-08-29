import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eofficeRequests, files } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { loadEofficeForm } from '@/lib/eoffice-form';

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

/**
 * หน้าคำร้องขนาด A4 สำหรับดูและสั่งพิมพ์จากเบราว์เซอร์
 *
 * ข้อความและระยะทุกค่ามาจากหน้า /master/eoffice ชุดเดียวกับที่ตัววาด PDF ใช้
 * สองทางจึงออกมาหน้าตาเหมือนกันเสมอ ไม่ต้องไล่แก้สองที่
 */
export default async function EofficeRequestPage({
  params,
}: { params: Promise<{ jobId: string }> }) {
  await requireUser(['PAINT']);
  const { jobId } = await params;

  const [req] = await db.select().from(eofficeRequests)
    .where(eq(eofficeRequests.jobId, jobId)).limit(1);
  if (!req) notFound();

  const f = await loadEofficeForm();
  const date = thaiDate(req.requestDate);

  /*
   * โหมดใช้แบบฟอร์มพื้นหลัง หน้าจอจำลองด้วย HTML ไม่ได้ เพราะกระดาษมาจากไฟล์ PDF
   * เอาไฟล์จริงที่ระบบออกให้มาแสดงแทน จะได้เห็นตรงกับที่ยื่นจริงทุกจุด
   */
  const [pdf] = f.hasTemplate
    ? await db.select({ id: files.id }).from(files)
      .where(and(
        eq(files.jobId, jobId), eq(files.category, 'EOFFICE_REQUEST'), eq(files.isCurrent, true),
      ))
      .limit(1)
    : [];
  const [book, running] = (req.requestNo ?? '/').split('/');

  // ค่าที่ตั้งไว้เป็นพอยต์อยู่แล้ว ส่งเข้า CSS ตรง ๆ ได้เลย
  const pt = (key: string) => `${f.n(key)}pt`;
  const style = {
    '--doc-title': pt('titleSize'),
    '--doc-body': pt('bodySize'),
    '--doc-table': pt('tableSize'),
    '--doc-officer': pt('officerSize'),
    '--doc-margin-x': pt('marginX'),
    '--doc-top': pt('topY'),
    '--doc-gap': pt('lineGap'),
    '--doc-indent': pt('indent'),
    '--doc-col-w': pt('tableColWidth'),
    '--doc-officer-h': pt('officerHeight'),
    '--doc-sign-gap': pt('signGap'),
  } as React.CSSProperties;

  if (f.hasTemplate) {
    return (
      <>
        <div className="print-bar">
          <Link className="button" href="/pending?tab=edoc">← กลับ</Link>
          <span>คำร้อง {req.requestNo} · {req.jobNo}</span>
          {pdf ? (
            <a className="button primary" href={`/files/${pdf.id}`} target="_blank" rel="noreferrer">
              เปิดไฟล์
            </a>
          ) : null}
        </div>
        {pdf ? (
          <object className="doc-embed" data={`/files/${pdf.id}`} type="application/pdf">
            <p>
              เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้{' '}
              <a href={`/files/${pdf.id}`}>เปิดไฟล์คำร้อง</a>
            </p>
          </object>
        ) : (
          <p className="notice">
            ยังไม่มีไฟล์คำร้องของงานนี้ — กดออกคำร้องใหม่ที่แท็บเตรียมเอกสารเดิน E
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {/* แถบนี้ไม่ถูกพิมพ์ */}
      <div className="print-bar">
        <Link className="button" href="/pending?tab=edoc">← กลับ</Link>
        <span>คำร้อง {req.requestNo} · {req.jobNo}</span>
        <a className="button primary" href="?print=1" target="_blank" rel="noreferrer">พิมพ์</a>
      </div>

      <div className="a4" style={style}>
        <h1 className="doc-title">{f.t('title')}</h1>

        <div className="doc-no">
          เลขที่ <u>{book}</u> / <u>{running}</u>
        </div>

        <div className="doc-date">
          วันที่ <u>{date.day}</u> เดือน <u>{date.month}</u> พ.ศ. <u>{date.year}</u>
        </div>

        <div className="doc-row"><b>เรื่อง</b><span>{f.t('subject')}</span></div>
        <div className="doc-row"><b>เรียน</b><span>{f.t('attention')}</span></div>

        <p className="indent">
          ด้วยข้าพเจ้า บริษัท <u>{f.t('companyName')}</u>
        </p>
        <p>
          ถือใบรับรองเป็นผู้ประกอบกิจการในเขตปลอดอากร <u>{f.t('licenseNo')}</u>{' '}
          ตั้งอยู่เลขที่ <u>{f.t('addressNo')}</u> หมู่ที่ <u>{f.t('moo')}</u>{' '}
          ตำบล<u>{f.t('tambon')}</u> อำเภอ <u>{f.t('amphoe')}</u>{' '}
          จังหวัด<u>{f.t('province')}</u> รหัสไปรษณีย์ <u>{f.t('postcode')}</u>
        </p>
        <p className="indent">
          มีความประสงค์จะนำของที่เข้ามาในราชอาณาจักรเข้าเขตปลอดอากร {f.t('zoneName')} ตามใบขน
        </p>
        <p>
          สินค้าขาเข้า เลขที่ <u>{req.entryNo}</u> {f.t('purpose')} รายละเอียด ดังนี้
        </p>

        <table className="doc-table">
          <thead>
            <tr>
              <th className="fixed">{f.t('colPackage')}</th>
              <th className="fixed">{f.t('colWeight')}</th>
              <th className="fixed">{f.t('colValue')}</th>
              <th>{f.t('colGoods')}</th>
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

        <p className="indent">{f.t('closing')}</p>

        <div className="sign-area">
          <div className="sign-left">
            <div>{[f.t('routeTo'), req.attentionName].filter(Boolean).join(' ')}</div>
            <div className="indent">{f.t('routeNote')}</div>
          </div>
          <div className="sign-right">
            <div>{f.t('regards')}</div>
            <div className="sign-line">{f.t('signLine')}</div>
            <div className="sign-name">{f.t('signName')}</div>
          </div>
        </div>

        <table className="doc-table officer">
          <thead>
            <tr>
              <th>{f.t('officerLeft')}</th>
              <th>{f.t('officerRight')}</th>
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
