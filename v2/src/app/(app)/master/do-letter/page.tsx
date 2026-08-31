import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import {
  DO_LETTER_FIELDS, DO_LETTER_GROUPS, LETTER_BLOCKS, SHIPPING_LINES,
  TEMPLATE_AT, TEMPLATE_NAME, blockCode, lineKey, loadDoLetterForm,
} from '@/lib/do-letter';
import { ConfirmSubmit } from '@/components/Interactions';
import { FormPreviewPane } from '@/components/FormPreviewPane';
import { DO_LETTER_MENU_KEY, MasterMenu } from '@/components/MasterMenu';
import {
  removeDoLetterTemplate, saveDoLetterForm, uploadDoLetterTemplate,
} from '@/lib/actions/do-letter';

export const dynamic = 'force-dynamic';

/**
 * หน้าตั้งค่าจดหมายขอแลก D/O
 *
 * มีสองระดับ — ค่ากลางที่ใช้กับทุกสายเรือ และค่าเฉพาะของแต่ละสายเรือที่ทับค่ากลาง
 * ช่องของสายเรือที่เว้นว่างจะขึ้นค่ากลางเป็น placeholder ให้เห็นว่าจะได้อะไร
 * ผู้ดูแลจึงกรอกเฉพาะช่องที่ต่างจริง ไม่ต้องพิมพ์ซ้ำ 25 รอบ
 */
export default async function DoLetterFormPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['ADMIN']);
  const params = await searchParams;
  const asked = typeof params.line === 'string' ? params.line.toUpperCase() : '';
  const line = SHIPPING_LINES.includes(asked as (typeof SHIPPING_LINES)[number]) ? asked : '';

  const [form, counts] = await Promise.all([loadDoLetterForm(), masterCounts()]);
  const templateName = form.raw(TEMPLATE_NAME);
  const uploadedAt = form.raw(TEMPLATE_AT);
  const fields = DO_LETTER_FIELDS.filter((f) => !line || !f.sharedOnly);
  const groups = DO_LETTER_GROUPS.filter((g) => fields.some((f) => f.group === g));

  return (
    <>
      <div className="page-head">
        <h1>ฟอร์มจดหมายแลก DO</h1>
        <p>
          ตั้งค่ากลางไว้ชุดเดียว แล้วแก้เฉพาะสายเรือที่ถ้อยคำหรือหัวบริษัทต่างออกไป ·
          ช่องที่เว้นว่างจะใช้ค่ากลาง
        </p>
      </div>

      <div className="master-layout">
        <MasterMenu current={DO_LETTER_MENU_KEY} counts={counts} />

        <div className="doc-form">
          {/* ---------- แบบฟอร์มพื้นหลัง ---------- */}
          <fieldset className="doc-form-group">
            <legend>แบบฟอร์มพื้นหลัง (กระดาษหัวจดหมาย)</legend>

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
                  หัวบริษัทและโลโก้มาจากไฟล์ จึงตรงกับกระดาษจริงทุกจุด
                </p>
                <form action={removeDoLetterTemplate} className="inline-form">
                  <ConfirmSubmit
                    label="เอาแบบฟอร์มพื้นหลังออก"
                    tone="danger"
                    confirm="เอาแบบฟอร์มพื้นหลังออกใช่ไหม"
                    detail="ระบบจะกลับไปวาดจดหมายทั้งใบเอง พิกัดที่ตั้งไว้ยังเก็บอยู่ ถ้าอัปโหลดใหม่ใช้ต่อได้เลย"
                  />
                </form>
              </div>
            ) : (
              <p className="meta">
                ตอนนี้ระบบวาดจดหมายทั้งใบเองตามค่าด้านล่าง
                ถ้ามีกระดาษหัวจดหมายของบริษัทอยู่แล้ว ให้ Save as PDF แล้วอัปโหลดที่นี่
                ระบบจะเปลี่ยนไปเติมค่าลงบนไฟล์นั้นแทน และไม่วาดหัวจดหมายซ้ำ
              </p>
            )}

            <form action={uploadDoLetterTemplate} className="template-upload">
              <label className="field">
                <span>{form.hasTemplate ? 'เปลี่ยนไฟล์ (PDF ไม่เกิน 8 MB)' : 'อัปโหลดไฟล์ (PDF ไม่เกิน 8 MB)'}</span>
                <input type="file" name="template" accept="application/pdf,.pdf" required />
                <small>
                  ใช้เฉพาะหน้าแรก · ลบข้อความตัวอย่างในไฟล์ออกก่อน ให้เหลือแต่หัวจดหมาย
                  ไม่งั้นค่าเก่าจะทับกับค่าที่ระบบเติมให้
                </small>
              </label>
              <button className="button primary" type="submit">อัปโหลด</button>
            </form>
          </fieldset>

          {/* เลือกว่ากำลังแก้ค่ากลาง หรือของสายเรือไหน */}
          <div className="tabs">
            <Link href="/master/do-letter" aria-current={line ? undefined : 'page'}>
              ค่ากลาง (ทุกสายเรือ)
            </Link>
            {SHIPPING_LINES.map((s) => (
              <Link
                key={s}
                href={`/master/do-letter?line=${encodeURIComponent(s)}`}
                aria-current={s === line ? 'page' : undefined}
              >
                {s}
              </Link>
            ))}
          </div>

          <form action={saveDoLetterForm} className="doc-form">
            <input type="hidden" name="line" value={line} />

            <div className="doc-form-bar">
              <span>ฟอนต์ Angsana New · กระดาษ A4 แนวตั้ง</span>
              <FormPreviewPane
                src={`/api/do-letter/preview?grid=1${line ? `&line=${encodeURIComponent(line)}` : ''}`}
                title={`ตัวอย่างพร้อมเส้นพิกัด${line ? ` · ${line}` : ''}`}
                label="ดูตัวอย่างพร้อมเส้นพิกัด"
              />
              <FormPreviewPane
                src={`/api/do-letter/preview${line ? `?line=${encodeURIComponent(line)}` : ''}`}
                title={`ตัวอย่างจดหมาย${line ? ` · ${line}` : ' (ค่ากลาง)'}`}
                label="ดูตัวอย่าง PDF"
              />
              <button className="button primary" type="submit">บันทึก</button>
            </div>
            {groups.map((group) => (
              <fieldset key={group} className="doc-form-group">
                <legend>{group}{line ? ` · ${line}` : ''}</legend>
                <div className="doc-grid">
                  {fields.filter((f) => f.group === group).map((f) => {
                    const own = line ? form.raw(lineKey(line, f.key)) : form.raw(f.key);
                    // ช่องของสายเรือที่ว่างอยู่ ให้เห็นค่าที่จะถูกใช้จริงเป็น placeholder
                    const inherited = line ? form.value(f.key) : f.fallback;
                    const long = f.key === 'body';
                    return (
                      <label key={f.key} className={f.wide ? 'doc-field wide' : 'doc-field'}>
                        <span>{f.label}</span>
                        {long ? (
                          <textarea name={f.key} rows={5} defaultValue={own} placeholder={inherited} />
                        ) : (
                          <input name={f.key} defaultValue={own} placeholder={inherited} />
                        )}
                        {f.hint ? <small>{f.hint}</small> : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {/* ---------- ตำแหน่งบนกระดาษ ---------- */}
            <fieldset className="doc-form-group">
              <legend>ตำแหน่งบนกระดาษ (พอยต์ นับจากมุมบนซ้าย)</legend>
              <p className="meta slot-hint">
                กด <b>ดูตัวอย่าง PDF</b> แล้วเทียบระยะเอา · 1 ซม. เท่ากับ 28.35 พอยต์ ·
                นับจากมุมบนซ้ายของกระดาษ · ระยะบรรทัดใช้กับบล็อกที่มีหลายบรรทัดเท่านั้น
              </p>
              <div className="table-wrap slot-wrap">
                <table className="data slot-table">
                  <thead>
                    <tr><th>บล็อก</th><th>x</th><th>y</th><th>ระยะบรรทัด</th></tr>
                  </thead>
                  <tbody>
                    {LETTER_BLOCKS.map((bk) => {
                      const at = form.block(bk.key, line || undefined);
                      return (
                        <tr key={bk.key}>
                          <th scope="row">{bk.label}</th>
                          {(['x', 'y', 'gap'] as const).map((part) => (
                            <td key={part}>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                name={blockCode(bk.key, part)}
                                defaultValue={at[part]}
                                // บล็อกบรรทัดเดียวไม่ต้องตั้งระยะบรรทัด
                                disabled={part === 'gap' && bk.gap === undefined}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </fieldset>

            <div className="doc-form-bar">
              <span>
                {line
                  ? `ช่องที่เว้นว่างจะใช้ค่ากลาง ซึ่งแสดงเป็นตัวจาง`
                  : 'ช่องที่เว้นว่างจะใช้ค่าเริ่มต้นที่แสดงเป็นตัวจาง'}
              </span>
              <button className="button primary" type="submit">บันทึก</button>
            </div>
          </form>

        </div>
      </div>
    </>
  );
}
