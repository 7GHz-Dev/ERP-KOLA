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
const OPEN_KEY = 'kola-do-fill-open';

export function DoFillBoard({
  jobs, ports, originPorts, terminals, partners, defaultPortId, defaultPartnerId, sentAt, savedAt, openFor, queue: queueIds, openKey, children,
}: {
  jobs: DoPaneJob[];
  ports: Choice[];
  originPorts: Choice[];
  terminals: Choice[];
  partners: Choice[];
  defaultPortId: string | null;
  defaultPartnerId: string | null;
  /** เวลาที่ส่ง Partner ของแต่ละงาน — ใช้บอกว่าแถวนี้ส่งไปแล้วหรือยัง */
  sentAt: Record<string, string>;
  /** เวลาบันทึกล่าสุดในแผงของแต่ละงาน — แสดงใต้ปุ่มบันทึก */
  savedAt?: Record<string, string>;
  /**
   * งานที่ให้เปิดแผงให้เลยตั้งแต่โหลดหน้า
   * ใช้ตอนเพิ่งอัปหรือเปลี่ยนไฟล์ Invoice DO เสร็จ จะได้กรอกต่อทันทีโดยไม่ต้องกดอีกที
   */
  openFor?: string | null;
  /** ชุดงานที่ติ๊กกรอกต่อกัน (?fq=) — แผงมีปุ่มก่อนหน้า/ถัดไป · บันทึกแล้วไปงานถัดไป */
  queue?: string[];
  /** เปลี่ยนทุกครั้งที่กดเปิดชุดใหม่ (?n=) — เปิดชุดเดิมซ้ำหลังปิดแผงได้ */
  openKey?: string;
  /** ตารางฝั่งขวา เรนเดอร์มาจากเซิร์ฟเวอร์ */
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(openFor ?? null);
  const job = jobs.find((j) => j.id === openId) ?? null;
  // ชุดที่ติ๊ก — เหลือเฉพาะงานที่ยังอยู่ในแท็บนี้ (ส่ง Partner แล้วหลุดออกไป)
  const queue = (queueIds ?? []).filter((id) => jobs.some((j) => j.id === id));
  const qIndex = openId ? queue.indexOf(openId) : -1;
  const inQueue = queue.length > 1 && qIndex >= 0;

  /*
   * อัปไฟล์เสร็จแล้วเปิดแผงของงานนั้นให้เลย
   * ค่าเปลี่ยนทุกครั้งที่อัปสำเร็จ (ผูกกับ id ไฟล์ใหม่) จึงเปิดซ้ำงานเดิมได้ด้วย
   */
  useEffect(() => {
    if (openFor) setOpenId(openFor);
  }, [openFor, openKey]);

  /*
   * จำว่าแผงของงานไหนเปิดอยู่ (ในแท็บนี้) — หน้าโหลดตัวใหม่หลังบันทึกแล้วแผงต้องไม่ปิดเอง
   * ไม่มี ?fill= บน URL ให้เปิดงานที่จำไว้กลับมา · ปิดแผงเองแล้วลบที่จำไว้
   */
  useEffect(() => {
    if (openFor) return;
    try {
      const keep = sessionStorage.getItem(OPEN_KEY);
      if (keep && jobs.some((j) => j.id === keep)) setOpenId(keep);
    } catch { /* ไม่มีที่เก็บ */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (openId) sessionStorage.setItem(OPEN_KEY, openId);
      else sessionStorage.removeItem(OPEN_KEY);
    } catch { /* ไม่มีที่เก็บ */ }
  }, [openId]);

  /*
   * ทาคลาสให้แถวที่กำลังกรอกโดยตรง เพราะ <tr> มาจากตารางที่เรนเดอร์ฝั่งเซิร์ฟเวอร์
   * ส่งเป็น prop ลงไปไม่ได้ และ CSS เลือกจาก attribute ของตัวเองไม่ได้
   */
  useEffect(() => {
    const rows = document.querySelectorAll<HTMLElement>('.do-board [data-open-job]');
    rows.forEach((row) => {
      row.classList.toggle('do-active', row.dataset.openJob === openId);
    });
    // ปุ่มของแถวที่เปิดอยู่เปลี่ยนสี บอกว่าแผงข้าง ๆ เป็นของแถวไหน
    const buttons = document.querySelectorAll<HTMLElement>('.do-board [data-fill-job]');
    buttons.forEach((btn) => {
      if (btn.dataset.fillJob === openId) btn.dataset.open = '1';
      else delete btn.dataset.open;
    });
  }, [openId, jobs]);

  return (
    <>
      {/*
        เปิดแผงจากปุ่ม "กรอกข้อมูล" ในแถวเท่านั้น
        ไม่ดักคลิกเปล่าทั้งแถว เพราะดับเบิลคลิกต้องเปิดสรุปงานเหมือนหน้าอื่น
        ถ้าคลิกเดียวเปิดแผงด้วย ดับเบิลคลิกจะกลายเป็นเปิดสองอย่างพร้อมกัน

        ดักที่ชั้นนอกชั้นเดียวแล้วอ่าน data-fill-job จากปุ่มที่โดน
        ปุ่มจึงเป็น markup เปล่า ๆ ในตารางที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ได้
      */}
      <div
        className="do-board"
        onClick={(e) => {
          const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-fill-job]');
          const id = btn?.dataset.fillJob;
          if (!id) return;
          e.preventDefault();
          setOpenId((current) => (current === id ? null : id));
        }}
      >
        {children}
      </div>

      {job ? (
        <DoFillPane
          key={job.id}
          job={job}
          ports={ports}
          originPorts={originPorts}
          terminals={terminals}
          partners={partners}
          defaultPortId={defaultPortId}
          defaultPartnerId={defaultPartnerId}
          sentAt={sentAt[job.id] ?? null}
          savedAt={savedAt?.[job.id] ?? null}
          nav={inQueue ? {
            index: qIndex,
            labels: queue.map((id) => { const j = jobs.find((x) => x.id === id)!; return j.blNo ?? j.jobNo; }),
            go: (k: number) => setOpenId(queue[k] ?? openId),
          } : null}
          // กดบันทึกแล้วแผงยังเปิดอยู่ · ส่ง Partner แล้วปิด — เลื่อนงานในชุดด้วยปุ่มก่อนหน้า/ถัดไป
          onClose={() => {
            setOpenId(null);
            /*
             * เอา ?fill= ออกจาก URL ด้วย ไม่งั้นกดรีเฟรชแล้วแผงเด้งกลับมาอีก
             * ใช้ replaceState ไม่ใช่ router — ไม่ต้องให้เซิร์ฟเวอร์เรนเดอร์ใหม่
             * เพราะที่เปลี่ยนคือสถานะบนจอล้วน ๆ
             */
            const url = new URL(window.location.href);
            if (url.searchParams.has('fill') || url.searchParams.has('fq')) {
              url.searchParams.delete('fill');
              url.searchParams.delete('fq');
              url.searchParams.delete('n');
              window.history.replaceState(null, '', url);
            }
          }}
        />
      ) : null}
    </>
  );
}
