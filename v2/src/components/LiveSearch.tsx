'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ค้นหาทันทีที่พิมพ์ในช่องใต้หัวคอลัมน์
 *
 * ต้องหาตัวฟอร์มใหม่ทุกครั้งที่ยิง ห้ามจำไว้ตั้งแต่ตอน mount
 * เพราะหลังเปลี่ยน URL React สร้าง DOM ชุดใหม่ ตัวที่จำไว้จะกลายเป็นซากที่หลุดจากหน้า
 * อ่านค่าจากซากนั้นได้ค่าว่าง คำค้นจึงหายไปตั้งแต่ตัวอักษรที่สอง
 *
 * รอให้หยุดพิมพ์ก่อนค่อยยิง เพราะทุกครั้งคือ query ใหม่ที่ฐานข้อมูล
 */
const DELAY_MS = 250;

export function LiveSearch({ formId, basePath }: { formId: string; basePath: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ชื่อช่องที่กำลังพิมพ์อยู่ ใช้คืนโฟกัสหลังหน้าถูกวาดใหม่ */
  const focused = useRef<{ name: string; caret: number } | null>(null);

  useEffect(() => {
    const run = () => {
      // เริ่มจากพารามิเตอร์ที่อยู่บน URL ตอนนี้ แล้วทับเฉพาะช่องค้นหา
      // จะได้ไม่ทำแท็บหรือการเรียงลำดับที่เลือกไว้หลุดหาย
      const params = new URLSearchParams(window.location.search);
      document
        .querySelectorAll<HTMLInputElement>(`input[type="search"][form="${formId}"]`)
        .forEach((input) => {
          const v = input.value.trim();
          if (v) params.set(input.name, v);
          else params.delete(input.name);
        });
      const q = params.toString();
      router.replace(q ? `${basePath}?${q}` : basePath, { scroll: false });
    };

    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'search') return;
      if (target.getAttribute('form') !== formId) return;

      focused.current = { name: target.name, caret: target.selectionStart ?? target.value.length };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, DELAY_MS);
    };

    // ช่องค้นหาอยู่ในตาราง ผูกกับฟอร์มด้วย form="..." จึงต้องดักที่ระดับเอกสาร
    document.addEventListener('input', onInput);
    return () => {
      document.removeEventListener('input', onInput);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [formId, basePath, router]);

  // หน้าถูกวาดใหม่หลังค้นหา ต้องคืนโฟกัสและตำแหน่งพิมพ์ให้ช่องเดิม
  useEffect(() => {
    const want = focused.current;
    if (!want) return;
    const input = document.querySelector<HTMLInputElement>(
      `input[type="search"][name="${want.name}"]`,
    );
    if (!input || document.activeElement === input) return;
    input.focus();
    try {
      input.setSelectionRange(want.caret, want.caret);
    } catch {
      /* บางเบราว์เซอร์ไม่ยอมให้ตั้งตำแหน่งกับ input[type=search] */
    }
  });

  return null;
}
