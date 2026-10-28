import { headers } from 'next/headers';
import { requireUserReady } from '@/lib/auth';
import { MasterMenu, MONITOR_MENU_KEY } from '@/components/MasterMenu';
import { ConfirmSubmit } from '@/components/Interactions';
import { masterCounts } from '@/lib/queries/master';
import { aiUsage, type LineQuota } from '@/lib/queries/usage';
import { lineAccountsOverview, type LineAccountView } from '@/lib/line-accounts';
import { addLineAccount, removeLineAccount, selectLineAccount, setLineGroup, testLineAccount } from '@/lib/actions/line';
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
  const [counts, ai, line] = await Promise.all([masterCounts(), aiUsage(), lineAccountsOverview()]);
  // URL ที่ต้องใส่เป็น Webhook URL ของ OA ใหม่ตอนหา Group ID — โดเมนเดียวกับที่เปิดหน้านี้อยู่
  const host = (await headers()).get('host') ?? 'erp-kola.vercel.app';
  const webhookUrl = `${host.startsWith('localhost') ? 'http' : 'https'}://${host}/api/line/webhook`;

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
          <LineSection accounts={line} webhookUrl={webhookUrl} />

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

/**
 * โควต้าของ OA หนึ่งตัว
 *
 * เตือนเมื่อใช้เกิน 80% — ก่อนหมดจริงพอให้ตัดสินใจได้ทัน
 * ไม่รอให้ถึง 100% เพราะตอนนั้นข้อความหายไปแล้วโดยไม่มีใครรู้
 */
function LineQuotaFigures({ quota }: { quota: LineQuota }) {
  if (quota.error) return <p className="monitor-note bad">อ่านโควต้าไม่ได้ · {quota.error}</p>;
  if (quota.type === 'none') return <p className="monitor-note ok">แผนนี้ไม่จำกัดจำนวนข้อความ</p>;
  const tone = quota.percent === null ? 'neutral'
    : quota.percent >= 90 ? 'bad' : quota.percent >= 80 ? 'warn' : 'ok';
  return (
    <>
      <div className="monitor-figures">
        <div><span>ส่งไปแล้ว</span><b>{quota.used ?? '-'}</b></div>
        <div><span>คงเหลือ</span><b className={tone}>{quota.left ?? '-'}</b></div>
        <div><span>โควต้าต่อเดือน</span><b>{quota.limit ?? '-'}</b></div>
      </div>
      {quota.percent !== null ? (
        <span className="monitor-bar" aria-hidden="true">
          <span className={tone} style={{ width: `${Math.min(quota.percent, 100)}%` }} />
        </span>
      ) : null}
      {quota.left !== null && quota.left <= 0 ? (
        <p className="monitor-note bad">โควต้าเดือนนี้หมดแล้ว — ข้อความที่ส่งด้วย OA นี้จะไม่เข้ากลุ่มจนถึงต้นเดือนหน้า</p>
      ) : null}
    </>
  );
}

function LineAccountCard({ a }: { a: LineAccountView }) {
  const name = a.bot.ok ? a.bot.name : a.name;
  const ready = a.bot.ok && a.group.ok;
  return (
    <div className={`line-oa${a.active ? ' on' : ''}`}>
      <div className="line-oa-head">
        <b>{name}</b>
        {a.bot.ok ? <small>{a.bot.basicId}</small> : a.basicId ? <small>{a.basicId}</small> : null}
        {a.fromEnv ? <span className="badge neutral">ตั้งใน Vercel</span> : null}
        {a.active ? <span className="badge approved">ใช้ส่งแจ้งเตือนอยู่</span> : null}
      </div>

      {a.bot.ok ? <LineQuotaFigures quota={a.quota} /> : <p className="monitor-note bad">{a.bot.error}</p>}

      <p className={`monitor-note${a.group.ok ? '' : ' bad'}`}>
        กลุ่มปลายทาง: {a.group.ok
          ? `${a.group.name || a.groupId}${a.group.members ? ` · สมาชิก ${a.group.members} คน` : ''}`
          : a.group.error ?? '-'}
      </p>

      {/* webhook ของ OA นี้เห็นกลุ่มแล้ว — กดใช้ได้เลย ไม่ต้องไปคัดลอก ID เอง */}
      {!a.fromEnv && !a.group.ok && a.seenGroups.length ? (
        <div className="line-oa-seen">
          <span>กลุ่มที่ bot นี้เห็นล่าสุด</span>
          {a.seenGroups.map((g) => (
            <form key={g} action={setLineGroup}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="groupId" value={g} />
              <button className="button tiny" type="submit" title={g}>ใช้ {g.slice(0, 12)}…</button>
            </form>
          ))}
        </div>
      ) : null}

      <div className="line-oa-actions">
        {!a.active ? (
          <form action={selectLineAccount}>
            <input type="hidden" name="id" value={a.id} />
            <button className="button tiny primary" type="submit" disabled={!ready}
              title={ready ? undefined : 'ต้องใช้ token ได้และ bot อยู่ในกลุ่มปลายทางก่อน'}>
              ใช้ OA นี้ส่งแจ้งเตือน
            </button>
          </form>
        ) : null}
        {ready ? (
          <form action={testLineAccount}>
            <input type="hidden" name="id" value={a.id} />
            <ConfirmSubmit label="ส่งข้อความทดสอบ"
              confirm={`ส่งข้อความทดสอบเข้ากลุ่ม ${a.group.name || a.groupId} ด้วย ${name}?`}
              detail="ใช้โควต้าของ OA นี้เหมือนข้อความแจ้งเตือนปกติหนึ่งครั้ง" />
          </form>
        ) : null}
        {!a.fromEnv ? (
          <details className="line-oa-group">
            <summary className="button tiny">{a.groupId ? 'เปลี่ยน Group ID' : 'ใส่ Group ID'}</summary>
            <form action={setLineGroup}>
              <input type="hidden" name="id" value={a.id} />
              <input name="groupId" defaultValue={a.groupId} placeholder="C…" required aria-label="Group ID" />
              <button className="button tiny primary" type="submit">บันทึก</button>
            </form>
          </details>
        ) : null}
        {!a.fromEnv ? (
          <form action={removeLineAccount}>
            <input type="hidden" name="id" value={a.id} />
            <ConfirmSubmit label="ลบ" tone="danger" confirm={`ลบ ${name} ออกจากระบบ?`}
              detail={a.active ? 'OA นี้ใช้ส่งอยู่ ลบแล้วจะกลับไปส่งด้วย OA ที่ตั้งใน Vercel' : undefined} />
          </form>
        ) : null}
      </div>
    </div>
  );
}

/**
 * LINE OA ที่ใช้แจ้งเตือนแลก DO — เห็นโควต้าทุกตัวแล้วกดเลือกตัวที่ใช้ส่ง
 * โควต้าตัวที่ใช้อยู่หมด ก็สลับไปตัวที่ยังเหลือได้ทันที ไม่ต้องแก้ Vercel แล้ว deploy ใหม่
 */
function LineSection({ accounts, webhookUrl }: { accounts: LineAccountView[]; webhookUrl: string }) {
  const activeGroup = accounts.find((a) => a.active)?.groupId ?? '';
  return (
    <section className="monitor-card">
      <h2>ข้อความแจ้งเตือน LINE (รายการใหม่รอแลก DO)</h2>
      <p className="monitor-note">
        ส่งด้วย OA ที่เลือกไว้ตัวเดียว · โควต้ารีเซ็ตทุกต้นเดือน · นับเฉพาะข้อความที่ระบบส่งเอง
        · ระบบไม่สลับ OA ให้เอง เมื่อตัวที่ใช้อยู่ใกล้หมดให้กดเลือกตัวอื่นที่นี่
        · กลุ่ม LINE หนึ่งมี OA ได้ทีละตัว สลับ OA ต้องสลับตัวที่อยู่ในกลุ่มด้วย
      </p>

      {accounts.length ? (
        <div className="line-oas">
          {accounts.map((a) => <LineAccountCard key={a.id} a={a} />)}
        </div>
      ) : (
        <p className="monitor-note">ยังไม่มี LINE OA — ระบบใช้งานได้ปกติ แค่ไม่มีการแจ้งเตือนเข้ากลุ่ม</p>
      )}

      <details className="line-oa-add" open={!accounts.length}>
        <summary className="button tiny">+ เพิ่ม LINE OA</summary>
        <form action={addLineAccount} className="line-oa-form">
          <label>
            <span>Channel access token (long-lived)</span>
            <textarea name="token" rows={3} required autoComplete="off" spellCheck={false} />
          </label>
          <label>
            <span>Group ID</span>
            <input name="groupId" defaultValue={activeGroup} placeholder="C…" autoComplete="off" />
            <small>ตั้งต้นเป็นกลุ่มเดียวกับตัวที่ใช้อยู่ ถ้า bot ใหม่อยู่ในกลุ่มนี้แล้วก็ใช้ได้ทันที</small>
          </label>
          <label>
            <span>Channel secret (ไม่บังคับ)</span>
            <input name="secret" autoComplete="off" spellCheck={false} />
            <small>ใส่ไว้เมื่อต้องหา Group ID ผ่าน webhook (ข้อ 4)</small>
          </label>
          <ol className="line-oa-steps">
            <li>สร้าง OA ใหม่ใน LINE Official Account Manager แล้วเปิดใช้ Messaging API (ตั้งค่า → Messaging API)</li>
            <li>LINE Developers Console → channel ของ OA นั้น → แท็บ Messaging API → Channel access token (long-lived) → Issue แล้วคัดลอกมาวาง</li>
            <li>
              เปิดให้ OA ใหม่เข้าร่วมแชทกลุ่มได้ (ตั้งค่าบัญชี → การใช้ฟีเจอร์) แล้ว<b>เอา OA ตัวเดิมออกจากกลุ่มก่อน</b> จึงเชิญ OA ใหม่เข้ากลุ่ม
              — LINE ให้กลุ่มหนึ่งมี LINE OA ได้ทีละตัว ตัวเดิมยังอยู่ ตัวใหม่จะเด้งออกเอง
              (สลับกลับไปใช้ตัวเดิมภายหลังก็ต้องสลับในกลุ่มเหมือนกัน)
            </li>
            <li>
              ถ้าเพิ่มแล้วขึ้นว่ายังส่งเข้ากลุ่มไม่ได้ — ตั้ง Webhook URL ของ channel ใหม่เป็น <code>{webhookUrl}</code> เปิด Use webhook
              แล้วพิมพ์อะไรก็ได้ในกลุ่ม การ์ดของ OA นี้จะมีปุ่มให้กดใช้กลุ่มนั้น (ต้องใส่ Channel secret ไว้)
            </li>
          </ol>
          <button className="button primary" type="submit">เพิ่ม LINE OA</button>
        </form>
      </details>
    </section>
  );
}
