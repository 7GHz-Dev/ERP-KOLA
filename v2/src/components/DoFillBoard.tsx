'use client';

import { useEffect, useState } from 'react';
import { DoFillPane, type DoPaneJob } from '@/components/DoFillPane';
import type { Choice } from '@/components/DoRowForm';

/**
 * ฝั่ง "รอส่ง Partner" — เลือกแถวทางขวา แล้วกรอกในแผงซ้ายคู่กับไฟล์
 *
 * ตัวที่ต้องจำคือ "กำลังกรอกแถวไหน" ซึ่งเป็นสถานะบนจอล้วน ๆ ไม่ต้องขึ้น URL
 * เก็บไว้ตรงนี้ที่เดียว ตารางกับแผงจึงอ้างค่าเดียวกันเสมอ
 */
export function DoFillBoard({
  jobs, ports, terminals, partners, defaultPortId, defaultPartnerId, sentAt, children,
}: {
  jobs: DoPaneJob[];
  ports: Choice[];
  terminals: Choice[];
  partners: Choice[];
  defaultPortId: string | null;
  defaultPartnerId: string | null;
  /** เวลาที่ส่ง Partner ของแต่ละงาน — ใช้บอกว่าแถวนี้ส่งไปแล้วหรือยัง */
  sentAt: Record<string, string>;
  /** ตารางฝั่งขวา เรนเดอร์มาจากเซิร์ฟเวอร์ */
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === openId) ?? null;

  /*
   * ทาคลาสให้แถวที่กำลังกรอกโดยตรง เพราะ <tr> มาจากตารางที่เรนเดอร์ฝั่งเซิร์ฟเวอร์
   * ส่งเป็น prop ลงไปไม่ได้ และ CSS เลือกจาก attribute ของตัวเองไม่ได้
   */
  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>('.do-board [data-open-job]');
    rows.forEach((row) => {
      row.classList.toggle('do-active', row.dataset.openJob === openId);
    });
  }, [openId, jobs]);

  return (
    <>
      {/*
        คลิกที่ไหนก็ได้ในแถวเพื่อสลับงานที่กำลังกรอก
        ดักที่ชั้นนอกชั้นเดียว ไม่ต้องแขวนปุ่มไว้ทุกแถวให้ตารางรก
        ปล่อยให้ลิงก์กับปุ่มในแถวทำงานของมันไปตามปกติ
      */}
      <div
        className="do-board"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest('a, button, input, select, textarea')) return;
          const row = el.closest<HTMLElement>('[data-open-job]');
          const id = row?.dataset.openJob;
          if (id && jobs.some((j) => j.id === id)) setOpenId(id);
        }}
        data-active={openId ?? undefined}
      >
        {children}
      </div>

      {job ? (
        <DoFillPane
          key={job.id}
          job={job}
          ports={ports}
          terminals={terminals}
          partners={partners}
          defaultPortId={defaultPortId}
          defaultPartnerId={defaultPartnerId}
          sentAt={sentAt[job.id] ?? null}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
