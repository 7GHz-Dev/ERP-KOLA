import { requireUserReady } from '@/lib/auth';
import { listMaster, masterCounts, MASTER_TYPES } from '@/lib/queries/master';
import { MasterRecordForm } from '@/components/ActionForms';
import { MasterMenu } from '@/components/MasterMenu';
import { FilterTh, TableFilterScope } from '@/components/TableFilter';
import { ConfirmSubmit } from '@/components/Interactions';
import { saveGmail, testPartnerChannels } from '@/lib/actions/master';
import { isShipmePartner, parseEmails } from '@/lib/partner-message';
import { gmailSender, hasChannel, recentLineGroups } from '@/lib/partner-notify';

export const dynamic = 'force-dynamic';

export default async function MasterPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['ADMIN']);
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');

  const type = MASTER_TYPES.some((t) => t.key === one('type')) ? one('type') : 'shippers';
  const q = one('q');
  const [rows, counts] = await Promise.all([listMaster(type, q), masterCounts()]);
  const isSettings = type === 'settings';
  const isPartners = type === 'partners';
  const typeLabel = MASTER_TYPES.find((t) => t.key === type)?.label ?? type;
  /*
   * Port Release Partner มีช่องทางแจ้ง (Email · LINE) — โหลดบัญชีผู้ส่งกับกลุ่ม LINE ที่ bot เห็นเฉพาะหัวข้อนี้
   * PAINT กดส่ง Partner แล้วระบบส่งชุดปล่อย E-Office ที่เซ็นแล้วไปตามช่องทางที่ผูกไว้
   */
  const [sender, lineGroups] = isPartners
    ? await Promise.all([gmailSender(), recentLineGroups()])
    : [null, []];
  const groupName = (id: string | null) => lineGroups.find((g) => g.id === id)?.name ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Master Data</h1>
        <p>ข้อมูลอ้างอิงกลางของทั้งระบบ</p>
      </div>

      <div className="master-layout">
        <MasterMenu current={type} counts={counts} />

        <div>
          <div className="toolbar">
            <form method="get" action="/master" className="toolbar-search">
              <input type="hidden" name="type" value={type} />
              <input name="q" defaultValue={q} placeholder={`ค้นหา ${typeLabel}`} />
              <button className="button" type="submit">ค้นหา</button>
            </form>
            <MasterRecordForm type={type} typeLabel={typeLabel} isSettings={isSettings} />
          </div>

          {isPartners ? (
            <div className="notice partner-channels">
              <b>ช่องทางแจ้ง Port Release Partner</b> — PAINT กดส่ง Partner ที่หน้า Upload ชุดปล่อย E-Office แล้ว
              ระบบส่งชุดปล่อยที่เซ็นแล้วให้ Partner ของงานนั้นทันที · <b>Email</b> แนบไฟล์ PDF ·
              <b> LINE</b> ส่งลิงก์ดาวน์โหลด (ใช้ได้ 7 วัน — LINE แนบ PDF เข้ากลุ่มไม่ได้) ด้วย LINE OA ที่ใช้อยู่
              ซึ่ง bot ต้องอยู่ในกลุ่มของ Partner · กด &quot;แก้ไข&quot; ที่แถวเพื่อผูกช่องทาง แล้วกด &quot;ทดสอบส่ง&quot;
              <form action={saveGmail} className="gmail-form">
                <span className="filter-label">Gmail ที่ใช้ส่ง</span>
                {sender ? (
                  <span className="badge approved">{sender.user}{sender.fromEnv ? ' (จาก env)' : ''}</span>
                ) : (
                  <span className="badge pending">ยังไม่ได้ตั้ง — ส่งทาง Email ไม่ได้</span>
                )}
                <input name="gmailUser" type="email" placeholder="you@gmail.com" defaultValue={sender?.fromEnv ? '' : sender?.user ?? ''} />
                <input name="gmailPass" type="password" placeholder="App Password 16 ตัว" autoComplete="new-password" />
                <button className="button tiny primary" type="submit">บันทึก</button>
                {sender && !sender.fromEnv ? (
                  <button className="button tiny ghost" type="submit" name="clear" value="1" formNoValidate>ลบ</button>
                ) : null}
                <small className="muted">
                  สร้าง App Password ที่ myaccount.google.com/apppasswords (ต้องเปิด 2-Step Verification ก่อน) · เก็บแบบเข้ารหัส
                </small>
              </form>
            </div>
          ) : null}

          <TableFilterScope storageKey={`/master?type=${type}`}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-no">No.</th>
                  <FilterTh label="รหัส" />
                  <FilterTh label="ชื่อ" />
                  <FilterTh label={isSettings ? 'ค่า' : 'รายละเอียด'} />
                  {isSettings ? null : <FilterTh label="ชื่อย่อ" />}
                  {isPartners ? <FilterTh label="Email" /> : null}
                  {isPartners ? <FilterTh label="กลุ่ม LINE" /> : null}
                  <FilterTh label="สถานะ" />
                  <th className="col-actions">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="empty" colSpan={isPartners ? 9 : isSettings ? 6 : 7}>ยังไม่มีข้อมูล กดปุ่มเพิ่มด้านบนได้เลย</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.id}>
                    <td><span className="rowno" /></td>
                    <td>{r.code ?? '-'}</td>
                    <td>{r.name}</td>
                    <td>{isSettings ? <b>{r.value ?? '-'}</b> : (r.description ?? r.country ?? r.roleName ?? '-')}</td>
                    {isSettings ? null : <td>{r.shortName || '-'}</td>}
                    {isPartners && isShipmePartner(r.name) ? (
                      <td colSpan={2}><span className="badge neutral">ERP SHIPME (เชื่อมภายหลัง) · Partner พื้นฐานของงาน MU</span></td>
                    ) : isPartners ? (
                      <>
                        <td className="col-wrap">{parseEmails(r.email).join(', ') || '-'}</td>
                        <td title={r.lineGroupId ?? undefined}>
                          {r.lineGroupId ? (groupName(r.lineGroupId) ?? `${r.lineGroupId.slice(0, 9)}…`) : '-'}
                        </td>
                      </>
                    ) : null}
                    <td>
                      {r.isActive
                        ? <span className="badge approved">ACTIVE</span>
                        : <span className="badge rejected">INACTIVE</span>}
                    </td>
                    <td className="col-actions">
                      <MasterRecordForm
                        type={type}
                        typeLabel={typeLabel}
                        isSettings={isSettings}
                        record={{
                          id: r.id, code: r.code, name: r.name,
                          description: r.description, value: r.value, isActive: r.isActive,
                          shortName: r.shortName, email: r.email, lineGroupId: r.lineGroupId,
                        }}
                        lineGroups={lineGroups}
                      />
                      {isPartners && hasChannel(r) ? (
                        <form action={testPartnerChannels} className="inline-form">
                          <input type="hidden" name="id" value={r.id} />
                          <ConfirmSubmit
                            label="ทดสอบส่ง"
                            confirm={`ส่งข้อความทดสอบให้ ${r.name} ใช่ไหม`}
                            detail="ส่งข้อความสั้น ๆ ไปทุกช่องทางที่ผูกไว้ ไม่แนบไฟล์งาน"
                          />
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </TableFilterScope>
          <p className="meta">{rows.length} รายการ</p>
        </div>
      </div>
    </>
  );
}
