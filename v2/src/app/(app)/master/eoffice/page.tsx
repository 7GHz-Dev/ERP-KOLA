import { requireUser } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import {
  EOFFICE_FORM_GROUPS, EOFFICE_FORM_FIELDS, loadEofficeForm, OVERLAY_SLOTS, slotCode,
  TEMPLATE_AT, TEMPLATE_NAME,
} from '@/lib/eoffice-form';
import { EOFFICE_FORM_MENU_KEY, MasterMenu } from '@/components/MasterMenu';
import {
  removeEofficeTemplate, resetEofficeForm, saveEofficeForm, uploadEofficeTemplate,
} from '@/lib/actions/eoffice-form';
import { ConfirmSubmit } from '@/components/Interactions';

export const dynamic = 'force-dynamic';

/**
 * หน้าตั้งค่าแบบฟอร์มปะหน้า (คำร้องขอนำของเข้าเขตปลอดอากร)
 *
 * มีสองโหมด ขึ้นกับว่าอัปโหลดแบบฟอร์มพื้นหลังไว้หรือยัง
 *   มีพื้นหลัง — กระดาษมาจากไฟล์ที่อัปโหลด เหลือแค่บอกพิกัดว่าค่าไหนลงตรงไหน
 *   ไม่มี      — ระบบวาดทั้งใบเอง ตั้งได้ทั้งข้อความ ขนาดตัวอักษร และระยะ
 *
 * ทุกช่องปล่อยว่างได้ ว่าง = ใช้ค่าตามแบบฟอร์มเดิม ซึ่งขึ้นเป็น placeholder ให้เห็นอยู่แล้ว
 * ผู้ใช้จึงลบค่าที่พิมพ์ผิดทิ้งได้โดยไม่ต้องจำว่าของเดิมเป็นเท่าไร
 */
export default async function EofficeFormPage() {
  await requireUser(['ADMIN']);
  const [form, counts] = await Promise.all([loadEofficeForm(), masterCounts()]);

  const templateName = form.raw(TEMPLATE_NAME);
  const uploadedAt = form.raw(TEMPLATE_AT);
  const fields = EOFFICE_FORM_FIELDS.filter((f) => !form.hasTemplate || f.bothModes);
  const groups = EOFFICE_FORM_GROUPS.filter((g) => fields.some((f) => f.group === g));

  return (
    <>
      <div className="page-head">
        <h1>ฟอร์มปะหน้า E-Office</h1>
        <p>
          ตั้งค่าคำร้องขอนำของเข้าเขตปลอดอากร มีผลกับคำร้องที่ออกหลังจากนี้ทุกใบ
          คำร้องที่ออกไปแล้วไม่เปลี่ยน
        </p>
      </div>

      <div className="master-layout">
        <MasterMenu current={EOFFICE_FORM_MENU_KEY} counts={counts} />

        <div className="doc-form">
          {/* ---------- แบบฟอร์มพื้นหลัง ---------- */}
          <fieldset className="doc-form-group">
            <legend>แบบฟอร์มพื้นหลัง</legend>

            {form.hasTemplate ? (
              <div className="template-on">
                <p className="template-file">
                  <b>{templateName || 'แบบฟอร์มที่อัปโหลดไว้'}</b>
                  {uploadedAt ? (
                    <small> · อัปโหลดเมื่อ {uploadedAt.slice(0, 10).split('-').reverse().join('/')}</small>
                  ) : null}
                </p>
                <p className="meta">
                  ระบบใช้ไฟล์นี้เป็นกระดาษ แล้วเติมเฉพาะค่าลงไปตามพิกัดด้านล่าง
                  ข้อความและเส้นทั้งหมดมาจากไฟล์ จึงตรงกับต้นฉบับทุกจุด
                </p>
                <form action={removeEofficeTemplate} className="inline-form">
                  <ConfirmSubmit
                    label="เอาแบบฟอร์มพื้นหลังออก"
                    tone="danger"
                    confirm="เอาแบบฟอร์มพื้นหลังออกใช่ไหม"
                    detail="ระบบจะกลับไปวาดคำร้องทั้งใบเอง พิกัดที่ตั้งไว้ยังเก็บอยู่ ถ้าอัปโหลดใหม่ใช้ต่อได้เลย"
                  />
                </form>
              </div>
            ) : (
              <p className="meta">
                ตอนนี้ระบบวาดคำร้องทั้งใบเองตามค่าด้านล่าง
                ถ้าอยากให้หน้าตาตรงกับไฟล์ต้นฉบับเป๊ะ ๆ ให้เปิดไฟล์ Word แล้ว Save as PDF
                จากนั้นอัปโหลดที่นี่ ระบบจะเปลี่ยนไปเติมค่าลงบนไฟล์นั้นแทน
              </p>
            )}

            <form action={uploadEofficeTemplate} className="template-upload">
              <label className="field">
                <span>{form.hasTemplate ? 'เปลี่ยนไฟล์ (PDF ไม่เกิน 8 MB)' : 'อัปโหลดไฟล์ (PDF ไม่เกิน 8 MB)'}</span>
                <input type="file" name="template" accept="application/pdf,.pdf" required />
                <small>
                  ลบค่าตัวอย่างในไฟล์ออกก่อน เช่นเลขที่คำร้องและเลขใบขนของใบเก่า
                  ให้เหลือแต่เส้นและข้อความที่ต้องมีทุกใบ ไม่งั้นค่าเก่าจะทับกับค่าที่ระบบเติมให้
                </small>
              </label>
              <button className="button primary" type="submit">อัปโหลด</button>
            </form>
          </fieldset>

          <form action={saveEofficeForm} className="doc-form">
            <div className="doc-form-bar">
              <span>
                {form.hasTemplate
                  ? 'ฟอนต์ Angsana New · ขนาดกระดาษตามไฟล์ที่อัปโหลด'
                  : 'ฟอนต์ Angsana New · กระดาษ A4 แนวตั้ง'}
              </span>
              {form.hasTemplate ? (
                <a className="button" href="/api/eoffice/form-preview?grid=1" target="_blank" rel="noreferrer">
                  ดูตัวอย่างพร้อมเส้นพิกัด
                </a>
              ) : null}
              <a className="button" href="/api/eoffice/form-preview" target="_blank" rel="noreferrer">
                ดูตัวอย่าง PDF
              </a>
              <button className="button primary" type="submit">บันทึก</button>
            </div>

            {/* ---------- พิกัดของค่าบนแบบฟอร์มพื้นหลัง ---------- */}
            {form.hasTemplate ? (
              <fieldset className="doc-form-group">
                <legend>ตำแหน่งค่าบนแบบฟอร์ม (พอยต์ นับจากมุมบนซ้าย)</legend>
                <p className="meta slot-hint">
                  กด <b>ดูตัวอย่างพร้อมเส้นพิกัด</b> แล้วอ่านเลขจากเส้นตารางมากรอกได้เลย
                  1 ซม. เท่ากับ 28.35 พอยต์ · ความกว้าง 0 คือปล่อยให้ยาวได้ไม่จำกัด
                  ถ้าใส่ความกว้างไว้ ข้อความที่ยาวเกินจะถูกย่อให้พอดีช่อง
                </p>
                <div className="table-wrap slot-wrap">
                  <table className="data slot-table">
                    <thead>
                      <tr>
                        <th>ค่าที่เติม</th>
                        <th>x</th>
                        <th>y</th>
                        <th>กว้าง</th>
                        <th>ชิด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {OVERLAY_SLOTS.map((base) => {
                        const slot = form.slot(base.key);
                        return (
                          <tr key={base.key}>
                            <th scope="row">
                              {base.label}
                              <small>{base.sample}</small>
                            </th>
                            {(['x', 'y', 'w'] as const).map((part) => (
                              <td key={part}>
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  name={slotCode(base.key, part)}
                                  defaultValue={form.values[slotCode(base.key, part)] ?? ''}
                                  placeholder={String(base[part])}
                                />
                              </td>
                            ))}
                            <td>
                              <select name={slotCode(base.key, 'align')} defaultValue={slot.align}>
                                <option value="left">ซ้าย</option>
                                <option value="center">กลาง</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </fieldset>
            ) : null}

            {groups.map((group) => (
              <fieldset key={group} className="doc-form-group">
                <legend>{group}</legend>
                <div className="doc-form-grid">
                  {fields.filter((f) => f.group === group).map((field) => (
                    <label
                      key={field.key}
                      className={`field${field.wide ? ' wide' : ''}`}
                    >
                      <span>{field.label}</span>
                      <input
                        name={field.key}
                        defaultValue={form.values[field.key] ?? ''}
                        placeholder={field.fallback}
                        type={field.kind === 'number' ? 'number' : 'text'}
                        step={field.kind === 'number' ? '0.5' : undefined}
                        min={field.kind === 'number' ? '1' : undefined}
                        maxLength={500}
                      />
                      {field.hint ? <small>{field.hint}</small> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            <div className="doc-form-bar">
              <span>ช่องที่เว้นว่างจะใช้ค่าเริ่มต้นที่แสดงเป็นตัวจาง</span>
              <button className="button primary" type="submit">บันทึก</button>
            </div>
          </form>
        </div>
      </div>

      <form action={resetEofficeForm} className="doc-form-reset">
        <ConfirmSubmit
          label="ล้างค่าที่แก้ไว้ทั้งหมด"
          tone="danger"
          confirm="กลับไปใช้แบบฟอร์มเริ่มต้นใช่ไหม"
          detail="ค่าที่แก้ไว้ทุกช่องรวมทั้งพิกัดจะถูกลบ ไฟล์แบบฟอร์มพื้นหลังยังอยู่"
        />
      </form>
    </>
  );
}
