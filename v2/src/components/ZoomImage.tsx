'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * รูปที่ย่อ / ขยายได้ในแผง Preview — ใช้กับ OG Invoice ที่เป็นรูป (สแกน · ถ่ายรูป)
 *
 *   ปุ่ม − / + / พอดี · Ctrl (⌘) + ลูกกลิ้ง = ย่อขยายตรงจุดที่ชี้ · ดับเบิลคลิก = ขยาย 2 เท่า / กลับพอดี
 *   ขยายแล้วลากรูปเพื่อเลื่อนดูได้ · ลูกกลิ้งเฉย ๆ ยังเลื่อนขึ้นลงตามปกติ
 * ขนาด 1 = กว้างพอดีแผง
 */
const MIN = 0.25;
const MAX = 6;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));

export function ZoomImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // รูปใหม่ = กลับขนาดพอดี
  useEffect(() => { setZoom(1); }, [src]);

  /** ย่อขยายโดยคงจุด (px, py ในแผง) ไว้ที่เดิม — ไม่ใส่ = กลางแผง */
  const zoomTo = (next: number, px?: number, py?: number) => {
    const el = box.current;
    const z = clamp(next);
    if (!el) { setZoom(z); return; }
    const x = px ?? el.clientWidth / 2;
    const y = py ?? el.clientHeight / 2;
    const ratio = z / zoom;
    const left = (el.scrollLeft + x) * ratio - x;
    const top = (el.scrollTop + y) * ratio - y;
    setZoom(z);
    requestAnimationFrame(() => { el.scrollLeft = left; el.scrollTop = top; });
  };

  // ต้องเป็น listener แบบ passive: false จึงกันหน้าเว็บซูมทั้งหน้าได้
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div className={`zoom-img ${className ?? ''}`}>
      <div className="zoom-img-bar">
        <button type="button" className="button tiny" onClick={() => zoomTo(zoom / 1.25)} disabled={zoom <= MIN} title="ย่อ">−</button>
        <span className="zoom-img-pct">{Math.round(zoom * 100)}%</span>
        <button type="button" className="button tiny" onClick={() => zoomTo(zoom * 1.25)} disabled={zoom >= MAX} title="ขยาย">+</button>
        <button type="button" className="button tiny" onClick={() => zoomTo(1)} disabled={zoom === 1} title="กว้างพอดีแผง">พอดี</button>
        <small>Ctrl + ลูกกลิ้ง = ย่อ/ขยาย · ลากรูปเพื่อเลื่อน</small>
      </div>
      <div
        ref={box}
        className={`zoom-img-box${dragging ? ' dragging' : ''}`}
        onPointerDown={(e) => {
          if (e.button !== 0 || !box.current) return;
          drag.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !box.current) return;
          box.current.scrollLeft = d.left - (e.clientX - d.x);
          box.current.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomTo(zoom > 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} draggable={false} style={{ width: `${zoom * 100}%` }} />
      </div>
    </div>
  );
}
