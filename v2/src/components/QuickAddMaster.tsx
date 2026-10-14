'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { quickAddMaster } from '@/lib/actions/intake';

/** หัวข้อ Master Data ที่ PAINT เพิ่มเองได้จากหน้ารับงาน */
export type QuickAddType = 'shippers' | 'consignees';

const LABELS: Record<QuickAddType, { label: string; codeHint: string }> = {
  shippers: { label: 'Shipper', codeHint: 'SHP0086' },
  consignees: { label: 'Consignee', codeHint: 'CNE0012' },
};

/**
 * เพิ่ม Shipper หรือ Consignee ใหม่จากหน้ารับงาน โดยไม่ต้องออกไป Master Data
 *
 * PAINT เจอรายชื่อที่ยังไม่มีในระบบบ่อย ตอนคีย์ใบแรกของลูกค้าใหม่
 * เดิมต้องเปิด Master Data อีกแท็บ เพิ่มชื่อ แล้วกลับมารีเฟรชหน้ารับงาน
 * ซึ่งทำให้ข้อมูลที่กรอกค้างไว้หายหมด
 *
 * เพิ่มเสร็จแล้วเลือกให้ในช่องที่กำลังกรอกเลย ไม่ต้องไปหาในรายการเอง
 */
export function QuickAddMaster({
  type, onAdded,
}: {
  type: QuickAddType;
  onAdded: (added: { id: string; code: string | null; name: string }) => void;
}) {
  const router = useRouter();
  const { label, codeHint } = LABELS[type];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const submit = () => {
    const value = name.trim();
    if (!value) { setError(`กรุณากรอกชื่อ ${label}`); return; }
    setError('');
    start(async () => {
      const fd = new FormData();
      fd.set('type', type);
      fd.set('name', value);
      if (code.trim()) fd.set('code', code.trim());
      const result = await quickAddMaster(fd);
      /*
       * action คืนค่าเมื่อสำเร็จ ถ้าไม่มีค่าแปลว่ามีข้อผิดพลาด
       * ซึ่ง runAction จะ redirect พร้อม ?err= แล้วแถบแจ้งเตือนของ layout เป็นคนแสดง
       */
      if (result?.id) {
        onAdded(result);
        setName('');
        setCode('');
        setOpen(false);
        // ดึงรายการใหม่มาให้ช่องอื่นในหน้าเห็นด้วย
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <button type="button" className="button tiny" onClick={() => setOpen(true)}>
        + เพิ่ม {label}
      </button>
    );
  }

  return (
    <div className="quick-add">
      <label className="mini">
        <span>ชื่อ {label} ใหม่</span>
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
        <input
          value={code}
          placeholder={codeHint}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            // ฟอร์มนี้อยู่ในฟอร์มรับงาน Enter ต้องไม่ส่งฟอร์มใหญ่ไปแทน
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
        />
      </label>
      {error ? <p className="popover-error">{error}</p> : null}
      <div className="quick-add-actions">
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
