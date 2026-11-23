'use client';

import { useEffect, useState } from 'react';

/**
 * ไฟล์ Excel (.xlsx) แสดงเป็น PDF ในแผงดูไฟล์ — ไม่ต้องโหลดลงเครื่อง
 * เซิร์ฟเวอร์แปลงตอนเปิด (/files/[id]/pdf ราว 1 วินาที) ระหว่างนั้นบอกว่ากำลังแปลง
 * แปลงไม่ได้ → บอกเหตุผลและให้เปิด/ดาวน์โหลดไฟล์ Excel ตัวจริงแทน
 */
export function XlsxPdfView({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [state, setState] = useState<{ url: string } | { error: string } | null>(null);

  useEffect(() => {
    let url = '';
    let gone = false;
    setState(null);
    void fetch(`/files/${fileId}/pdf`).then(async (res) => {
      if (gone) return;
      if (!res.ok) { setState({ error: (await res.text().catch(() => '')) || `HTTP ${res.status}` }); return; }
      url = URL.createObjectURL(await res.blob());
      if (gone) { URL.revokeObjectURL(url); return; }
      setState({ url });
    }).catch((e) => { if (!gone) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [fileId]);

  const excel = (
    <a href={`/files/${fileId}`} download={fileName}>ดาวน์โหลดไฟล์ Excel ต้นฉบับ</a>
  );
  if (!state) return <p className="drawer-note"><span className="ai-dot" /> กำลังแปลง Excel เป็น PDF…</p>;
  if ('error' in state) {
    return <p className="drawer-note warn">แสดงไฟล์นี้เป็น PDF ไม่ได้ ({state.error}) · {excel}</p>;
  }
  return (
    <>
      <object className="file-preview-view" data={state.url} type="application/pdf">
        <p className="drawer-note warn">
          เบราว์เซอร์นี้แสดง PDF ในหน้าไม่ได้ · <a href={`/files/${fileId}/pdf`} target="_blank" rel="noreferrer">เปิดในแท็บใหม่</a> · {excel}
        </p>
      </object>
      <p className="file-preview-alt">แสดงจากไฟล์ Excel (แปลงเป็น PDF ให้ดู) · {excel}</p>
    </>
  );
}
