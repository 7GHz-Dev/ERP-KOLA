import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import { MasterMenu, WEB_TEMPLATE_MENU_KEY } from '@/components/MasterMenu';
import { WebTemplateEditor } from '@/components/WebTemplateEditor';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ConfirmSubmit } from '@/components/Interactions';
import { loadWebTemplate, templateTasks } from '@/lib/web-template-store';
import {
  cancelWebTask, deleteWebTemplate, importWebTemplateCode, recordWebTemplate, testWebTemplate,
} from '@/lib/actions/web-template';
import { usedVars, WEB_TASK } from '@/lib/web-template';
import { FILE_LABELS, FILE_ORDER } from '@/lib/file-categories';
import { ASSIGNABLE_ROLES } from '@/lib/org';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, { label: string; tone: string }> = {
  QUEUED: { label: 'รอ worker', tone: 'pending' },
  PROCESSING: { label: 'กำลังทำ', tone: 'neutral' },
  DONE: { label: 'สำเร็จ', tone: 'approved' },
  ERROR: { label: 'ไม่สำเร็จ', tone: 'rejected' },
};

/**
 * หน้าแก้ Template กรอกเว็บ
 *
 * ลำดับการใช้งาน: บันทึกขั้นตอน (worker เปิด Chrome ให้ทำจริงหนึ่งรอบ) → แก้/ผูกตัวแปร
 * → ทดลองรันกับงานจริง (หยุดก่อนปุ่มส่ง) → เปิดใช้ ปุ่มจึงขึ้นในหน้างาน
 */
export default async function WebTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserReady(['ADMIN']);
  const { id } = await params;
  const [template, counts, tasks] = await Promise.all([loadWebTemplate(id), masterCounts(), templateTasks(id)]);
  if (!template) notFound();

  const def = template.definition;
  const waiting = tasks.some((t) => t.status === 'QUEUED' || t.status === 'PROCESSING');
  const fileCategories = FILE_ORDER.map((k) => [k, FILE_LABELS[k] ?? k] as [string, string]);
  // ตัวแปร {{input.x}} ที่ขั้นตอนใช้แต่ยังไม่ได้ประกาศเป็นช่องที่ถาม — กดปุ่มแล้วจะได้ค่าว่าง
  const missing = def
    ? usedVars(def).filter((v) => v.startsWith('input.') && !def.inputs.some((i) => `input.${i.key}` === v))
    : [];

  return (
    <>
      <AutoRefresh active={waiting} />
      <div className="page-head">
        <h1>{template.name}</h1>
        <p><Link href="/master/web-templates">← Template กรอกเว็บ</Link></p>
      </div>

      <div className="master-layout">
        <MasterMenu current={WEB_TEMPLATE_MENU_KEY} counts={counts} />

        <div className="doc-form">
          {missing.length ? (
            <div className="alert-bar bad" role="alert">
              <span>ขั้นตอนใช้ตัวแปรที่ยังไม่ได้เพิ่มเป็นช่องที่ถาม: {missing.join(', ')}</span>
            </div>
          ) : null}

          <div className="wt-actions">
            <div className="doc-form-section">
              <h2>1. บันทึกขั้นตอน</h2>
              <p className="meta">
                worker เปิด Chrome ที่ลิงก์นี้พร้อมหน้าต่าง <b>Playwright Inspector</b> (แบบ npx playwright codegen) ·
                ถ้าตั้ง “ข้อความที่เห็นเมื่อล็อกอินแล้ว” ไว้ จะเริ่มบันทึกหลังล็อกอินเสร็จ ·
                ทำตามขั้นตอนจริง — <b>ปุ่มส่งสุดท้ายอย่ากดจริง</b> ให้ใช้ Assert visibility (รูปตา) คลิกที่ปุ่มแทน ·
                เสร็จแล้วปิดหน้าต่าง Chrome · <b>ขั้นตอนเดิมจะถูกแทนที่</b>
              </p>
              <form action={recordWebTemplate} className="wt-inline">
                <input type="hidden" name="id" value={template.id} />
                <label className="field grow">
                  <span>ลิงก์หน้าแรก</span>
                  <input name="startUrl" type="url" defaultValue={def?.startUrl ?? ''} required />
                </label>
                <label className="field">
                  <span>BL งานตัวอย่าง (ไม่บังคับ)</span>
                  <input name="sampleBl" placeholder="ค่าที่ตรงกับงานจะกลายเป็นตัวแปร" />
                </label>
                <label className="field">
                  <span>ตัวบันทึก</span>
                  <select name="recorder" defaultValue="codegen">
                    <option value="codegen">Playwright codegen (แนะนำ)</option>
                    <option value="kola">แถบบันทึก KOLA</option>
                  </select>
                </label>
                <button className="button primary" type="submit">บันทึกขั้นตอน</button>
              </form>
              <details className="wt-import">
                <summary>หรือวางโค้ดที่ได้จาก npx playwright codegen เอง</summary>
                <p className="meta">
                  รัน <code>npx playwright codegen --target javascript &lt;ลิงก์&gt;</code> บนเครื่องไหนก็ได้ คัดลอกโค้ดทั้งหมดมาวาง ·
                  ระบบอ่านอย่างเดียว ไม่ได้รันโค้ด · ค่าที่พิมพ์ในช่องรหัสผ่านไม่ถูกเก็บ
                </p>
                <form action={importWebTemplateCode} className="wt-import-form">
                  <input type="hidden" name="id" value={template.id} />
                  <textarea name="code" rows={10} required spellCheck={false} className="wt-json"
                    placeholder={"await page.goto('https://...');\nawait page.getByRole('button', { name: 'Add' }).click();"} />
                  <div className="wt-inline">
                    <label className="field">
                      <span>BL งานตัวอย่าง (ไม่บังคับ)</span>
                      <input name="sampleBl" />
                    </label>
                    <button className="button" type="submit">แปลงเป็นขั้นตอน (แทนชุดเดิม)</button>
                  </div>
                </form>
              </details>
            </div>

            <div className="doc-form-section">
              <h2>2. ทดลองรัน</h2>
              <p className="meta">
                เล่นทุกขั้นกับงานจริงแต่ <b>หยุดก่อนปุ่มส่ง</b> ไม่ส่งจริง และไม่เปลี่ยนสถานะงาน ·
                หน้าเว็บค้างไว้บนเครื่อง worker ให้ตรวจ
              </p>
              {def ? (
                <form action={testWebTemplate} className="wt-inline">
                  <input type="hidden" name="id" value={template.id} />
                  <label className="field">
                    <span>BL งานที่ใช้ทดลอง</span>
                    <input name="sampleBl" required />
                  </label>
                  {def.inputs.map((input) => (
                    <label key={input.key} className="field grow">
                      <span>{input.label}</span>
                      {input.multiline
                        ? <textarea name={`input.${input.key}`} rows={2} required />
                        : <input name={`input.${input.key}`} required />}
                    </label>
                  ))}
                  <button className="button" type="submit">ทดลองรัน</button>
                </form>
              ) : <p className="meta">แก้ JSON ให้ผ่านตัวตรวจก่อน</p>}
            </div>
          </div>

          <WebTemplateEditor
            key={template.updatedAt.toISOString()}
            id={template.id}
            name={template.name}
            isActive={template.isActive}
            raw={template.raw}
            definition={def}
            fileCategories={fileCategories}
            roles={ASSIGNABLE_ROLES.filter((r) => r !== 'ADMIN')}
          />

          <div className="doc-form-section">
            <h2>งานล่าสุดของ Template นี้</h2>
            {waiting ? <p className="meta">มีงานรอ worker อยู่ — หน้านี้โหลดสถานะใหม่ทุก 5 วินาที (เปิด npm run worker:web ไว้หรือยัง?)</p> : null}
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>เวลา</th><th>ชนิด</th><th>BL</th><th>สถานะ</th><th>รายละเอียด</th><th /></tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td className="empty" colSpan={6}>ยังไม่มี</td></tr>
                  ) : tasks.map((t) => (
                    <tr key={t.id}>
                      <td>{formatDateTime(t.createdAt)}</td>
                      <td>{t.type === WEB_TASK.RECORD ? 'บันทึก' : t.dryRun ? 'ทดลอง' : 'ใช้จริง'}</td>
                      <td>{t.blNo ?? '-'}</td>
                      <td><span className={`badge ${STATUS[t.status]?.tone ?? ''}`}>{STATUS[t.status]?.label ?? t.status}</span></td>
                      <td className="wt-detail">
                        {t.error ? <small className="client-cell-note bad">{t.error}</small> : null}
                        {t.resultRefNo ? <small>{t.resultRefNo}</small> : null}
                        {t.hasShot ? <a href={`/api/web-template/shot/${t.id}`} target="_blank" rel="noreferrer">ภาพหน้าจอ</a> : null}
                      </td>
                      <td>
                        {t.status === 'QUEUED' ? (
                          <form action={cancelWebTask}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <button className="button tiny ghost" type="submit">ยกเลิก</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form action={deleteWebTemplate} className="doc-form-reset">
            <input type="hidden" name="id" value={template.id} />
            <ConfirmSubmit label="ลบ Template" confirm={`ลบ Template “${template.name}”?`} tone="danger"
              detail="ปุ่มของ Template นี้จะหายจากหน้างานทันที" />
          </form>
        </div>
      </div>
    </>
  );
}
