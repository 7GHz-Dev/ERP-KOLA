'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * โหลดข้อมูลของหน้าใหม่เป็นระยะระหว่างที่ยังมีงานรอ worker อยู่
 * ไม่รีเฟรชตอนที่มีช่องกรอกถูกโฟกัสอยู่ กันค่าที่กำลังพิมพ์สะดุด
 */
export function AutoRefresh({ active, seconds = 5 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [active, seconds, router]);
  return null;
}
