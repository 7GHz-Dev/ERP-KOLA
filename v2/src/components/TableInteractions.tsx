'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ดับเบิลคลิกที่แถวเพื่อเปิด Drawer — พฤติกรรมเดียวกับระบบเดิม
 *
 * ดักที่ตารางทีเดียวแล้วอ่าน data-open-job จากแถวที่โดน ไม่ต้องแขวน
 * event ทีละแถว และข้ามกรณีที่ดับเบิลคลิกโดนปุ่มหรือช่องกรอก
 * เพราะการกดปุ่มรัว ๆ ไม่ควรเปิด Drawer ตามมา
 *
 * พร้อมกันนั้นเก็บลำดับ id ของแถวไว้ให้ปุ่ม ◀ ▶ ใน Drawer เดินตามลำดับที่เห็นบนจอ
 */

const ROWS_KEY = 'kola.rows';

export function TableInteractions({ ids }: { ids: string[] }) {
  const router = useRouter();

  useEffect(() => {
    try {
      sessionStorage.setItem(ROWS_KEY, JSON.stringify(ids));
    } catch {
      // เบราว์เซอร์ที่ปิด storage ไว้ก็ยังใช้งานตารางได้ แค่ไม่มีปุ่มเดินหน้าถอยหลัง
    }
  }, [ids]);

  useEffect(() => {
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('a, button, input, select, textarea, summary, label')) return;
      const row = target.closest('tr[data-open-job]') as HTMLElement | null;
      if (!row) return;
      const id = row.dataset.openJob;
      if (id) router.push(`/job/${id}`);
    };
    document.addEventListener('dblclick', onDoubleClick);
    return () => document.removeEventListener('dblclick', onDoubleClick);
  }, [router]);

  return null;
}
