'use client';

import { useState } from 'react';
import { UploadForm } from '@/components/UploadForm';
import { FILE_ORDER, fileLabel } from '@/lib/file-categories';

/**
 * เครื่องมือจัดการไฟล์แนบของผู้ดูแลระบบ
 *
 * ปกติแต่ละหมวดไฟล์อัปได้เฉพาะฝ่ายที่เป็นเจ้าของ และปุ่มอัปก็อยู่กระจายตามหน้าของฝ่ายนั้น
 * บางหน้ายังซ่อนปุ่มเมื่องานเดินเลยขั้นไปแล้วด้วย เช่นส่ง Partner แล้วล็อกไฟล์ไว้
 * ผู้ดูแลจึงไม่มีทางแก้ไฟล์ที่ใส่ผิดได้เลย ทั้งที่ฝั่งเซิร์ฟเวอร์อนุญาตอยู่แล้ว
 *
 * รวมไว้ที่หน้าสรุปงานซึ่งเห็นไฟล์ครบทุกหมวดของงานนั้นอยู่แล้ว
 * แก้ได้จากที่เดียวโดยไม่ต้องรู้ว่าหมวดไหนเป็นของฝ่ายอะไร
 *
 * ไฟล์เก่าไม่ถูกลบ ระบบเก็บเป็นเวอร์ชันใหม่แล้วดันของเดิมไปอยู่ "เวอร์ชันเก่า"
 * จึงตามย้อนได้เสมอว่าใครเปลี่ยนอะไรเมื่อไหร่
 */

/** หมวดที่ผู้ดูแลเพิ่มเองได้ — ตัดหมวดที่ระบบสร้างให้อัตโนมัติออก */
const SYSTEM_MADE = ['EOFFICE_MERGED', 'DO_MERGED', 'DO_BATCH_MERGED', 'FINAL_INVOICE_PDF'];

export function AdminFileTools({
  jobId, category, mode, existing = [],
}: {
  jobId: string;
  /** หมวดของไฟล์ที่จะเปลี่ยน — ใช้เฉพาะ mode replace */
  category?: string;
  mode: 'replace' | 'add';
  /** หมวดที่งานนี้มีไฟล์อยู่แล้ว ใช้ตัดออกจากรายการให้เลือก */
  existing?: string[];
}) {
  const [picked, setPicked] = useState('');

  if (mode === 'replace' && category) {
    return (
      <UploadForm
        jobId={jobId}
        category={category}
        label="เปลี่ยนไฟล์"
        /*
         * ฝั่งเซิร์ฟเวอร์บังคับเหตุผลเมื่อเปลี่ยน Invoice สินค้าที่มีไฟล์อยู่แล้ว
         * เพราะยอดในใบนั้นถูกฝ่ายอื่นใช้ไปแล้ว ถ้าไม่โชว์ช่องให้กรอก
         * ผู้ดูแลจะกดส่งแล้วเจอ error โดยไม่รู้ว่าต้องทำอะไร
         */
        requireReason={category === 'INVOICE_GOODS'}
        stayHere
      />
    );
  }

  /*
   * หมวดที่ยังไม่มีไฟล์ในงานนี้ เรียงตามลำดับขั้นงานเหมือนที่หน้าสรุปเรียง
   * ตัดหมวดที่ระบบรวมไฟล์ให้เองออก เพราะอัปทับมือแล้วจะไม่ตรงกับชุดที่ระบบสร้าง
   */
  const choices = FILE_ORDER.filter(
    (c) => !existing.includes(c) && !SYSTEM_MADE.includes(c),
  );
  if (!choices.length) return null;

  return (
    <div className="admin-file-add">
      <label className="mini">
        <span>ผู้ดูแล — เพิ่มไฟล์หมวดอื่น</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">เลือกหมวดไฟล์…</option>
          {choices.map((c) => (
            <option key={c} value={c}>{fileLabel(c)}</option>
          ))}
        </select>
      </label>
      {picked ? (
        <UploadForm
          jobId={jobId}
          category={picked}
          label={`อัป ${fileLabel(picked)}`}
          stayHere
        />
      ) : null}
    </div>
  );
}
