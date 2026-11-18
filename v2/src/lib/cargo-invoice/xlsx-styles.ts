/**
 * เพิ่มเส้นขอบให้รูปแบบช่องใน styles.xml — สำหรับลากเส้นแบ่งระหว่างคัน/ระหว่างตู้ใน Final Invoice
 *
 * รูปแบบช่อง (xf) ใช้ร่วมกันหลายช่อง แก้ตัวเดิมไม่ได้ (ช่องอื่นที่ใช้รูปแบบเดียวกันจะมีเส้นไปด้วย)
 * จึงสร้างรูปแบบใหม่ที่เหมือนเดิมทุกอย่างแต่มีเส้นบน แล้วให้ช่องที่ต้องการชี้ไปรูปแบบใหม่นั้น
 */
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const XF = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
const BORDER = /<border\b[^>]*?(?:\/>|>[\s\S]*?<\/border>)/g;

export type Line = 'thin' | 'medium';

export class StyleBook {
  private xfs: string[];
  private borders: string[];
  private made = new Map<string, string>();

  constructor(private xml: string) {
    const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
    const borderBlock = /<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(xml)?.[1] ?? '';
    this.xfs = [...xfBlock.matchAll(XF)].map((m) => m[0]);
    this.borders = [...borderBlock.matchAll(BORDER)].map((m) => m[0]);
  }

  /** รูปแบบที่มีเส้นบน — ช่องมีเส้นบนอยู่แล้ว (หนาเท่าหรือหนากว่า) คืนรูปแบบเดิม */
  withTop(style: string | null, line: Line): string {
    const s = style ?? '0';
    const key = `${s}:${line}`;
    const done = this.made.get(key);
    if (done) return done;
    const xf = this.xfs[Number(s)];
    if (!xf) return s;
    const borderId = Number(attr(xf, 'borderId') ?? 0);
    const border = this.borders[borderId] ?? '<border><left/><right/><top/><bottom/><diagonal/></border>';
    const top = /<top\b[^>]*?(?:\/>|>[\s\S]*?<\/top>)/.exec(border)?.[0] ?? '';
    const has = attr(top, 'style');
    if (has === line || has === 'medium' || has === 'thick' || has === 'double') { this.made.set(key, s); return s; }

    const newTop = `<top style="${line}"><color indexed="64"/></top>`;
    let next = border.endsWith('/>') ? border.replace(/\/>$/, '>') + '</border>' : border;
    if (top) next = next.replace(top, newTop);
    else if (/<bottom\b/.test(next)) next = next.replace(/<bottom\b/, `${newTop}<bottom`);
    else next = next.replace(/<\/border>$/, `${newTop}</border>`);
    this.borders.push(next);

    const open = /^<xf\b[^>]*?(?=\/?>)/.exec(xf)![0];
    let head = /\bborderId="/.test(open)
      ? open.replace(/\bborderId="\d+"/, `borderId="${this.borders.length - 1}"`)
      : `${open} borderId="${this.borders.length - 1}"`;
    head = /\bapplyBorder="/.test(head) ? head.replace(/\bapplyBorder="[^"]*"/, 'applyBorder="1"') : `${head} applyBorder="1"`;
    this.xfs.push(head + xf.slice(open.length));
    const id = String(this.xfs.length - 1);
    this.made.set(key, id);
    return id;
  }

  toXml(): string {
    return this.xml
      .replace(/<borders\b[^>]*>[\s\S]*?<\/borders>/, `<borders count="${this.borders.length}">${this.borders.join('')}</borders>`)
      .replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`);
  }
}
