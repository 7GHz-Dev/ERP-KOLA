import Link from 'next/link';
import { MASTER_TYPES } from '@/lib/queries/master';

/** ปะหน้า E-Office ไม่ใช่ตารางอ้างอิงแบบอื่น จึงมีหน้าจอของตัวเองแทนที่จะเป็นแท็บหนึ่งใน /master */
export const EOFFICE_FORM_MENU_KEY = 'eofficeForm';
export const DO_LETTER_MENU_KEY = 'doLetterForm';

/** เมนูซ้ายของหมวด Master Data ใช้ร่วมกันทุกหน้าในหมวดนี้ */
export function MasterMenu({
  current, counts,
}: { current: string; counts: Map<string, number> }) {
  return (
    <nav className="master-menu">
      {MASTER_TYPES.map((t) => (
        <Link
          key={t.key}
          href={`/master?type=${t.key}`}
          prefetch
          aria-current={t.key === current ? 'page' : undefined}
        >
          {t.label} <small>({counts.get(t.key) ?? 0})</small>
        </Link>
      ))}
      <Link
        href="/master/eoffice"
        prefetch
        aria-current={current === EOFFICE_FORM_MENU_KEY ? 'page' : undefined}
      >
        ฟอร์มปะหน้า E-Office
      </Link>
      <Link
        href="/master/do-letter"
        prefetch
        aria-current={current === DO_LETTER_MENU_KEY ? 'page' : undefined}
      >
        ฟอร์มจดหมายแลก DO
      </Link>
    </nav>
  );
}
