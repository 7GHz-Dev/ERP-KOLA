'use client';

import { useEffect, useRef, useState } from 'react';
import { extractPdfPieces, loadPdfjs } from '@/lib/parse-arrival';
import {
  EVERY_PAGE, LAST_PAGE, TEMPLATE_FIELDS, fieldLabel, pageLabel, readByTemplate,
  type ParseTemplate, type TemplateArea, type TemplateFieldKey, type TextPiece,
} from '@/lib/parse-template';
import { saveParseTemplate } from '@/lib/actions/parse-template';

/**
 * เครื่องมือลากกรอบบอกว่า "ค่าของช่องนี้อยู่ตรงไหนบนเอกสาร"
 *
 * ผู้ดูแลเปิดเอกสารตัวอย่างของรูปแบบที่ระบบยังอ่านไม่ได้ เลือกช่องที่จะกำหนด
 * แล้วลากกรอบคลุมค่านั้นบนหน้าเอกสาร ระบบอ่านค่าในกรอบให้เห็นทันทีว่าได้อะไร
 * จึงรู้ว่ากรอบตรงหรือยังก่อนบันทึก ไม่ต้องบันทึกแล้วไปลองอัปไฟล์จริงดู
 *
 * ไฟล์ตัวอย่างอยู่ในเครื่องเท่านั้น ไม่ถูกอัปขึ้นเซิร์ฟเวอร์ — ที่บันทึกคือพิกัดกรอบ
 * เพราะกรอบใช้ได้กับทุกใบที่เป็นรูปแบบเดียวกัน ไม่ต้องเก็บตัวอย่างไว้
 */

const RENDER_WIDTH = 900;

type Props = {
  /** แบบร่างที่กำลังแก้ — ไม่ส่งมาคือสร้างใหม่ */
  template?: ParseTemplate;
};

export function ParseTemplateEditor({ template }: Props) {
  const [name, setName] = useState(template?.name ?? '');
  const [match, setMatch] = useState((template?.match ?? []).join('\n'));
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [areas, setAreas] = useState<TemplateArea[]>(template?.areas ?? []);

  /** ช่องที่กรอบถัดไปจะถูกกำหนดให้ */
  const [field, setField] = useState<TemplateFieldKey>('blNo');

  /*
   * กรอบที่ลากถัดไปจะผูกกับหน้าแบบไหน
   *
   * เอกสารสายเรือใบเดียวกันมีจำนวนหน้าไม่เท่ากัน ขึ้นกับว่ามีสินค้ากี่รายการ
   * ระบุเป็นเลขหน้าตายตัวอย่างเดียวจึงใช้ไม่ได้กับค่าที่อยู่ท้ายใบหรือไล่ข้ามหน้า
   */
  const [pageMode, setPageMode] = useState<'this' | 'last' | 'every'>('this');

  const [pageImages, setPageImages] = useState<string[]>([]);
  const [pieces, setPieces] = useState<TextPiece[]>([]);
  const [docText, setDocText] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('ยังไม่ได้เปิดไฟล์ตัวอย่าง');
  const [tone, setTone] = useState<'' | 'ok' | 'error'>('');

  /** กรอบที่กำลังลาก — เก็บเป็นสัดส่วนของหน้าเหมือนกรอบที่บันทึกแล้ว */
  const [dragging, setDragging] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /**
   * เปิดไฟล์ตัวอย่าง — วาดทุกหน้าเป็นภาพ และเก็บข้อความพร้อมพิกัดไว้
   *
   * ต้องมีทั้งสองอย่าง ภาพไว้ให้คนลากกรอบ ข้อความพร้อมพิกัดไว้ให้ระบบอ่านค่าในกรอบ
   */
  async function openSample(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setTone('error');
      setStatus('กรุณาเลือกไฟล์ PDF เท่านั้น');
      return;
    }
    setTone('');
    setStatus('กำลังเปิดไฟล์…');
    setPageImages([]);
    try {
      const buffer = await file.arrayBuffer();
      // อ่านข้อความก่อน เพราะถ้าไฟล์นี้เป็นภาพสแกนล้วนจะได้บอกตั้งแต่ต้น
      const read = await extractPdfPieces(buffer.slice(0));
      setPieces(read.pieces);
      setDocText(read.text);

      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: buffer.slice(0), password: '' }).promise;
      const images: string[] = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const pdfPage = await doc.getPage(i);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: RENDER_WIDTH / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('เบราว์เซอร์นี้วาดหน้าเอกสารไม่ได้');
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.85));
      }
      setPageImages(images);
      setPage(1);

      if (!read.pieces.length) {
        setTone('error');
        setStatus('ไฟล์นี้ไม่มีข้อความให้อ่าน อาจเป็นภาพสแกน — การลากกรอบใช้กับไฟล์แบบนี้ไม่ได้');
        return;
      }
      setTone('ok');
      setStatus(`เปิดไฟล์แล้ว ${images.length} หน้า · ข้อความ ${read.pieces.length} ชิ้น — เลือกช่องแล้วลากกรอบคลุมค่าบนเอกสาร`);
    } catch (e) {
      setTone('error');
      setStatus(`เปิดไฟล์ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** แปลงตำแหน่งเมาส์เป็นสัดส่วนของหน้า */
  function pointOf(event: React.PointerEvent) {
    const box = sheetRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function onDown(event: React.PointerEvent) {
    if (!pageImages.length) return;
    const at = pointOf(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
  }

  function onMove(event: React.PointerEvent) {
    if (!dragging) return;
    const at = pointOf(event);
    if (!at) return;
    setDragging((cur) => (cur ? { ...cur, x1: at.x, y1: at.y } : cur));
  }

  function onUp() {
    if (!dragging) return;
    const x = Math.min(dragging.x0, dragging.x1);
    const y = Math.min(dragging.y0, dragging.y1);
    const w = Math.abs(dragging.x1 - dragging.x0);
    const h = Math.abs(dragging.y1 - dragging.y0);
    setDragging(null);

    // กรอบเล็กกว่านี้มักเป็นการคลิกพลาด ไม่ใช่การลากจริง
    if (w < 0.008 || h < 0.004) return;

    /*
     * หนึ่งช่องมีได้กรอบเดียว ยกเว้นเลขตู้กับเลขซีลที่บางใบแยกเป็นหลายแถว
     * ลากกรอบใหม่ให้ช่องที่มีอยู่แล้วจึงเป็นการแทนที่ ไม่ใช่เพิ่มซ้อน
     * เพราะผู้ใช้ที่ลากพลาดแล้วลากใหม่คาดหวังให้ของเดิมหายไป
     */
    const many = field === 'containers' || field === 'seals';
    const boundPage = pageMode === 'last' ? LAST_PAGE : pageMode === 'every' ? EVERY_PAGE : page;
    setAreas((cur) => [
      ...(many ? cur : cur.filter((a) => a.field !== field)),
      { field, page: boundPage, x, y, w, h },
    ]);
  }

  /** ค่าที่อ่านได้จริงตามกรอบที่ลากไว้ ณ ตอนนี้ */
  const preview = pieces.length
    ? readByTemplate({ id: 'draft', name, match: [], areas, isActive: true }, pieces)
    : null;

  /** คำที่ใช้จับแบบมีอยู่ในไฟล์ตัวอย่างจริงไหม — ผิดตรงนี้แบบจะไม่ถูกเลือกใช้เลย */
  const matchWords = match.split('\n').map((v) => v.trim()).filter(Boolean);
  const haystack = docText.toUpperCase().replace(/\s+/g, ' ');
  const missingWords = docText
    ? matchWords.filter((w) => !haystack.includes(w.toUpperCase().replace(/\s+/g, ' ')))
    : [];

  /*
   * กรอบที่ต้องวาดทับหน้านี้ — รวมกรอบแบบทุกหน้าและหน้าสุดท้ายด้วย
   * ผู้ใช้จึงเห็นว่ากรอบพวกนั้นตกตรงไหนของหน้าที่กำลังดูอยู่
   */
  const totalPages = pageImages.length;
  const onThisPage = areas.filter((a) => (
    a.page === page
    || a.page === EVERY_PAGE
    || (a.page === LAST_PAGE && page === totalPages)
  ));

  return (
    <form action={saveParseTemplate} className="tpl-editor">
      <input type="hidden" name="id" value={template?.id ?? ''} />
      <input type="hidden" name="areas" value={JSON.stringify(areas)} />

      <div className="tpl-head">
        <label className="field">
          <span>ชื่อแบบร่าง</span>
          <input
            name="name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="เช่น MAERSK Arrival Notice" maxLength={120} required
          />
        </label>

        <label className="field">
          <span>คำที่ใช้จับแบบ (บรรทัดละคำ)</span>
          <textarea
            name="match" value={match} onChange={(e) => setMatch(e.target.value)}
            rows={3} maxLength={500}
            placeholder={'ARRIVAL NOTICE\nMAERSK'}
          />
          <small>
            ต้องเจอครบทุกคำในไฟล์จึงจะใช้แบบนี้ — ใส่คำที่มีเฉพาะในเอกสารรูปแบบนี้
            เช่นชื่อสายเรือกับชื่อเอกสาร
            {missingWords.length ? (
              <b className="tpl-warn"> ไม่พบในไฟล์ตัวอย่าง: {missingWords.join(' · ')}</b>
            ) : null}
          </small>
        </label>

        <label className="tpl-check">
          <input
            type="checkbox" name="isActive" checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>เปิดใช้งาน</span>
        </label>
      </div>

      <div className="tpl-bar">
        <label className="field">
          <span>ไฟล์ตัวอย่าง (PDF)</span>
          <input
            type="file" accept="application/pdf,.pdf"
            onChange={(e) => void openSample(e.target.files?.[0])}
          />
        </label>
        <p className={`tpl-status${tone ? ` ${tone}` : ''}`}>{status}</p>
      </div>

      <div className="tpl-work">
        {/* ---------- ช่องที่จะลากกรอบให้ ---------- */}
        <div className="tpl-fields">
          <p className="meta">เลือกช่อง แล้วลากกรอบบนเอกสาร</p>
          {TEMPLATE_FIELDS.map((f) => {
            const got = areas.filter((a) => a.field === f.key);
            const value = preview
              ? (f.key === 'containers' ? preview.containers.join(', ')
                : f.key === 'seals' ? preview.seals.join(', ')
                : preview.values[f.key] ?? '')
              : '';
            return (
              <button
                type="button"
                key={f.key}
                className={`tpl-field${field === f.key ? ' picked' : ''}${got.length ? ' has' : ''}`}
                onClick={() => setField(f.key)}
              >
                <b>{f.label}</b>
                {got.length ? (
                  <span className="tpl-value">
                    {value || <i>อ่านไม่ได้ — ลองขยายกรอบ</i>}
                  </span>
                ) : (
                  <span className="tpl-none">ยังไม่กำหนด</span>
                )}
                {got.length > 1 ? <small>{got.length} กรอบ</small> : null}
              </button>
            );
          })}
        </div>

        {/* ---------- หน้าเอกสาร ---------- */}
        <div className="tpl-sheet-wrap">
          {pageImages.length > 1 ? (
            <>
              <div className="tpl-pages">
                {pageImages.map((_, i) => (
                  <button
                    type="button" key={i}
                    className={`button tiny${page === i + 1 ? ' primary' : ''}`}
                    onClick={() => setPage(i + 1)}
                  >
                    หน้า {i + 1}
                  </button>
                ))}
              </div>

              {/*
                * กรอบที่ลากถัดไปผูกกับหน้าแบบไหน
                * เอกสารใบเดียวกันมีจำนวนหน้าไม่เท่ากันตามจำนวนสินค้า
                * ค่าที่อยู่ท้ายใบหรือไล่ข้ามหน้าจึงผูกกับเลขหน้าตายตัวไม่ได้
                */}
              <div className="tpl-pagemode">
                <span>กรอบถัดไปผูกกับ</span>
                {([
                  ['this', `หน้า ${page} เท่านั้น`, 'ค่าที่อยู่หน้าเดิมเสมอ เช่นเลข BL ชื่อเรือ'],
                  ['last', 'หน้าสุดท้าย', 'ค่าท้ายใบ เช่นยอดรวม — ใบมีกี่หน้าก็หาเจอ'],
                  ['every', 'ทุกหน้า', 'ค่าที่ไล่ต่อกันข้ามหน้า เช่นเลขตู้'],
                ] as const).map(([key, label, hint]) => (
                  <button
                    type="button" key={key} title={hint}
                    className={`button tiny${pageMode === key ? ' primary' : ''}`}
                    onClick={() => setPageMode(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {pageImages.length ? (
            <div
              className="tpl-sheet"
              ref={sheetRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pageImages[page - 1]} alt={`หน้า ${page}`} draggable={false} />

              {onThisPage.map((a, i) => (
                <span
                  key={`${a.field}-${i}`}
                  className="tpl-box"
                  style={{
                    left: `${a.x * 100}%`, top: `${a.y * 100}%`,
                    width: `${a.w * 100}%`, height: `${a.h * 100}%`,
                  }}
                >
                  <b>
                    {fieldLabel(a.field)}
                    {a.page === EVERY_PAGE || a.page === LAST_PAGE
                      ? ` · ${pageLabel(a.page)}` : ''}
                  </b>
                  <button
                    type="button"
                    className="tpl-box-del"
                    title="ลบกรอบนี้"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setAreas((cur) => cur.filter((x) => x !== a))}
                  >
                    ×
                  </button>
                </span>
              ))}

              {dragging ? (
                <span
                  className="tpl-box drawing"
                  style={{
                    left: `${Math.min(dragging.x0, dragging.x1) * 100}%`,
                    top: `${Math.min(dragging.y0, dragging.y1) * 100}%`,
                    width: `${Math.abs(dragging.x1 - dragging.x0) * 100}%`,
                    height: `${Math.abs(dragging.y1 - dragging.y0) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          ) : (
            <p className="tpl-empty">
              เปิดไฟล์ตัวอย่างของเอกสารรูปแบบที่ระบบยังอ่านไม่ได้
              แล้วลากกรอบคลุมค่าแต่ละช่อง ระบบจะอ่านให้ดูทันทีว่าได้ค่าอะไร
            </p>
          )}
        </div>
      </div>

      <div className="tpl-foot">
        <span>
          {areas.length ? `กำหนดไว้ ${areas.length} กรอบ` : 'ยังไม่ได้ลากกรอบ'}
          {preview?.missing.length ? ` · อ่านไม่ได้ ${preview.missing.length} ช่อง` : ''}
        </span>
        <button className="button primary" type="submit">บันทึกแบบร่าง</button>
      </div>
    </form>
  );
}
