import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KOLA Import ERP',
  description: 'ระบบจัดการงานนำเข้า',
};

/*
 * ต้องมี viewport ไม่งั้นมือถือจะถือว่าหน้ากว้าง 980px แล้วย่อทั้งหน้าลงมา
 * ตัวหนังสือจะเล็กจนอ่านไม่ออกและกฎ @media ของจอแคบก็ไม่ทำงาน
 * ไม่ล็อกการซูม ผู้ใช้ยังขยายดูตัวเลขในไฟล์ได้
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/*
 * ตั้งคลาสซ่อนเมนูก่อนหน้าจะถูกวาด
 *
 * ถ้ารอให้ React ทาคลาสหลัง hydrate ผู้ใช้ที่เคยซ่อนเมนูไว้จะเห็นเมนูแวบขึ้นมา
 * แล้วหายไปทุกครั้งที่เปิดหน้า สคริปต์นี้เล็กและรันก่อน paint จึงไม่มีจังหวะกระพริบ
 *
 * เกณฑ์ต้องตรงกับ SidebarToggle เป๊ะ (ยังไม่เคยเลือก = มือถือซ่อน จอใหญ่กาง)
 * ถ้าสองที่ไม่ตรงกัน หน้าจะกระพริบสลับสถานะตอน hydrate
 */
const NAV_INIT = `try{var v=localStorage.getItem('kola-sidebar-hidden');
if(v==='1'||(v===null&&matchMedia('(max-width:820px)').matches))
document.documentElement.classList.add('nav-hidden')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NAV_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
