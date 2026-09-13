'use client';

import { useEffect, useRef, useState } from 'react';
import { loadPdfjs } from '@/lib/parse-arrival';

/** Each PDF expands to all its pages inside the shared scrolling preview. */
export function InvoicePdfPages({ fileId, fileName }: { fileId: string; fileName: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Array<{ page: number; url: string }>>([]);
  const [status, setStatus] = useState('กำลังโหลด PDF…');
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    let started = false;
    let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']> | undefined;
    const urls: string[] = [];
    setPages([]);
    setStatus('กำลังโหลด PDF…');
    const render = async () => {
      if (started) return;
      started = true;
      try {
        const response = await fetch(`/files/${fileId}`, { signal: abort.signal });
        if (!response.ok) throw new Error('โหลดไฟล์ไม่สำเร็จ');
        const bytes = await response.arrayBuffer();
        const pdfjs = await loadPdfjs();
        if (disposed) return;
        task = pdfjs.getDocument({ data: bytes, password: '' });
        const doc = await task.promise;
        for (let n = 1; n <= doc.numPages && !disposed; n++) {
          const page = await doc.getPage(n);
          if (disposed) break;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 1400 / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('ไม่สามารถแสดงตัวอย่าง PDF ได้');
          await page.render({ canvasContext: context, viewport }).promise;
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
          canvas.width = canvas.height = 0;
          page.cleanup();
          if (disposed) break;
          if (!blob) throw new Error('ไม่สามารถแสดงหน้า PDF ได้');
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setPages(previous => [...previous, { page: n, url }]);
          setStatus(n === doc.numPages ? '' : `กำลังโหลดหน้า ${n + 1}/${doc.numPages}…`);
        }
        await task.destroy();
        task = undefined;
      } catch {
        if (!disposed) setStatus('แสดง PDF ไม่สำเร็จ กรุณาเปิดไฟล์ต้นฉบับ');
      }
    };
    // Avoid downloading every invoice at once for a large selection.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void render(); }
    }, { rootMargin: '600px' });
    if (host.current) observer.observe(host.current);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      void task?.destroy();
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [fileId]);
  return <div ref={host} className="invoice-pdf-pages">
    {pages.map(page => <figure key={page.page}>
      <img src={page.url} alt={`${fileName} หน้า ${page.page}`} loading="lazy" />
      <figcaption>หน้า {page.page}</figcaption>
    </figure>)}
    {status ? <p role="status">{status}</p> : null}
    <a href={`/files/${fileId}`} target="_blank" rel="noreferrer">เปิดไฟล์ต้นฉบับ</a>
  </div>;
}
