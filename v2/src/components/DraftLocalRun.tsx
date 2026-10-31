'use client';

import { useEffect } from 'react';
import { submitDraftTask } from '@/lib/actions/automation';
import { ConfirmSubmit } from '@/components/Interactions';
import { useNetbayUser } from '@/components/NetbayUser';

/**
 * สร้าง Draft บนเครื่องที่กด — ไม่ส่งไปให้ worker เครื่องอื่นทำ
 *
 * กดปุ่มแล้วจำไว้ในแท็บนี้ว่ากดจากที่นี่ พอหน้าโหลดใหม่และงานเข้าคิวแล้ว (มีเลขงาน)
 * จึงเปิดลิงก์ kola-worker://draft?task=<เลขงาน> ให้ตัวเปิดในเครื่องรัน worker เฉพาะงานนี้
 * คนอื่นที่เปิดหน้าเดียวกันอยู่ไม่มีค่านี้ จึงไม่ถูกเปิด worker ตามไปด้วย
 */
const flagKey = (jobId: string) => `kola-draft-local:${jobId}`;

export function SubmitDraftLocal({ jobId, label }: { jobId: string; label?: string }) {
  // บัญชีที่เลือกไว้ที่แถบ "สร้าง Draft อัตโนมัติ" ด้านบน (ว่าง = บัญชีประจำเครื่อง)
  const netbayUser = useNetbayUser('draft');
  return (
    <form
      action={submitDraftTask}
      className="inline-form"
      onSubmit={() => {
        try { sessionStorage.setItem(flagKey(jobId), String(Date.now())); } catch { /* ใช้ปุ่มเปิดบนเครื่องนี้แทน */ }
      }}
    >
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="netbayUser" value={netbayUser} />
      <ConfirmSubmit
        label={label ?? 'สร้าง Draft'}
        tone="primary"
        confirm={`สร้าง Draft ใบขนบนเครื่องนี้ด้วย NETBAY user ${netbayUser || 'ประจำเครื่อง'} ใช่ไหม`}
        detail="เครื่องนี้จะเปิด NETBAY สร้างใบขนจาก Final Invoice ให้ (ต้องติดตั้งตัวติดตั้ง ERP-KOLA บนเครื่องนี้แล้ว) · เปลี่ยนบัญชีได้ที่ช่อง NETBAY user ด้านบน"
      />
    </form>
  );
}

export function DraftLocalLaunch({ jobId, taskId }: { jobId: string; taskId: string }) {
  const href = `kola-worker://draft?task=${encodeURIComponent(taskId)}`;
  useEffect(() => {
    let at = 0;
    try { at = Number(sessionStorage.getItem(flagKey(jobId)) ?? 0); } catch { /* ไม่มีที่เก็บ */ }
    if (!at || Date.now() - at > 3 * 60_000) return;
    try { sessionStorage.removeItem(flagKey(jobId)); } catch { /* ไม่เป็นไร */ }
    window.location.href = href;
  }, [jobId, href]);
  return (
    <span className="draft-local">
      <span className="badge pending">กำลังสร้าง Draft บนเครื่องที่กด</span>
      <a className="button tiny" href={href} title="ถ้าไม่มีหน้าต่าง NETBAY ขึ้นมา กดเพื่อเปิดบนเครื่องนี้อีกครั้ง">
        เปิดบนเครื่องนี้
      </a>
    </span>
  );
}
