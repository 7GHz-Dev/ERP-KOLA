import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import { MasterMenu, WEB_TEMPLATE_MENU_KEY } from '@/components/MasterMenu';
import { listWebTemplates } from '@/lib/web-template-store';
import { createWebTemplate } from '@/lib/actions/web-template';
import { BUTTON_PAGES } from '@/lib/web-template';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * รายการ Template กรอกเว็บ — ขั้นตอนเปิดเว็บ คลิก กรอก แนบไฟล์ ที่กลายเป็นปุ่มในหน้างาน
 */
export default async function WebTemplatesPage() {
  await requireUserReady(['ADMIN']);
  const [templates, counts] = await Promise.all([listWebTemplates(), masterCounts()]);

  return (
    <>
      <div className="page-head">
        <h1>Template กรอกเว็บ</h1>
        <p>
          บันทึกขั้นตอนบนเว็บภายนอก (เปิดลิงก์ · คลิก · กรอก · แนบไฟล์) แล้วสร้างเป็นปุ่มในหน้างาน ·
          worker บนเครื่องที่ล็อกอินเว็บไว้เป็นคนทำ (npm run worker:web)
        </p>
      </div>

      <div className="master-layout">
        <MasterMenu current={WEB_TEMPLATE_MENU_KEY} counts={counts} />

        <div className="doc-form">
          <div className="doc-form-section">
            <h2>สร้าง Template ใหม่</h2>
            <p className="meta">
              สร้างแล้วจะเปิดหน้าแก้ — กด “บันทึกขั้นตอน” ให้ worker เปิด Chrome แล้วทำตามขั้นตอนจริงหนึ่งรอบ
              ระบบเก็บว่าคลิก/กรอกช่องไหนให้เอง
            </p>
            <form action={createWebTemplate} className="wt-create">
              <label className="field">
                <span>ชื่อ</span>
                <input name="name" required maxLength={100} placeholder="เช่น ขอ D/O เว็บ ONE" />
              </label>
              <label className="field">
                <span>ลิงก์หน้าแรก</span>
                <input name="startUrl" type="url" placeholder="https://" />
              </label>
              <button className="button primary" type="submit">สร้าง</button>
            </form>
            <form action={createWebTemplate} className="wt-create-example">
              <input type="hidden" name="name" value="ขอ D/O เว็บ CMA CGM (ตัวอย่าง)" />
              <input type="hidden" name="example" value="cma" />
              <button className="button tiny" type="submit">+ สร้างจากตัวอย่าง CMA CGM</button>
              <small>ขั้นตอนเดียวกับปุ่ม “ส่งแลกเว็บ CMA” ที่มีอยู่ ใช้ดูว่า Template เขียนอย่างไร</small>
            </form>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ชื่อ</th>
                  <th>ปุ่ม</th>
                  <th>ขั้นตอน</th>
                  <th>สถานะ</th>
                  <th>แก้ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {templates.length === 0 ? (
                  <tr><td className="empty" colSpan={5}>ยังไม่มี Template</td></tr>
                ) : templates.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/master/web-templates/${t.id}`}>{t.name}</Link></td>
                    <td>
                      {t.definition ? (
                        <>
                          <b>{t.definition.button.label}</b>
                          <small className="wt-sub">
                            {BUTTON_PAGES.find((p) => p.key === t.definition!.button.page)?.label}
                            {' · '}{t.definition.button.roles.join(', ') || 'ADMIN'}
                          </small>
                        </>
                      ) : <span className="badge rejected">JSON เสีย</span>}
                    </td>
                    <td>{t.definition?.steps.length ?? '-'}</td>
                    <td>
                      <span className={`badge ${t.isActive ? 'approved' : 'pending'}`}>
                        {t.isActive ? 'เปิดใช้' : 'ปิดอยู่'}
                      </span>
                    </td>
                    <td>{formatDateTime(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
