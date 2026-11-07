'use client';

import { useEffect, useState } from 'react';

/**
 * คลังไฟล์ — ติ๊กหลายงานแล้วดาวน์โหลดไฟล์ทั้งหมดเป็น ZIP ไฟล์เดียว
 *
 * รวม ZIP ในเบราว์เซอร์ ไม่ใช่ที่เซิร์ฟเวอร์ เพราะ Vercel จำกัดขนาดคำตอบไว้ราว 4.5 MB ต่อครั้ง
 * ชุดไฟล์ของหลายงานเกินนั้นง่าย ๆ ที่นี่จึงดึงทีละไฟล์ผ่าน /files/[id] (เส้นทางเดิมที่ตรวจล็อกอินอยู่แล้ว)
 * แล้วค่อยมัดรวมเป็น ZIP ในเครื่องคนกด
 *
 * ช่องติ๊กใช้ PickBox / PickAllBox ตัวเดียวกับ BulkBar (data-pick) จึงเลือกทั้งหมด
 * และตัดแถวที่ตัวกรองหัวคอลัมน์ซ่อนไว้ได้เหมือนหน้าอื่น
 */

/** ไฟล์หนึ่งไฟล์ที่จะใส่ ZIP — path คือ "โฟลเดอร์งาน/ชื่อหมวด - ชื่อไฟล์" */
export type ZipEntry = { id: string; path: string; size: number };

const PARALLEL = 4;

function visibleBoxes() {
  return [...document.querySelectorAll<HTMLInputElement>('[data-pick]')].filter((b) => !b.closest('tr[hidden]'));
}

function formatSize(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function LibraryDownload({
  files, scopeLabel, children,
}: {
  /** ไฟล์ของแต่ละงานบนหน้านี้ ตามหมวดที่กรองอยู่ */
  files: Record<string, ZipEntry[]>;
  /** บอกบนแถบว่ากำลังโหลดหมวดไหน เช่น "ทุกหมวด" หรือ "Invoice สินค้า" */
  scopeLabel: string;
  children: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');

  // แถวที่ตัวกรองหัวคอลัมน์ซ่อนไป ต้องหลุดจากที่เลือก ไม่งั้นโหลดไฟล์ที่มองไม่เห็นติดไปด้วย
  useEffect(() => {
    const prune = () => setPicked((cur) => {
      const next = cur.filter((id) => {
        const box = document.querySelector<HTMLInputElement>(`[data-pick="${CSS.escape(id)}"]`);
        return box && !box.closest('tr[hidden]');
      });
      return next.length === cur.length ? cur : next;
    });
    document.addEventListener('kola:table-filtered', prune);
    return () => document.removeEventListener('kola:table-filtered', prune);
  }, []);

  // หน้าเปลี่ยนแท็บ/หมวด = ชุดแถวใหม่ ทิ้งที่เลือกไว้ของชุดเก่า
  useEffect(() => { setPicked((cur) => cur.filter((id) => id in files)); }, [files]);

  useEffect(() => {
    document.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box) => {
      box.checked = picked.includes(box.dataset.pick ?? '');
      box.closest('tr')?.classList.toggle('row-picked', box.checked);
    });
    const all = document.querySelector<HTMLInputElement>('[data-pick-all]');
    if (all) {
      const boxes = visibleBoxes();
      all.checked = boxes.length > 0 && picked.length === boxes.length;
      all.indeterminate = picked.length > 0 && picked.length < boxes.length;
    }
  }, [picked]);

  const entries = picked.flatMap((id) => files[id] ?? []);
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const busy = progress !== null;

  const download = async () => {
    if (!entries.length || busy) return;
    setMessage('');
    setProgress({ done: 0, total: entries.length });
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const used = new Set<string>();
      const failed: string[] = [];
      let done = 0;
      let next = 0;

      // ชื่อซ้ำในโฟลเดอร์เดียวกัน (Slip หลายใบชื่อเดียวกัน) ต่อท้ายเลข ไม่ให้ไฟล์ทับกันเงียบ ๆ
      const uniquePath = (path: string) => {
        let candidate = path;
        for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
          candidate = path.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
        }
        used.add(candidate.toLowerCase());
        return candidate;
      };

      const worker = async () => {
        while (next < entries.length) {
          const entry = entries[next++];
          try {
            const res = await fetch(`/files/${entry.id}`);
            if (!res.ok) throw new Error(await res.text());
            zip.file(uniquePath(entry.path), await res.arrayBuffer());
          } catch (e) {
            failed.push(`${entry.path} — ${e instanceof Error ? e.message : String(e)}`);
          }
          done += 1;
          setProgress({ done, total: entries.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, entries.length) }, worker));

      if (failed.length === entries.length) throw new Error('ดาวน์โหลดไม่ได้สักไฟล์ ลองใหม่อีกครั้ง');
      if (failed.length) zip.file('_ไฟล์ที่โหลดไม่ได้.txt', failed.join('\n'));

      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(/[-: ]/g, '');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `KOLA-files-${picked.length}jobs-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);

      setMessage(failed.length
        ? `ดาวน์โหลดแล้ว แต่ ${failed.length} ไฟล์โหลดไม่ได้ (ดูรายชื่อใน _ไฟล์ที่โหลดไม่ได้.txt)`
        : '');
      if (!failed.length) setPicked([]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div
      className="bulk-root"
      onChange={(e) => {
        const box = e.target as HTMLInputElement;
        if (box.dataset.pickAll !== undefined) {
          setPicked(box.checked ? visibleBoxes().map((b) => b.dataset.pick ?? '').filter(Boolean) : []);
          return;
        }
        const id = box.dataset.pick;
        if (!id) return;
        setPicked((cur) => (box.checked ? [...new Set([...cur, id])] : cur.filter((v) => v !== id)));
      }}
    >
      {children}

      {picked.length || message ? (
        <div className="bulk-bar lib-bar" role="status">
          <span>
            {picked.length
              ? <>เลือก {picked.length} งาน · {entries.length} ไฟล์{totalSize ? ` · ${formatSize(totalSize)}` : ''} <small>({scopeLabel})</small></>
              : null}
          </span>
          {message ? <span className="bulk-error">{message}</span> : null}
          {progress ? (
            <span className="lib-progress">
              <progress max={progress.total} value={progress.done} />
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {picked.length ? (
            <>
              <button type="button" className="button tiny" disabled={busy} onClick={() => { setPicked([]); setMessage(''); }}>
                ล้างที่เลือก
              </button>
              <button type="button" className="button primary" disabled={busy || !entries.length} onClick={() => void download()}>
                {busy ? 'กำลังรวมไฟล์…' : `⬇ ดาวน์โหลด ZIP (${entries.length} ไฟล์)`}
              </button>
            </>
          ) : (
            <button type="button" className="button tiny" onClick={() => setMessage('')}>ปิด</button>
          )}
        </div>
      ) : null}
    </div>
  );
}
