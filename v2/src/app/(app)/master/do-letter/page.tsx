import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { masterCounts } from '@/lib/queries/master';
import {
  DO_LETTER_FIELDS, DO_LETTER_GROUPS, LETTER_BLOCKS, SHIPPING_LINES,
  blockCode, lineKey, loadDoLetterForm,
} from '@/lib/do-letter';
import { FormPreviewPane } from '@/components/FormPreviewPane';
import { DO_LETTER_MENU_KEY, MasterMenu } from '@/components/MasterMenu';
import { saveDoLetterForm } from '@/lib/actions/do-letter';

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
  // เปลี่ยนทุกครั้งที่หน้าถูกเรนเดอร์ใหม่ (คือหลังกดบันทึก) ให้แผงตัวอย่างโหลดเอง
  const reloadKey = Date.now();
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
              <span>ฟอนต์ Angsana New · กระดาษ A4 แนวตั้ง · ออกครั้งละ 2 ใบ (KOLA · MAESOT FREEZONE)</span>
              <FormPreviewPane
                src={`/api/do-letter/preview?grid=1${line ? `&line=${encodeURIComponent(line)}` : ''}`}
                title={`ตัวอย่างพร้อมเส้นพิกัด${line ? ` · ${line}` : ''}`}
                label="ดูตัวอย่างพร้อมเส้นพิกัด"
                reloadKey={reloadKey}
              />
              <FormPreviewPane
                src={`/api/do-letter/preview${line ? `?line=${encodeURIComponent(line)}` : ''}`}
                title={`ตัวอย่างจดหมาย${line ? ` · ${line}` : ' (ค่ากลาง)'}`}
                label="ดูตัวอย่าง PDF"
                reloadKey={reloadKey}
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
                    // ชื่อบริษัทตัวแทนมีค่าตั้งต้นตามสายเรือ จึงต้องถามผ่านตัวช่วยของฟอร์ม
                    const inherited = f.key === 'attentionCompany'
                      ? (line ? form.attentionCompany(line) : '')
                      : (line ? form.value(f.key) : f.fallback);
                    const long = ['notice', 'options', 'request'].includes(f.key) || f.key.startsWith('note');
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
                กด <b>ดูตัวอย่างพร้อมเส้นพิกัด</b> แล้วเทียบระยะเอา · 1 ซม. เท่ากับ 28.35 พอยต์ ·
                นับจากมุมบนซ้ายของกระดาษ · ระยะบรรทัดใช้กับบล็อกที่มีหลายบรรทัดเท่านั้น ·
                บล็อก <b>ข้อความเพิ่มเติม</b> จะวาดก็ต่อเมื่อกรอกข้อความไว้
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
