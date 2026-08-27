'use client';

import { useEffect, useRef } from 'react';

/**
 * ชิ้นส่วนเล็ก ๆ ที่ต้องตอบสนองในเบราว์เซอร์
 *
 * แผงกรอกข้อมูลใช้ <details> ซึ่งไม่มีปุ่มปิดและกด Esc ไม่ได้เอง
 * ส่วนการยืนยันใช้ <dialog> ของเบราว์เซอร์ ซึ่งกด Esc ปิดได้ให้อยู่แล้ว
 */

/** หัวแผงพร้อมปุ่มปิด — ปิด <details> ที่ครอบอยู่ */
export function PopoverHead({ title }: { title: string }) {
  return (
    <div className="popover-head">
      <b>{title}</b>
      <button
        type="button"
        className="popover-close"
        aria-label="ปิด"
        onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
      >
        ×
      </button>
    </div>
  );
}

/** ปุ่มยกเลิกท้ายแผง สำหรับแผงยาว ๆ ที่ต้องเลื่อนจนหัวแผงเลยขอบจอไปแล้ว */
export function PopoverCancel() {
  return (
    <button
      type="button"
      className="button tiny"
      onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
    >
      ยกเลิก
    </button>
  );
}

/**
 * ปิดแผงที่กางอยู่ด้วย Esc หรือคลิกนอกแผง
 *
 * ฉากหลังที่วาดด้วย summary::before ปิดได้อยู่แล้วในกรณีปกติ
 * แต่แผงที่ยาวจนต้องเลื่อน บางทีคลิกไปโดนตัวแผงเองหรือขอบที่ไม่ใช่ฉากหลัง
 * ดักที่ระดับเอกสารอีกชั้นจึงปิดได้เสมอไม่ว่าจะคลิกตรงไหน
 */
export function DisclosureBehavior() {
  useEffect(() => {
    const closeAll = () => {
      document.querySelectorAll<HTMLDetailsElement>('details.disclosure[open]')
        .forEach((d) => d.removeAttribute('open'));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!document.querySelector('details.disclosure[open]')) return;
      closeAll();
      e.stopPropagation();
    };

    /**
     * ส่งฟอร์มในแผงแล้วต้องปิดแผงเอง
     *
     * <details> เปิดค้างอยู่เพราะแอตทริบิวต์ open ถูกตั้งโดยเบราว์เซอร์ ไม่ใช่ React
     * พอหน้าเรนเดอร์ใหม่หลังบันทึก React จึงไม่แตะมัน แผงเลยค้างเปิดทุกครั้ง
     * ฟอร์มที่จัดการเองอยู่แล้ว (เช่นอัปโหลดที่มีแถบ %) ติด data-keep-open ไว้ให้ข้าม
     */
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLElement | null;
      if (!form || form.hasAttribute('data-keep-open')) return;
      form.closest('details.disclosure[open]')?.removeAttribute('open');
    };

    const onClick = (e: MouseEvent) => {
      const open = document.querySelector('details.disclosure[open]');
      if (!open) return;
      const target = e.target as HTMLElement | null;
      // คลิกในแผงหรือบนปุ่มที่เปิดแผงนั้น ไม่ต้องปิด
      if (target?.closest('details.disclosure[open]')) return;
      if (target?.closest('dialog')) return;
      closeAll();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);
  return null;
}

/**
 * ปุ่มที่ถามยืนยันก่อนส่งจริง
 *
 * ใช้ <dialog> ของเบราว์เซอร์ ได้ Esc กับฉากหลังมาฟรี และปุ่มยืนยันข้างในยังนับเป็น
 * ปุ่ม submit ของฟอร์มด้านนอกตามปกติ จึงไม่ต้องเขียนโค้ดส่งฟอร์มเอง
 * (ห้ามใส่ <form method="dialog"> ข้างใน เพราะจะกลายเป็นฟอร์มซ้อนฟอร์ม)
 */
export function ConfirmSubmit({
  label, confirm, tone, detail, name, value,
}: {
  label: string;
  confirm: string;
  tone?: 'primary' | 'danger' | 'ok';
  detail?: string;
  /** ใช้เมื่อฟอร์มมีปุ่มส่งหลายปุ่ม เพื่อให้ฝั่งเซิร์ฟเวอร์รู้ว่ากดปุ่มไหน */
  name?: string;
  value?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className={`button tiny ${tone ?? ''}`}
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog ref={dialog} className="confirm-dialog">
        <div className="popover-head">
          <b>ยืนยัน</b>
          <button
            type="button"
            className="popover-close"
            aria-label="ปิด"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <p className="confirm-text">{confirm}</p>
        {detail ? <p className="confirm-detail">{detail}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => dialog.current?.close()}>
            ยกเลิก
          </button>
          <button className={`button ${tone ?? 'primary'}`} type="submit" name={name} value={value}>
            {label}
          </button>
        </div>
      </dialog>
    </>
  );
}
