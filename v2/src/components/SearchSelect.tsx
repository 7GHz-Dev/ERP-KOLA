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

/**
 * ช่องเลือกที่พิมพ์ค้นหาได้ แต่เก็บค่าเป็น "ข้อความ" ไม่ใช่ id
 *
 * ใช้กับช่องที่ฐานข้อมูลเก็บเป็นชื่อตรง ๆ อย่าง PORT OF LOADING
 * ซึ่งต่างจาก Shipper/Consignee ที่ผูกกับแถวใน Master Data ด้วย id
 *
 * เดิมช่องนี้เป็น <input list=…> ซึ่งบนหลายเบราว์เซอร์ไม่มีปุ่มกางรายการให้เห็น
 * ต้องเดาว่าพิมพ์อะไรถึงจะขึ้น ท่าเรือที่ตั้งไว้ใน Master Data จึงเหมือนไม่มี
 * ตรงนี้กางรายการให้เห็นทั้งหมดตั้งแต่กดช่อง เลือกได้เลยโดยไม่ต้องพิมพ์
 *
 * ยังพิมพ์ค่าที่ไม่มีในรายการได้เหมือนเดิม เพราะท่าเรือใหม่ ๆ โผล่มาก่อน
 * ที่จะมีคนไปเพิ่มใน Master Data เสมอ — บังคับให้เลือกจากรายการอย่างเดียวจะคีย์งานไม่ได้
 */
export function SearchText({
  choices, value, onChange, placeholder, name,
}: {
  choices: Choice[];
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  /** ชื่อช่องที่ส่งขึ้นเซิร์ฟเวอร์ */
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    // ยังไม่ได้พิมพ์อะไร หรือเพิ่งกดเข้าช่อง — กางทั้งรายการให้เลือก
    if (!q || !typing) return choices;
    const words = q.split(/\s+/);
    return choices.filter((c) => {
      const hay = `${c.code ?? ''} ${c.name}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [choices, value, typing]);

  return (
    <div className="search-select">
      <input
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setTyping(false);
          setOpen(true);
        }}
        onChange={(e) => {
          setTyping(true);
          setOpen(true);
          onChange(e.target.value.toUpperCase());
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.stopPropagation();
          }
        }}
      />
      {open && matches.length ? (
        <ul className="search-select-list">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={c.name === value ? 'active' : undefined}
                onMouseDown={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                }}
                onClick={() => {
                  onChange(c.name);
                  setOpen(false);
                }}
              >
                {c.code ? `${c.code} · ${c.name}` : c.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && matches.length ? (
        <div className="search-select-count">
          {typing && value.trim()
            ? `พบ ${matches.length} รายการ · พิมพ์ค่าที่ไม่มีในรายการได้`
            : `ทั้งหมด ${choices.length} รายการ`}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ช่อง PORT OF LOADING พร้อมสถานะในตัว
 *
 * ฟอร์มที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ถือ state เองไม่ได้ จึงห่อ SearchText ไว้อีกชั้น
 * ให้ฝั่งเซิร์ฟเวอร์ส่งมาแค่ค่าเริ่มต้นกับรายการท่าเรือ
 */
export function OriginPortField({
  choices, initial,
}: {
  choices: Choice[];
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SearchText
      name="originPort"
      choices={choices}
      value={value}
      onChange={setValue}
      placeholder="เลือกหรือพิมพ์ เช่น NAGOYA"
    />
  );
}
