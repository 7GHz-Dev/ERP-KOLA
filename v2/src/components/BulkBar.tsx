'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * เลือกหลายแถวแล้วสั่งทีเดียว
 *
 * ตารางเรนเดอร์ฝั่งเซิร์ฟเวอร์ ส่ง prop ลงไปถึง <tr> ไม่ได้
 * จึงดักคลิกที่ชั้นนอกชั้นเดียวแล้วอ่าน data-pick จากช่องติ๊กที่โดน
 * แบบเดียวกับที่ DoFillBoard ทำกับปุ่มในแถว
 *
 * แถบสรุปโผล่เฉพาะตอนเลือกแล้ว ไม่กินที่ตอนไม่ได้ใช้
 */
export function BulkBar({
  action, label, confirmText, idName, children,
}: {
  action: (formData: FormData) => Promise<unknown>;
  /** ข้อความบนปุ่ม — {n} จะถูกแทนด้วยจำนวนที่เลือก */
  label: string;
  confirmText: string;
  /** ชื่อช่องที่ส่งขึ้นเซิร์ฟเวอร์ เช่น jobIds หรือ approvalIds */
  idName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /*
   * ทาสถานะติ๊กกลับลงไปที่ช่องจริงใน DOM
   * ช่องพวกนี้อยู่ในตารางที่เซิร์ฟเวอร์เรนเดอร์ จึงคุมด้วย React state ตรง ๆ ไม่ได้
   */
  useEffect(() => {
    document.querySelectorAll<HTMLInputElement>('[data-pick]').forEach((box) => {
      box.checked = picked.includes(box.dataset.pick ?? '');
    });
    const all = document.querySelector<HTMLInputElement>('[data-pick-all]');
    if (all) {
      const boxes = document.querySelectorAll<HTMLInputElement>('[data-pick]');
      all.checked = boxes.length > 0 && picked.length === boxes.length;
      all.indeterminate = picked.length > 0 && picked.length < boxes.length;
    }
  }, [picked]);

  const run = async () => {
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.set(idName, picked.join(','));
    /*
     * runAction ของระบบนี้ไม่ได้คืน error กลับมา แต่ redirect กลับหน้าเดิมพร้อม ?err=
     * แล้วแถบ ActionAlert ที่ layout เป็นคนแสดงข้อความ ตรงนี้จึงไม่ต้องจัดการเอง
     * เหลือแค่ดัก error ของเครือข่ายที่ redirect ไปไม่ถึง
     */
    try {
      await action(fd);
      setPicked([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="bulk-root"
      onChange={(e) => {
        const box = e.target as HTMLInputElement;
        if (box.dataset.pickAll !== undefined) {
          const all = [...document.querySelectorAll<HTMLInputElement>('[data-pick]')]
            .map((b) => b.dataset.pick ?? '')
            .filter(Boolean);
          setPicked(box.checked ? all : []);
          return;
        }
        const id = box.dataset.pick;
        if (!id) return;
        setPicked((cur) => (box.checked ? [...new Set([...cur, id])] : cur.filter((v) => v !== id)));
      }}
    >
      {children}

      {picked.length ? (
        <div className="bulk-bar" role="status">
          <span>เลือกไว้ {picked.length} รายการ</span>
          {error ? <span className="bulk-error">{error}</span> : null}
          <button type="button" className="button tiny" onClick={() => setPicked([])}>
            ล้างที่เลือก
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() => {
              if (window.confirm(confirmText.replace('{n}', String(picked.length)))) void run();
            }}
          >
            {busy ? 'กำลังทำ…' : label.replace('{n}', String(picked.length))}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** ช่องติ๊กในแถว — เป็น markup เปล่าที่ตารางฝั่งเซิร์ฟเวอร์เรนเดอร์ได้ */
export function PickBox({ id }: { id: string }) {
  return <input type="checkbox" className="pick-box" data-pick={id} aria-label="เลือกรายการนี้" />;
}

/** ช่องติ๊กหัวตาราง — เลือกทั้งหมดในหน้า */
export function PickAllBox() {
  return (
    <input type="checkbox" className="pick-box" data-pick-all="" aria-label="เลือกทั้งหมด" />
  );
}
