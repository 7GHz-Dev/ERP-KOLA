'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { quickAddShipper } from '@/lib/actions/intake';

/**
 * เพิ่ม Shipper ใหม่จากหน้ารับงาน โดยไม่ต้องออกไป Master Data
 *
 * PAINT เจอ Shipper ที่ยังไม่มีในระบบบ่อย ตอนคีย์ใบแรกของลูกค้าใหม่
 * เดิมต้องเปิด Master Data อีกแท็บ เพิ่มชื่อ แล้วกลับมารีเฟรชหน้ารับงาน
 * ซึ่งทำให้ข้อมูลที่กรอกค้างไว้หายหมด
 *
 * เพิ่มเสร็จแล้วเลือกให้ในแถวที่กำลังกรอกเลย ไม่ต้องไปหาในรายการเอง
 */
export function QuickAddShipper({ onAdded }: { onAdded: (id: string, name: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const submit = () => {
    const value = name.trim();
    if (!value) { setError('กรุณากรอกชื่อ Shipper'); return; }
    setError('');
    start(async () => {
      const fd = new FormData();
      fd.set('name', value);
      if (code.trim()) fd.set('code', code.trim());
      const result = await quickAddShipper(fd) as { id: string; name: string } | undefined;
      /*
       * action คืนค่าเมื่อสำเร็จ ถ้าไม่มีค่าแปลว่ามีข้อผิดพลาด
       * ซึ่ง runAction จะ redirect พร้อม ?err= แล้วแถบแจ้งเตือนของ layout เป็นคนแสดง
       */
      if (result?.id) {
        onAdded(result.id, result.name);
        setName('');
        setCode('');
        setOpen(false);
        // ดึงรายการ Shipper ใหม่มาให้ช่องอื่นในหน้าเห็นด้วย
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <button type="button" className="button tiny" onClick={() => setOpen(true)}>
        + เพิ่ม Shipper
      </button>
    );
  }

  return (
    <div className="quick-shipper">
      <label className="mini">
        <span>ชื่อ Shipper ใหม่</span>
        <input
          value={name}
          autoFocus
          placeholder="พิมพ์ชื่อบริษัทตามที่อยู่ในเอกสาร"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter บันทึกเลย เพราะช่องเดียวก็พอสำหรับกรณีส่วนใหญ่
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </label>
      <label className="mini">
        <span>รหัส (เว้นว่างให้ระบบตั้งให้)</span>
        <input value={code} placeholder="SHP0086" onChange={(e) => setCode(e.target.value)} />
      </label>
      {error ? <p className="popover-error">{error}</p> : null}
      <div className="quick-shipper-actions">
        <button type="button" className="button tiny" onClick={() => setOpen(false)} disabled={pending}>
          ยกเลิก
        </button>
        <button type="button" className="button tiny primary" onClick={submit} disabled={pending}>
          {pending ? 'กำลังเพิ่ม…' : 'เพิ่มแล้วเลือกเลย'}
        </button>
      </div>
    </div>
  );
}
