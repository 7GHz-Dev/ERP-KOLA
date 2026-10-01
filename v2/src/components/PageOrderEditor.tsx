'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfjs } from '@/lib/parse-arrival';
import { checkPageOrder } from '@/lib/pdf-pages';

/**
 * เรียงหน้าชุดแลก DO ที่รวมแล้ว
 *
 * วาดรูปย่อทุกหน้าในเบราว์เซอร์ แล้วให้ลากสลับตำแหน่ง (จอคอม) หรือกด ◀ ▶ (มือถือ
 * ซึ่งลากวางแบบนี้ไม่ได้) บนการ์ดบอกทั้งลำดับใหม่และเลขหน้าเดิม จะได้รู้ว่าย้ายอะไรไปไหนแล้ว
 *
 * บันทึกแล้วเซิร์ฟเวอร์ประกอบไฟล์ใหม่ตามลำดับนี้ เก็บเป็นเวอร์ชันใหม่ แล้วพามาที่ไฟล์ใหม่
 * ตัวไฟล์ไม่ได้ถูกส่งจากเครื่อง ส่งไปแค่ลำดับหน้า เซิร์ฟเวอร์อ่านจากไฟล์ที่เก็บไว้เอง
 */

const THUMB_WIDTH = 220;

export function PageOrderEditor({ fileId, onCancel }: { fileId: string; onCancel: () => void }) {
  const router = useRouter();
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/files/${fileId}`);
        if (!res.ok) throw new Error(`เปิดไฟล์ไม่ได้ (HTTP ${res.status})`);
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ data: await res.arrayBuffer(), password: '' }).promise;
        if (cancelled) return;
        setOrder(Array.from({ length: doc.numPages }, (_, i) => i));
        // วาดทีละหน้าแล้วโชว์ทันที ชุดหลายสิบหน้าจะได้ไม่ค้างหน้าขาวจนเสร็จหมด
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('เบราว์เซอร์นี้วาดตัวอย่างหน้าไม่ได้');
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          setThumbs((list) => [...list, canvas.toDataURL('image/jpeg', 0.8)]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'เปิดไฟล์ไม่ได้');
      }
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setError('');
    setOrder((cur) => {
      const next = [...cur];
      const [page] = next.splice(from, 1);
      next.splice(to, 0, page);
      return next;
    });
  };

  const changed = order.some((page, i) => page !== i);

  const save = async () => {
    try {
      checkPageOrder(order, order.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ลำดับหน้าไม่ถูกต้อง');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/files/${fileId}/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      const out = (await res.json().catch(() => ({}))) as { fileId?: string; error?: string };
      if (!res.ok || !out.fileId) throw new Error(out.error ?? 'เรียงหน้าไม่สำเร็จ');
      // ไฟล์ใหม่เป็นไฟล์ปัจจุบันแล้ว ปุ่มส่งแลกกับลิงก์ในตารางจะชี้ไปตัวนี้
      router.replace(`/file/${out.fileId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เรียงหน้าไม่สำเร็จ');
      setSaving(false);
    }
  };

  const loading = order.length > 0 && thumbs.length < order.length;

  return (
    <div className="file-preview-view page-order">
      <div className="page-order-body">
        <p className="drawer-status meta">
          ลากการ์ดไปวางตำแหน่งที่ต้องการ หรือกด ◀ ▶ เพื่อเลื่อนทีละช่อง · มุมขวาของการ์ดคือเลขหน้าเดิม
        </p>
        {error ? <p className="drawer-note warn">{error}</p> : null}
        <div className="page-grid">
          {order.map((page, pos) => (
            <div
              key={page}
              className={`page-card order-card${page !== pos ? ' moved' : ''}${dragOver === pos ? ' drag-over' : ''}`}
              draggable={!saving}
              onDragStart={(e) => {
                setDragFrom(pos);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOver !== pos) setDragOver(pos);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === pos ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, pos);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
            >
              {thumbs[page]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={thumbs[page]} alt={`หน้าเดิม ${page + 1}`} draggable={false} />
                : <span className="order-card-wait">กำลังวาด…</span>}
              <span className="page-card-bar">
                <b>ลำดับ {pos + 1}</b>
                <em>หน้าเดิม {page + 1}</em>
              </span>
              <span className="order-card-move">
                <button type="button" className="button tiny" disabled={saving || pos === 0}
                  aria-label={`เลื่อนหน้าเดิม ${page + 1} ไปก่อน`} onClick={() => move(pos, pos - 1)}>◀</button>
                <button type="button" className="button tiny" disabled={saving || pos === order.length - 1}
                  aria-label={`เลื่อนหน้าเดิม ${page + 1} ไปหลัง`} onClick={() => move(pos, pos + 1)}>▶</button>
              </span>
            </div>
          ))}
          {!order.length && !error ? <div className="page-card loading">กำลังเปิดไฟล์…</div> : null}
        </div>
      </div>

      <div className="trimmer-foot">
        <span>
          {loading ? `กำลังวาดหน้า ${thumbs.length + 1} / ${order.length}`
            : changed ? 'ยังไม่ได้บันทึกลำดับใหม่' : `${order.length} หน้า · ยังไม่ได้ย้ายหน้าไหน`}
        </span>
        <button type="button" className="button" disabled={saving || !changed}
          onClick={() => setOrder(order.map((_, i) => i))}>
          คืนลำดับเดิม
        </button>
        <button type="button" className="button" disabled={saving} onClick={onCancel}>ยกเลิก</button>
        <button type="button" className="button primary" disabled={saving || !changed} onClick={() => void save()}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกลำดับหน้า'}
        </button>
      </div>
    </div>
  );
}
