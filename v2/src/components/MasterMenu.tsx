import Link from 'next/link';
import { MASTER_TYPES } from '@/lib/queries/master';

/** ปะหน้า E-Office ไม่ใช่ตารางอ้างอิงแบบอื่น จึงมีหน้าจอของตัวเองแทนที่จะเป็นแท็บหนึ่งใน /master */
export const EOFFICE_FORM_MENU_KEY = 'eofficeForm';
export const DO_LETTER_MENU_KEY = 'doLetterForm';
export const USERS_MENU_KEY = 'users';
export const JOBS_MENU_KEY = 'jobs';

/*
 * เมนูซ้ายของหมวด Master Data ใช้ร่วมกันทุกหน้าในหมวดนี้
 *
 * ปิด prefetch ทุกลิงก์ เพราะทุกหน้าในหมวดนี้เป็น force-dynamic
 * และแต่ละหน้าต้องยิง query นับจำนวนทุกชนิดกับดึงรายการของชนิดนั้น
 *
 * เมนูมี 17 ลิงก์ เลื่อนเมาส์ผ่านทีเดียว Next จะโหลดล่วงหน้าพร้อมกันหมด
 * ซึ่งเกินขนาด pool ของฐานข้อมูล (5 connection) คำขอที่เหลือจึงต้องรอคิว
 * ทำให้ตอนกดจริงค้างไปหลายวินาที ทั้งที่หน้านั้นโหลดเดี่ยว ๆ เร็วมาก
 *
 * หน้าพวกนี้เบาอยู่แล้ว โหลดตอนกดก็ทันใจ ไม่ต้องเตรียมล่วงหน้า
 */
export function MasterMenu({
  current, counts,
}: { current: string; counts: Map<string, number> }) {
  return (
    <nav className="master-menu">
      <Link href="/master/jobs" prefetch={false} aria-current={current === JOBS_MENU_KEY ? 'page' : undefined}>
        ปิดการใช้งาน JOB
      </Link>
      {MASTER_TYPES.map((t) => (
        <Link
          key={t.key}
          href={`/master?type=${t.key}`}
          prefetch={false}
          aria-current={t.key === current ? 'page' : undefined}
        >
          {t.label} <small>({counts.get(t.key) ?? 0})</small>
        </Link>
      ))}
      <Link
        href="/master/eoffice"
        prefetch={false}
        aria-current={current === EOFFICE_FORM_MENU_KEY ? 'page' : undefined}
      >
        ฟอร์มปะหน้า E-Office
      </Link>
      <Link
        href="/master/do-letter"
        prefetch={false}
        aria-current={current === DO_LETTER_MENU_KEY ? 'page' : undefined}
      >
        ฟอร์มจดหมายแลก DO
      </Link>
      <Link
        href="/master/users"
        prefetch={false}
        aria-current={current === USERS_MENU_KEY ? 'page' : undefined}
      >
        ผู้ใช้งาน
      </Link>
    </nav>
  );
}
