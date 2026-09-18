import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import { MasterMenu, PARSE_TEMPLATE_MENU_KEY } from '@/components/MasterMenu';
import { ParseTemplateEditor } from '@/components/ParseTemplateEditor';
import { getParseTemplate, listParseTemplates } from '@/lib/parse-template-store';
import { deleteParseTemplate } from '@/lib/actions/parse-template';
import { fieldLabel } from '@/lib/parse-template';
import { ConfirmSubmit } from '@/components/Interactions';

export const dynamic = 'force-dynamic';

/**
 * หน้าตั้งค่าการอ่าน AN / BL
 *
 * ตัวอ่านอัตโนมัติเดาจากรูปแบบข้อความ ซึ่งอ่านเอกสารที่เคยเจอได้ดี
 * แต่พอสายเรือเปลี่ยนหน้าตาเอกสารหรือมีสายใหม่เข้ามา ก็ต้องรอแก้โค้ด
 * หน้านี้ให้ผู้ดูแลลากกรอบบอกเองว่าค่าไหนอยู่ตรงไหน ระบบจึงอ่านแบบใหม่ได้ทันที
 *
 * แบบร่างไม่ได้แทนตัวอ่านอัตโนมัติ แต่มาก่อน — ช่องที่กรอบอ่านได้ใช้ค่าจากกรอบ
 * ช่องที่ไม่ได้กำหนดกรอบหรืออ่านไม่ได้ ยังใช้ตัวอ่านอัตโนมัติเหมือนเดิม
 */
export default async function ParseTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireUserReady(['ADMIN']);
  const params = await searchParams;
  const [templates, counts] = await Promise.all([listParseTemplates(), masterCounts()]);

  const editing = params.edit ? await getParseTemplate(params.edit) : null;
  const creating = params.new !== undefined;

  return (
    <>
      <div className="page-head">
        <h1>ตั้งค่าการอ่าน AN / BL</h1>
        <p>
          กำหนดพื้นที่อ่านค่าของเอกสารแต่ละรูปแบบ ใช้กับไฟล์ที่อัปโหลดหลังจากนี้
          งานที่บันทึกไปแล้วไม่เปลี่ยน
        </p>
      </div>

      <div className="master-layout">
        <MasterMenu current={PARSE_TEMPLATE_MENU_KEY} counts={counts} />

        <div className="tpl-page">
          {editing || creating ? (
            <>
              <p className="tpl-back">
                <Link href="/master/parse-template" prefetch={false}>← กลับไปรายการแบบร่าง</Link>
              </p>
              <ParseTemplateEditor template={editing ?? undefined} />
            </>
          ) : (
            <>
              <div className="tpl-list-head">
                <p className="meta">
                  ระบบจับแบบให้เองจากข้อความในไฟล์ ผู้ใช้ไม่ต้องเลือกแบบตอนอัปโหลด
                  ถ้าไฟล์ไม่ตรงกับแบบไหนเลย ระบบใช้ตัวอ่านอัตโนมัติเหมือนเดิม
                </p>
                <Link className="button primary" href="/master/parse-template?new" prefetch={false}>
                  + สร้างแบบร่างใหม่
                </Link>
              </div>

              {templates.length ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>ชื่อแบบร่าง</th>
                        <th>คำที่ใช้จับแบบ</th>
                        <th>ช่องที่กำหนดไว้</th>
                        <th>สถานะ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((t) => {
                        const fields = [...new Set(t.areas.map((a) => a.field))];
                        return (
                          <tr key={t.id}>
                            <th scope="row">
                              <Link href={`/master/parse-template?edit=${t.id}`} prefetch={false}>
                                {t.name}
                              </Link>
                            </th>
                            <td>{t.match.join(' · ') || <i>ยังไม่ได้ใส่</i>}</td>
                            <td>
                              {fields.length
                                ? fields.map((f) => fieldLabel(f)).join(', ')
                                : <i>ยังไม่ได้ลากกรอบ</i>}
                            </td>
                            <td>{t.isActive ? 'เปิดใช้งาน' : 'ปิดไว้'}</td>
                            <td>
                              <form action={deleteParseTemplate}>
                                <input type="hidden" name="id" value={t.id} />
                                <ConfirmSubmit
                                  label="ลบ"
                                  tone="danger"
                                  confirm={`ลบแบบร่าง "${t.name}" ใช่ไหม`}
                                  detail="ไฟล์ที่อัปโหลดหลังจากนี้จะกลับไปใช้ตัวอ่านอัตโนมัติ"
                                />
                              </form>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="tpl-empty">
                  ยังไม่มีแบบร่าง — กด <b>สร้างแบบร่างใหม่</b> แล้วเปิดไฟล์ตัวอย่าง
                  ของเอกสารรูปแบบที่ระบบอ่านไม่ได้
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
