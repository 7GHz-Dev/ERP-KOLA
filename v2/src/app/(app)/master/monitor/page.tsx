import { requireUserReady } from '@/lib/auth';
import { MasterMenu, MONITOR_MENU_KEY } from '@/components/MasterMenu';
import { masterCounts } from '@/lib/queries/master';
import { aiUsage, lineQuota } from '@/lib/queries/usage';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const baht = (v: number) => v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * หน้าติดตามการใช้งานที่เป็นเงินและเป็นโควต้า
 *
 * สองอย่างนี้ล้มเงียบเหมือนกันทั้งคู่ — โควต้า LINE หมดแล้วข้อความจะไม่เข้ากลุ่ม
 * โดยไม่มี error ให้เห็น ส่วนค่า AI เดิมโชว์บนหน้าจอครั้งเดียวแล้วหาย
 * จึงไม่มีทางรู้ว่าเดือนนี้ใช้ไปเท่าไหร่ นอกจากไปเปิดดูใบเรียกเก็บเงิน
 *
 * รวมไว้หน้าเดียวเพราะเป็นคำถามเดียวกันคือ "ตอนนี้ใช้ไปเท่าไหร่แล้ว และจะเต็มเมื่อไหร่"
 */
export default async function MonitorPage() {
  await requireUserReady(['ADMIN']);
  const [counts, ai, line] = await Promise.all([masterCounts(), aiUsage(), lineQuota()]);

  /*
   * เตือนเมื่อใช้เกิน 80% — ก่อนหมดจริงพอให้ตัดสินใจได้ทัน
   * ไม่รอให้ถึง 100% เพราะตอนนั้นข้อความหายไปแล้วโดยไม่มีใครรู้
   */
  const lineTone = line.percent === null ? 'neutral'
    : line.percent >= 90 ? 'bad' : line.percent >= 80 ? 'warn' : 'ok';

  return (
    <>
      <div className="page-head">
        <h1>การใช้งานและค่าใช้จ่าย</h1>
        <p>โควต้าข้อความ LINE · ค่าอ่านเอกสาร AN/BL ด้วย AI</p>
      </div>

      <div className="master-layout">
        <MasterMenu current={MONITOR_MENU_KEY} counts={counts} />

        <div className="monitor-body">
          {/* ---------- LINE ---------- */}
          <section className="monitor-card">
            <h2>ข้อความแจ้งเตือน LINE</h2>
            {!line.configured ? (
              <p className="monitor-note">
                ยังไม่ได้ตั้งค่า LINE — ระบบใช้งานได้ปกติ แค่ไม่มีการแจ้งเตือนเข้ากลุ่ม
              </p>
            ) : line.error ? (
              <p className="monitor-note bad">อ่านโควต้าไม่ได้ · {line.error}</p>
            ) : line.type === 'none' ? (
              <p className="monitor-note ok">แผนนี้ไม่จำกัดจำนวนข้อความ</p>
            ) : (
              <>
                <div className="monitor-figures">
                  <div><span>ส่งไปแล้ว</span><b>{line.used ?? '-'}</b></div>
                  <div><span>คงเหลือ</span><b className={lineTone}>{line.left ?? '-'}</b></div>
                  <div><span>โควต้าต่อเดือน</span><b>{line.limit ?? '-'}</b></div>
                </div>
                {line.percent !== null ? (
                  <>
                    <span className="monitor-bar" aria-hidden="true">
                      <span className={lineTone} style={{ width: `${Math.min(line.percent, 100)}%` }} />
                    </span>
                    <p className="monitor-note">
                      ใช้ไป {line.percent}% · รีเซ็ตทุกต้นเดือน · นับเฉพาะข้อความที่ระบบส่งเอง
                      {line.percent >= 80 ? ' · ใกล้เต็มแล้ว ข้อความที่เกินโควต้าจะไม่ถูกส่งโดยไม่มีข้อความแจ้ง' : ''}
                    </p>
                  </>
                ) : null}
              </>
            )}
          </section>

          {/* ---------- AI ---------- */}
          <section className="monitor-card">
            <h2>ค่าอ่านเอกสาร AN/BL ด้วย AI</h2>
            <div className="monitor-figures">
              <div><span>วันนี้</span><b>{baht(ai.today.baht)} ฿</b><small>{ai.today.calls} ใบ</small></div>
              <div><span>7 วันล่าสุด</span><b>{baht(ai.week.baht)} ฿</b><small>{ai.week.calls} ใบ</small></div>
              <div><span>เดือนนี้</span><b>{baht(ai.month.baht)} ฿</b><small>{ai.month.calls} ใบ</small></div>
              <div><span>ทั้งหมด</span><b>{baht(ai.total.baht)} ฿</b><small>{ai.total.calls} ใบ</small></div>
            </div>
            <p className="monitor-note">
              เรียก AI เฉพาะใบที่ตัวอ่านอัตโนมัติอ่านไม่ครบ (ส่วนใหญ่คือไฟล์สแกน) ·
              เฉลี่ยราว 0.83 บาทต่อใบ · เริ่มเก็บสถิติตั้งแต่ 23 ก.ย. 2569
            </p>

            {ai.daily.length ? (
              <div className="table-wrap">
                <table className="data monitor-table">
                  <thead>
                    <tr><th>วันที่</th><th className="num">จำนวนใบ</th><th className="num">ค่าใช้จ่าย</th><th className="num">อ่านไม่สำเร็จ</th></tr>
                  </thead>
                  <tbody>
                    {ai.daily.map((d) => (
                      <tr key={d.day}>
                        <td>{formatDate(d.day)}</td>
                        <td className="num">{d.calls}</td>
                        <td className="num">{baht(d.baht)} ฿</td>
                        {/* อ่านไม่สำเร็จ = เสียเงินแล้วแต่ไม่ได้ค่า ถ้าเยอะผิดปกติต้องเห็น */}
                        <td className="num">{d.failed ? <b className="bad">{d.failed}</b> : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="monitor-note">ยังไม่มีการเรียกใช้ AI ในช่วง 14 วันที่ผ่านมา</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
