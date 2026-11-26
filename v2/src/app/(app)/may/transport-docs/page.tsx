import { requireUserReady } from '@/lib/auth';
import { shipmeConfigured } from '@/lib/shipme-client';
import { TransportDocsUpload } from '@/components/TransportDocsUpload';

export const dynamic = 'force-dynamic';

/**
 * MAY — อัปไฟล์ใบขน / E-Office เข้า ERP SHIPME (ชั่วคราว ระหว่างที่ KOLA ยังส่งเอกสารเองไม่ได้)
 * ไฟล์ไปเก็บที่ SHIPME อย่างเดียว ไม่แนบเข้างานใน KOLA · สเปก: docs/SHIPME-TRANSPORT-REQUEST.md
 */
export default async function MayTransportDocsPage() {
  await requireUserReady(['MAY']);
  return (
    <>
      <div className="page-head">
        <h1>อัปใบขน / E-Office → SHIPME <span className="badge neutral">ชั่วคราว</span></h1>
        <p>เลือกหลายไฟล์พร้อมกัน · ระบบแยกประเภทและจับคู่ BL ให้ · ไฟล์ไปขึ้นป้ายเอกสารในแพลนงานของ SHIPME · อัปทีหลังได้ อัปซ้ำ = ใช้ไฟล์ใหม่</p>
      </div>
      <TransportDocsUpload shipmeReady={shipmeConfigured()} />
    </>
  );
}
