'use client';

import { useMemo, useRef, useState } from 'react';

/**
 * ช่องเลือกที่พิมพ์ค้นหาได้
 *
 * Master Data มี Shipper หลายร้อยราย เลื่อนหาใน <select> ธรรมดาช้ากว่าพิมพ์สองสามตัวอักษร
 * ค้นทั้งรหัสและชื่อ และไม่บังคับให้พิมพ์ตรงเป๊ะ — ต้องเลือกจากรายการเสมอ
 * เพื่อให้ได้ id จริงจาก Master Data ไม่ใช่ชื่อที่สะกดกันคนละแบบ
 */
export type Choice = { id: string; code: string | null; name: string };

export function SearchSelect({
  choices, value, onChange, placeholder,
}: {
  choices: Choice[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = choices.find((c) => c.id === value) ?? null;
  const label = (c: Choice) => (c.code ? `${c.code} · ${c.name}` : c.name);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { list: choices, more: 0 };
    // แยกคำ เพื่อให้พิมพ์ "kola ship" เจอ "KOLA SHIPPING" ได้โดยไม่ต้องเรียงตรงกัน
    const words = q.split(/\s+/);
    const hit = choices.filter((c) => {
      const hay = `${c.code ?? ''} ${c.name}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return { list: hit, more: 0 };
  }, [choices, query]);

  return (
    <div className="search-select">
      <input
        type="text"
        value={open ? query : selected ? label(selected) : ''}
        placeholder={placeholder}
        onFocus={(e) => {
          setQuery('');
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // รอให้คลิกในรายการทำงานก่อนค่อยปิด
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.stopPropagation();
          }
        }}
      />
      {open ? (
        <ul className="search-select-list">
          {matches.list.length ? (
            matches.list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === value ? 'active' : undefined}
                  onMouseDown={() => {
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                  }}
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  {label(c)}
                </button>
              </li>
            ))
          ) : (
            <li className="empty">ไม่พบรายการที่ตรงกับ “{query}”</li>
          )}
        </ul>
      ) : null}
      {open && matches.list.length ? (
        <div className="search-select-count">
          {query.trim() ? `พบ ${matches.list.length} รายการ` : `ทั้งหมด ${choices.length} รายการ`}
        </div>
      ) : null}
    </div>
  );
}
