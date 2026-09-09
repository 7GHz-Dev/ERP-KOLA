'use client';

import { useEffect, useState } from 'react';

const KEY = 'kola-sidebar-hidden';

/**
 * ปุ่มซ่อน/แสดงแถบเมนูซ้าย
 *
 * บนมือถือแถบเมนูกินความกว้างไปมาก ซ่อนแล้วรายการได้พื้นที่เต็มจอ
 * จอใหญ่ก็ซ่อนได้เหมือนกัน เผื่อตอนดูตารางที่มีหลายคอลัมน์
 *
 * ทาคลาสที่ <html> ไม่ใช่ที่ตัวเอง เพราะโครงหน้าทั้งหมดอยู่ชั้นบนกว่าปุ่มนี้
 * และจำค่าไว้ใน localStorage แยกตามเครื่อง คนที่ใช้มือถือประจำจะได้ไม่ต้องกดซ้ำทุกครั้ง
 *
 * ค่าเริ่มต้นอ่านใน useEffect ไม่ใช่ตอน useState เพราะฝั่งเซิร์ฟเวอร์ไม่มี localStorage
 * ถ้าอ่านตอนสร้าง state ผลของสองฝั่งจะไม่ตรงกันแล้ว React เตือน hydration mismatch
 */
export function SidebarToggle() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(KEY);
    } catch {
      /* เบราว์เซอร์ที่ปิดที่เก็บข้อมูลไว้ก็ใช้ค่าตั้งต้นไป ไม่ต้องรบกวนผู้ใช้ */
    }
    /*
     * ยังไม่เคยเลือกเอง — มือถือเริ่มด้วยเมนูซ่อน จอใหญ่เริ่มด้วยเมนูกาง
     * บนมือถือเมนูกินความกว้างเกือบทั้งจอ ถ้าเปิดมาเจอเมนูก่อนทุกครั้ง
     * ต้องกดปิดเองก่อนถึงจะเห็นรายการ พอเลือกเองแล้วค่าที่เลือกมีผลเหนือกว่าเสมอ
     */
    if (saved === null) {
      setHidden(window.matchMedia('(max-width: 820px)').matches);
      return;
    }
    setHidden(saved === '1');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('nav-hidden', hidden);
    try {
      window.localStorage.setItem(KEY, hidden ? '1' : '0');
    } catch {
      /* จำไม่ได้ก็ยังใช้งานรอบนี้ได้ตามปกติ */
    }
  }, [hidden]);

  return (
    <button
      type="button"
      className="nav-toggle"
      onClick={() => setHidden((v) => !v)}
      aria-expanded={!hidden}
      aria-label={hidden ? 'แสดงเมนู' : 'ซ่อนเมนู'}
      title={hidden ? 'แสดงเมนู' : 'ซ่อนเมนู'}
    >
      <span aria-hidden="true">{hidden ? '☰' : '✕'}</span>
    </button>
  );
}
