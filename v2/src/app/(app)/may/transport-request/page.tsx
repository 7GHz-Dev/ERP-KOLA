import { requireUserReady } from '@/lib/auth';
import { aiConfigured } from '@/lib/read-ai';
import { shipmeConfigured } from '@/lib/shipme-client';
import { TransportRequestImport } from '@/components/TransportRequestImport';

export const dynamic = 'force-dynamic';

/**
 * MAY — ส่ง Transport Request เข้าตารางขนส่ง / แพลนงานของ ERP SHIPME (ชั่วคราว ระหว่างที่ KOLA ยังส่งแพลนเองไม่ได้)
 * สเปก: docs/SHIPME-TRANSPORT-REQUEST.md
 */
export default async function MayTransportRequestPage() {
  await requireUserReady(['MAY']);
  return (
    <>
      <div className="page-head">
        <h1>ส่ง Transport Request → SHIPME <span className="badge neutral">ชั่วคราว</span></h1>
        <p>
          อ่านรูปตารางหรือข้อความจากชีต · จับคู่กับงานใน KOLA · ตรวจกับ SHIPME แล้วส่งเข้าตารางขนส่งและแพลนงาน ·
          วันที่ของงาน = คอลัมน์ TRANSPORT
        </p>
      </div>
      <TransportRequestImport shipmeReady={shipmeConfigured()} aiReady={aiConfigured()} />
    </>
  );
}
