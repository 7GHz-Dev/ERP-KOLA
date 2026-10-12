import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EVERGREEN, lineKey, signBlock, stampBlock, type CompanyNo, type DoLetterForm,
} from '@/lib/do-letter';
import {
  PAGE_H, PAGE_W, createLetterKit,
  type DoLetterData, type PageWriter, type RenderOptions,
} from '@/lib/do-letter-pdf';
import { drawCoordinateGrid } from '@/lib/pdf-grid';

/**
 * ชุดเอกสารแลก D/O ของ EVERGREEN — 4 แบบ เรียงหน้าตามที่ยื่นจริง
 *
 *   1. จดหมายขอรับ D/O (SURRENDER / SEAWAY-BILL) ในนาม KOLA
 *   2. ฉบับเดียวกันในนาม MAESOT FREEZONE
 *   3. ใบลากตู้ (Container/Chassis Interchange Agreement) — ตู้ละหน้า
 *   4. จดหมายยืนยันชื่อบริษัทในการออกใบค่ามัดจำตู้
 *
 * EVERGREEN ไม่รับจดหมายโครงกลางแบบสายอื่น จึงวาดตามแบบฟอร์มของสายเรือเอง
 * ชื่อบริษัท ที่อยู่ ผู้ลงนาม ตราและลายเซ็น ยังมาจาก /master/do-letter ชุดเดียวกับสายอื่น
 * ผู้ดูแลเปลี่ยนผู้มีอำนาจทีเดียวจึงตามมาครบทุกสายเรือ
 *
 * ช่องที่ข้อมูลงานยังไม่มี (เช่นยอดมัดจำ) เว้นเส้นไข่ปลาไว้ให้เขียนด้วยมือเหมือนฟอร์มกระดาษ
 */

const LOGO_PATH = path.join(process.cwd(), 'assets', 'forms', 'evergreen-logo.jpg');

const AGENT_TH = 'บริษัท เอเวอร์กรีน ชิปปิ้ง เอเยนซี่ (ไทยแลนด์) จำกัด';
const AGENT_EN = 'EVERGREEN SHIPPING AGENCY (THAILAND) CO.,LTD.';
/** เบอร์ผู้ลงนามท้ายจดหมายยืนยันค่ามัดจำ ตามต้นฉบับ */
const DEPOSIT_SIGNER_PHONE = '091-8585681';
/** ตำแหน่งผู้ลงนามบนชุดนี้เป็นภาษาไทย — ตั้ง "ตำแหน่ง" ของสาย EVERGREEN ไว้ก็ใช้ค่านั้นแทน */
const SIGNER_TITLE = 'กรรมการบริษัท';

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** แยก วัน/เดือน/ปี ค.ศ. — สตริง YYYY-MM-DD ตัดเอาตัวเลขเอง ไม่ให้โซนเวลาเลื่อนวัน */
function dateParts(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return { d: value.getDate(), m: value.getMonth() + 1, y: value.getFullYear() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? { d: Number(m[3]), m: Number(m[2]), y: Number(m[1]) } : null;
}

/** "วันที่ 1 เดือน ตุลาคม พ.ศ. 2569" — หัวจดหมายของชุดนี้ใช้ปี พ.ศ. */
export function thaiLetterDate(value: Date | string | null | undefined): string {
  const p = dateParts(value);
  if (!p) return '';
  return `วันที่ ${p.d} เดือน ${TH_MONTHS[p.m - 1]} พ.ศ. ${p.y + 543}`;
}

/** "01/10/2026" — วันเรือเข้าบนจดหมายของชุดนี้ ไม่ใช่ข้อความที่อ่านไม่ออกก็คืนค่าเดิม */
export function slashDate(value: Date | string | null | undefined): string {
  const p = dateParts(value);
  if (!p) return typeof value === 'string' ? value.trim() : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

/** 5490 → "5490.00" ตามต้นฉบับ (ไม่มีจุลภาค) */
function weightText(value: DoLetterData['grossWeight']): string {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n > 0
    ? n.toFixed(2) : '';
}

/** 8000 → "8,000" · มีสตางค์จึงแสดงทศนิยม */
function amountText(value: DoLetterData['depositAmount']): string {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/**
 * ช่องไหนของ B/L ที่ต้องติ๊ก — อ่านจาก BL TYPE ของงาน
 * SWB = Sea Waybill · S / SURRENDER = ปล่อยแบบ surrender · อย่างอื่นไม่ติ๊ก ปล่อยให้ติ๊กมือ
 */
export function blChoice(blType: string | null | undefined): 'SURRENDER' | 'SEAWAY' | null {
  const t = (blType ?? '').trim().toUpperCase();
  if (!t) return null;
  if (t === 'SWB' || /SEA\s*WAY/.test(t)) return 'SEAWAY';
  if (t === 'S' || t.startsWith('SURR')) return 'SURRENDER';
  return null;
}

export async function renderEvergreenDoLetterPdf(
  data: DoLetterData,
  f: DoLetterForm,
  options: RenderOptions = {},
): Promise<Buffer> {
  const kit = await createLetterKit();
  const { size, widthOf } = kit;
  const { StandardFonts } = await import('@cantoo/pdf-lib');
  const embedded = await kit.embedStamps(options.stamps);
  const logo = await kit.embedImage(await readFile(LOGO_PATH).catch(() => undefined));

  // ---------- ค่าจากงาน · ที่ผู้ใช้แก้เองบนหน้าจดหมายมาก่อน ----------
  const edited = (row: keyof NonNullable<DoLetterData['overrides']>) =>
    (data.overrides?.[row] ?? '').trim();
  const blNo = edited('blNo') || data.blNo || '';
  const vesselVoy = edited('vessel') || [data.vessel, data.voyage].filter(Boolean).join(' ');
  const etaText = edited('eta') || slashDate(data.eta);
  const weight = weightText(data.grossWeight);
  const letterDay = thaiLetterDate(data.letterDate ?? new Date());
  const choice = blChoice(data.blType);
  const signerTitle = f.raw(lineKey(EVERGREEN, 'signerTitle')) || SIGNER_TITLE;
  const company = (co: CompanyNo) => f.coValue(co, 'companyName', EVERGREEN);

  const newPage = () => {
    const w = kit.addPage();
    if (options.grid) drawCoordinateGrid(w.page, kit.latin.regular, PAGE_W, PAGE_H, kit.rgb);
    return w;
  };

  /**
   * ช่องกรอกแบบฟอร์ม — เส้นไข่ปลายาว width แล้ววางค่ากลางเส้น
   * ค่าว่างก็ยังเหลือเส้นไว้ให้เขียนมือ คืน x ท้ายเส้นให้วาดข้อความถัดไปต่อ
   */
  const fill = (
    w: PageWriter, value: string, at: { x: number; y: number }, width: number, bold = true,
  ) => {
    w.line(at.x, at.y + 3, at.x + width, at.y + 3, 0.8, true);
    if (value) {
      const vw = widthOf(value, size(16), bold);
      w.draw(value, { x: at.x + Math.max(0, (width - vw) / 2), y: at.y }, { bold });
    }
    return at.x + width;
  };

  /** ป้ายตามด้วยช่องกรอก ต่อกันในบรรทัดเดียว คืน x ท้ายช่อง */
  const labelFill = (
    w: PageWriter, label: string, value: string, at: { x: number; y: number }, width: number, bold = false,
  ) => {
    w.draw(label, at, { bold });
    const x = at.x + widthOf(label, size(16), bold) + 4;
    return fill(w, value, { x, y: at.y }, width) + 4;
  };

  /** ช่องติ๊ก ☐ — ticked = ขีดเครื่องหมายถูกในช่อง */
  const checkbox = (w: PageWriter, at: { x: number; y: number }, ticked: boolean) => {
    const s = 11;
    const top = at.y - s + 1;
    w.page.drawRectangle({
      x: at.x, y: PAGE_H - top - s, width: s, height: s,
      borderColor: kit.rgb(0, 0, 0), borderWidth: 0.8,
    });
    if (ticked) {
      w.line(at.x + 2, top + 6, at.x + 4.5, top + 9, 1.2);
      w.line(at.x + 4.5, top + 9, at.x + 10, top + 1.5, 1.2);
    }
  };

  /** ตัดย่อหน้ายาวตามความกว้าง — ไทยไม่มีช่องว่างระหว่างคำ ตัดได้เฉพาะตรงเว้นวรรค */
  const wrap = (text: string, width: number, bold: boolean, firstIndent = 0) => {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(/(\s+)/)) {
      const room = out.length ? width : width - firstIndent;
      if (widthOf(line + word, size(16), bold) > room && line) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line += word;
      }
    }
    if (line.trim()) out.push(line.trimEnd());
    return out;
  };

  const LEFT = 85;
  const RIGHT = PAGE_W - 70;
  const INDENT = size(36);

  const paragraph = (w: PageWriter, text: string, y: number, gap: number, bold: boolean) => {
    wrap(text, RIGHT - LEFT, bold, INDENT).forEach((t, i) => {
      w.draw(t, { x: LEFT + (i === 0 ? INDENT : 0), y: y + i * gap }, { bold });
    });
  };

  /** หัวจดหมายของบริษัท — ชื่อตัวใหญ่ ที่อยู่แยกบรรทัดเบอร์โทร เส้นคาดหนา */
  const letterhead = (w: PageWriter, co: CompanyNo) => {
    const cx = PAGE_W / 2;
    w.drawCentered(company(co), { x: cx, y: 82 }, { bold: true, pt: 26 });
    const address = f.coValue(co, 'companyAddress', EVERGREEN);
    // ต้นฉบับขึ้นเบอร์โทรบรรทัดใหม่ ค่ากลางเก็บไว้บรรทัดเดียวจึงแยกตรงคำว่า Tel
    const [addr, ...rest] = address.split(/\s+(?=TEL)/i);
    w.drawCentered(addr, { x: cx, y: 102 }, { pt: 15 });
    if (rest.length) w.drawCentered(rest.join(' '), { x: cx, y: 117 }, { pt: 15 });
    w.line(LEFT - 10, 124, RIGHT + 10, 124, 2);
  };

  /** ตราประทับหน้าชื่อ ลายเซ็นเหนือชื่อ — ความกว้างตามที่ตั้งไว้ในหน้าตั้งค่าจดหมาย */
  const stampAndSign = (w: PageWriter, co: CompanyNo, nameX: number, nameY: number) => {
    const stampW = f.block(stampBlock(co), EVERGREEN).gap;
    const signW = f.block(signBlock(co), EVERGREEN).gap;
    w.image(embedded[co]?.stamp, { x: nameX - stampW - 10, y: nameY - stampW * 0.75, width: stampW });
    w.image(embedded[co]?.sign, { x: nameX - signW / 2, y: nameY - 62, width: signW });
  };

  /** ผู้ลงนามกึ่งกลางที่ x — ชื่อในวงเล็บแล้วตามด้วยบรรทัดอื่น (ตำแหน่ง เบอร์โทร) */
  const signature = (w: PageWriter, co: CompanyNo, cx: number, y: number, lines: string[]) => {
    stampAndSign(w, co, cx, y);
    const signer = f.coValue(co, 'signerName', EVERGREEN);
    if (signer) w.drawCentered(`(${signer})`, { x: cx, y }, { bold: true });
    lines.forEach((t, i) => w.drawCentered(t, { x: cx, y: y + 22 * (i + 1) }, { bold: true }));
  };

  // ---------- 1–2 · จดหมายขอรับ D/O ----------
  const doRequest = (co: CompanyNo) => {
    const w = newPage();
    letterhead(w, co);
    const sub = 'LETTER REQUEST FOR D/O RELEASE  INCASE OF SEAWAY BILL OR B/L SURRENDER';
    const subW = kit.latin.regular.widthOfTextAtSize(sub, 10);
    w.page.drawText(sub, { x: (PAGE_W - subW) / 2, y: PAGE_H - 140, size: 10, font: kit.latin.regular });
    w.line((PAGE_W - subW) / 2, 142, (PAGE_W + subW) / 2, 142, 0.6);

    w.drawRight(letterDay, { x: RIGHT, y: 185 });

    // เรื่อง — ช่องติ๊กสองชั้นอยู่คอลัมน์เดียวกับช่องติ๊กในเนื้อความ
    const BOX_X = 330;
    w.draw('เรื่อง', { x: LEFT, y: 230 }, { bold: true });
    w.draw('ขอใช้จดหมายรับ D/O เนื่องจาก OB/L', { x: LEFT + 40, y: 230 });
    const boxes = (y: number) => {
      checkbox(w, { x: BOX_X, y }, choice === 'SURRENDER');
      w.draw('SURRENDER', { x: BOX_X + 22, y });
      checkbox(w, { x: BOX_X, y: y + 22 }, choice === 'SEAWAY');
      w.draw('SEAWAY-BILL', { x: BOX_X + 22, y: y + 22 });
    };
    boxes(230);
    w.draw('เรียน', { x: LEFT, y: 280 }, { bold: true });
    w.draw('เจ้าหน้าที่แผนกเรือขาเข้า', { x: LEFT + 40, y: 280 });

    let x = labelFill(w, 'เนื่องด้วยบริษัท', company(co), { x: LEFT + INDENT, y: 325 }, 260);
    x = labelFill(w, 'มีสินค้าเข้ามากับเรือ', vesselVoy, { x: LEFT, y: 350 }, 175);
    labelFill(w, 'เที่ยววันที่', etaText, { x, y: 350 }, RIGHT - x - widthOf('เที่ยววันที่', size(16)) - 4);
    x = labelFill(w, 'B/L NBR.', blNo, { x: LEFT, y: 375 }, 165);
    x = labelFill(w, 'จำนวนสินค้า', weight ? `${weight} KGS.` : '', { x, y: 375 }, 120);
    w.draw('ซึ่งผู้ขายของบริษัทฯ ได้ทำการแจ้งออก B/L เป็น', { x: LEFT, y: 400 });
    boxes(400);

    paragraph(w, 'ดังนั้นทางบริษัทฯ จึงขอรับ D/O โดยใช้จดหมายของทางบริษัทฯ เพื่อไปทำการปล่อยสินค้า ซึ่งในการนี้ หากเกิดความเสียหายใด ๆ เกิดขึ้นทุกประการทางบริษัทฯ ยินดีจะรับผิดชอบความเสียหายนั้น', 470, 24, false);
    w.draw('จึงเรียนมาเพื่อทราบและโปรดดำเนินการ', { x: LEFT + INDENT, y: 555 });

    const cx = 385;
    w.drawCentered('ขอแสดงความนับถือ', { x: cx, y: 600 });
    signature(w, co, cx, 670, [signerTitle]);

    w.draw('**ถ้าจ่ายเป็นเช็คสั่งจ่ายในนาม :', { x: LEFT, y: 745 }, { pt: 14 });
    w.draw(AGENT_TH, { x: LEFT, y: 763 }, { pt: 14 });
    w.draw(AGENT_EN, { x: LEFT, y: 785 }, { pt: 17 });
  };

  // ---------- 3 · ใบลากตู้ ----------
  /*
   * ฟอร์มของ EVERGREEN เป็นภาษาอังกฤษล้วน ใช้ฟอนต์มาตรฐานของ PDF ให้หน้าตาใกล้ต้นฉบับ
   * (Helvetica แทน Verdana · Courier แทนหัวเรื่องแบบพิมพ์ดีด) ฟอนต์ไทยไว้แค่ป้ายท้ายหน้า
   */
  const helv = await kit.doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await kit.doc.embedFont(StandardFonts.HelveticaBold);
  const courierBold = await kit.doc.embedFont(StandardFonts.CourierBold);
  const courierBoldOblique = await kit.doc.embedFont(StandardFonts.CourierBoldOblique);
  type Std = typeof helv;

  const text = (w: PageWriter, s: string, x: number, y: number, font: Std, pt: number) =>
    w.page.drawText(s, { x, y: PAGE_H - y, size: pt, font, color: kit.rgb(0, 0, 0) });

  const stdWrap = (s: string, font: Std, pt: number, width: number) => {
    const out: string[] = [];
    let line = '';
    for (const word of s.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, pt) > width && line) { out.push(line); line = word; }
      else line = next;
    }
    if (line) out.push(line);
    return out;
  };

  /** บรรทัดกรอกของใบลากตู้ — ป้ายตัวหนาแล้วตามด้วยจุดไข่ปลา ค่าวางกลางเส้น */
  const stdFill = (w: PageWriter, label: string, value: string, x: number, y: number, width: number) => {
    text(w, label, x, y, helvBold, 10.5);
    const start = x + helvBold.widthOfTextAtSize(label, 10.5) + 4;
    w.line(start, y + 2, start + width, y + 2, 0.8, true);
    if (value) {
      const vw = helvBold.widthOfTextAtSize(value, 10.5);
      text(w, value, start + Math.max(0, (width - vw) / 2), y - 1, helvBold, 10.5);
    }
    return start + width + 6;
  };

  const interchange = (container: string) => {
    const w = newPage();
    const L = 62;
    const R = PAGE_W - 62;
    w.image(logo, { x: L, y: 52, width: 72 });
    text(w, 'EVERGREEN SHIPPING AGENCY (THAILAND) CO., LTD.', 148, 98, helvBold, 13.5);

    const ax = 318;
    [
      '3656/81, Green Tower, 24th Flr., Rama 4 Rd.,',
      'Klongton, Klongtoey, Bangkok. 10110',
    ].forEach((s, i) => text(w, s, ax, 158 + i * 13, helv, 10));
    text(w, 'Tel :', ax, 184, helvBold, 10);
    text(w, '(02) 229-9999', ax + 26, 184, helv, 10);
    text(w, 'Fax:', ax + 104, 184, helvBold, 10);
    text(w, '(02) 367-3410', ax + 128, 184, helv, 10);
    text(w, 'E-mail :', ax, 197, helvBold, 10);
    const mail = 'csdimp@evergreen-hipping.co.th';
    text(w, mail, ax + 40, 197, helv, 10);
    w.line(ax + 40, 199, ax + 40 + helv.widthOfTextAtSize(mail, 10), 199, 0.5);
    text(w, 'Bangkok :', ax, 225, helvBold, 10);

    const title = 'CONTAINER/CHASSIS INTERCHANGE AGREEMENT';
    const tw = courierBold.widthOfTextAtSize(title, 12);
    text(w, title, (PAGE_W - tw) / 2, 268, courierBold, 12);
    w.line((PAGE_W - tw) / 2, 271, (PAGE_W + tw) / 2, 271, 0.8);

    let y = 300;
    const para = (s: string) => {
      for (const t of stdWrap(s, helv, 10, R - L)) { text(w, t, L, y, helv, 10); y += 12.5; }
      y += 12.5;
    };
    para('In taking delivery of container/chassis from the carrier, the shipper, consignee or his authorized representative (hereinafter referred to as merchant) assumes full responsibility for the safety of the container/chassis while in his possession and the safe return thereof to the Carrier. All expenses and or charges involved in the transportation of the container to the Merchant’s premises and back to the Carrier’s container/chassis place of rest, as well as packing or unpacking of the container are for the account of the merchant. The Merchant also agrees to pay any applicable demurrage and/or detention charges, if incurred.');
    para('While in possession of the container/chassis the Merchant releases and agrees to defend and hold harmless the Carrier from and against any and all loss, damage, liability, costs or expenses suffered which incurred by the Carrier arising out of or connected with injuries to or death of other persons or loss or damage to property of other persons arising out of the loss, operation, maintenance or possession of container/chassis by the Merchant.');
    para('We, hereby, require to take delivery of the following container(s) out of the Port Authority area:-');

    // ค่าที่แก้เองเป็นข้อความเดียว (เรือ+เที่ยว) จึงลงช่อง F.V. ทั้งก้อน
    const fv = edited('vessel') || data.vessel || '';
    const voy = edited('vessel') ? '' : data.voyage ?? '';
    const x = stdFill(w, 'F.V.', fv, L, 545, 200);
    stdFill(w, 'VOY', voy, x, 545, R - x - helvBold.widthOfTextAtSize('VOY', 10.5) - 4);
    stdFill(w, 'B/L NO.', blNo, L, 588, R - L - helvBold.widthOfTextAtSize('B/L NO.', 10.5) - 4);
    stdFill(w, 'CONTAINER NO.', container, L, 631, 320);

    // ผู้ลากตู้คือ KOLA — ประทับตราเหนือเส้นลงนาม
    const sx = 300;
    stampAndSign(w, 1, sx + 105, 738);
    w.line(sx, 742, R - 10, 742, 0.8, true);
    text(w, 'Merchant’s Authorised Signature', sx + 4, 759, courierBoldOblique, 12);

    w.draw('ฟอร์ม ใบลากตู้', { x: L, y: 805 }, { pt: 13 });
  };

  // ---------- 4 · ยืนยันชื่อบริษัทในการออกใบค่ามัดจำตู้ ----------
  const depositLetter = () => {
    const w = newPage();
    letterhead(w, 1);
    w.drawRight(letterDay, { x: RIGHT, y: 170 }, { bold: true });

    w.draw('เรื่อง', { x: LEFT, y: 215 }, { bold: true });
    w.draw('ยืนยันชื่อบริษัทในการออกใบค่ามัดจำตู้', { x: LEFT + 40, y: 215 }, { bold: true });
    w.draw('เรียน', { x: LEFT, y: 245 }, { bold: true });
    w.draw(`ผู้จัดการแผนก การเงิน ${AGENT_TH}`, { x: LEFT + 40, y: 245 }, { bold: true });

    const consignee = (data.consigneeName ?? '').trim() || company(2);
    const gap = 33;
    let y = 280;
    const endFill = (label: string, value: string, x: number) =>
      labelFill(w, label, value, { x, y }, RIGHT - x - widthOf(label, size(16), true) - 4, true);

    endFill('เนื่องจาก ทางบริษัท', consignee, LEFT + INDENT);
    y += gap;
    const x = labelFill(w, 'ได้มีสินค้าเข้ามากับเรือ', vesselVoy, { x: LEFT, y }, 165, true);
    endFill('เข้าวันที่', etaText, x);
    y += gap;
    endFill('B/L EGLV', blNo, LEFT);
    y += gap;
    endFill('ได้มอบหมายให้กับบริษัท', company(1), LEFT);
    y += gap;
    w.draw('เป็นตัวแทนดำเนินพิธีการนำเข้าสินค้าให้กับทางบริษัทฯ หรือ เป็นบริษัทของลูกค้าที่ผ่านมากับทางบริษัทฯ', { x: LEFT, y }, { bold: true });
    y += gap;
    const label = 'และเป็นผู้ที่สำรองจ่ายค่ามัดจำตู้ไปจริง เป็นจำนวนเงิน';
    const end = labelFill(w, label, amountText(data.depositAmount), { x: LEFT, y },
      RIGHT - LEFT - widthOf(label, size(16), true) - widthOf('บาท', size(16), true) - 12, true);
    w.draw('บาท', { x: end, y }, { bold: true });
    y += gap;
    paragraph(w, `ดังนั้น ขอให้ทาง ${AGENT_TH} โปรดดำเนินการ และทำเรื่องคืนเงินค่ามัดจำตู้ให้กับบริษัทดังกล่าวได้โดยตรง`, y, gap, true);

    paragraph(w, 'จึงเรียนมาเพื่อโปรดดำเนินการ หากเกิดความเสียหายใด ๆ ทางบริษัทฯ ยินดีรับผิดชอบทุกประการ', 575, 24, true);

    const cx = 385;
    w.drawCentered('ขอแสดงความนับถือ', { x: cx, y: 640 }, { bold: true });
    signature(w, 1, cx, 712, [signerTitle, `เบอร์โทร ${DEPOSIT_SIGNER_PHONE}`]);
  };

  doRequest(1);
  doRequest(2);
  const containers = (data.containers ?? []).map((c) => c.trim()).filter(Boolean);
  // ยังไม่มีเลขตู้ก็ออกหนึ่งหน้า เว้นช่องไว้เขียนมือ
  for (const c of containers.length ? containers : ['']) interchange(c);
  depositLetter();

  return kit.save();
}
