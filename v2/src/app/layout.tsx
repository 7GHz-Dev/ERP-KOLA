import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KOLA Import ERP',
  description: 'ระบบจัดการงานนำเข้า',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
