'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';

/**
 * ผู้ช่วย KOLA — ปุ่มลอยมุมขวาล่างทุกหน้า กดแล้วเปิดแผงคุย
 *
 * ประวัติเก็บใน sessionStorage ของแท็บนี้ สลับหน้าแล้วยังคุยต่อได้ ปิดแท็บแล้วหาย
 * คำตอบทยอยมาเป็น NDJSON จาก /api/assistant (ดู route.ts)
 */

type Turn = { role: 'user' | 'assistant'; content: string; error?: boolean };
const STORE = 'kola-assistant';
const EXAMPLES = [
  'งาน BL AMP0561328B ถึงขั้นตอนไหนแล้ว',
  'ตอนนี้ FAH ค้าง InvDO กี่งาน',
  'วันที่ 30/10/69 มีงานที่รอ InvDO กี่งาน',
  'วันนี้ใครทำอะไรไปบ้าง',
];

/* ---------- Markdown แบบเรียบ: ตัวหนา โค้ด ลิงก์ รายการ ตาราง ---------- */

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const href = m[2];
      // ลิงก์ในระบบเปิดในแท็บเดิม (แผงคุยยังอยู่) · ลิงก์นอกเปิดแท็บใหม่ · อย่างอื่นไม่ทำเป็นลิงก์
      if (href.startsWith('/')) out.push(<Link key={`${key}-${i}`} href={href} prefetch={false}>{m[1]}</Link>);
      else if (/^https?:\/\//.test(href)) out.push(<a key={`${key}-${i}`} href={href} target="_blank" rel="noreferrer">{m[1]}</a>);
      else out.push(m[1]);
    } else if (m[3]) out.push(<b key={`${key}-${i}`}>{m[3]}</b>);
    else if (m[4]) out.push(<code key={`${key}-${i}`}>{m[4]}</code>);
    last = re.lastIndex;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
        i += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="ai-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${i}${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `c${i}${k}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={i}>{items.map((it, j) => <li key={j}>{inline(it, `l${i}${j}`)}</li>)}</Tag>);
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      blocks.push(<p key={i} className="ai-h">{inline(line.replace(/^#+\s+/, ''), `t${i}`)}</p>);
      i += 1;
      continue;
    }
    if (line.trim()) blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
    i += 1;
  }
  return <>{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</>;
}

/* ---------- แผงคุย ---------- */

export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null');
      if (Array.isArray(saved?.turns)) setTurns(saved.turns);
      if (saved?.open) setOpen(true);
    } catch { /* ไม่มีที่เก็บก็เริ่มใหม่ */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ turns, open })); } catch { /* ไม่เป็นไร */ }
  }, [turns, open]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [turns, step, open]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history: Turn[] = [...turns.filter((t) => !t.error), { role: 'user', content: q }];
    setTurns([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setStep('กำลังคิด…');
    const ctrl = new AbortController();
    abort.current = ctrl;

    const update = (fn: (t: Turn) => Turn) => setTurns((cur) => {
      const next = [...cur];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text() || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as { t: string; d?: string; label?: string; message?: string };
          if (e.t === 'text' && e.d) { setStep(''); update((t) => ({ ...t, content: t.content + e.d })); }
          else if (e.t === 'step' && e.label) setStep(`${e.label}…`);
          else if (e.t === 'error') update((t) => ({ ...t, content: `${t.content}\n\n⚠️ ${e.message}`.trim(), error: !t.content.trim() }));
        }
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      update((t) => ({ ...t, content: aborted ? `${t.content}\n\n(หยุดแล้ว)`.trim() : `⚠️ ${e instanceof Error ? e.message : String(e)}`, error: !aborted }));
    } finally {
      setBusy(false);
      setStep('');
      abort.current = null;
    }
  };

  return (
    <>
      {!open ? (
        <button type="button" className="ai-fab" onClick={() => setOpen(true)} aria-label="เปิดผู้ช่วย KOLA">
          <span aria-hidden>✦</span> ถาม KOLA
        </button>
      ) : (
        <section className="ai-panel" aria-label="ผู้ช่วย KOLA">
          <header>
            <div>
              <b>ผู้ช่วย KOLA</b>
              <small>ถามสถานะงาน จำนวนงานค้าง หรือสิ่งที่เกิดขึ้นในระบบ</small>
            </div>
            {turns.length ? (
              <button type="button" className="button tiny" disabled={busy} onClick={() => setTurns([])}>เริ่มใหม่</button>
            ) : null}
            <button type="button" className="ai-close" onClick={() => setOpen(false)} aria-label="ปิด">×</button>
          </header>

          <div className="ai-log" ref={scroller}>
            {turns.length === 0 ? (
              <div className="ai-empty">
                <p>ลองถาม เช่น</p>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="ai-example" onClick={() => void ask(ex)}>{ex}</button>
                ))}
              </div>
            ) : turns.map((t, i) => (
              <div key={i} className={`ai-msg ${t.role}${t.error ? ' error' : ''}`}>
                {t.role === 'assistant' ? (t.content ? <Markdown text={t.content} /> : null) : t.content}
              </div>
            ))}
            {busy && step ? <div className="ai-step"><span className="ai-dot" />{step}</div> : null}
          </div>

          <form
            className="ai-input"
            onSubmit={(e) => { e.preventDefault(); void ask(input); }}
          >
            <textarea
              ref={box}
              rows={2}
              value={input}
              maxLength={2000}
              placeholder="พิมพ์คำถาม… (Enter ส่ง · Shift+Enter ขึ้นบรรทัด)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(input); }
              }}
            />
            {busy ? (
              <button type="button" className="button" onClick={() => abort.current?.abort()}>หยุด</button>
            ) : (
              <button type="submit" className="button primary" disabled={!input.trim()}>ส่ง</button>
            )}
          </form>
          <p className="ai-foot">ตอบจากข้อมูลในระบบแบบอ่านอย่างเดียว · ตรวจตัวเลขสำคัญกับหน้างานอีกครั้ง</p>
        </section>
      )}
    </>
  );
}
