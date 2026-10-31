'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshCustoms } from '@/lib/actions/automation';
import { MONITOR_LINK } from '@/components/CustomsMonitor';
import { NetbayUserPicker, useNetbayUser } from '@/components/NetbayUser';

/**
 * ปุ่ม Refresh — เข้าไปเช็กใบขนที่ค้างใน NETBAY ตอนกดเลย (ไม่รอรอบ 5 นาทีของตัว monitor) ด้วย NETBAY user ที่เลือก
 * อยู่ที่หัวหน้า ตรวจ Draft / รอไฟล์และเลขใบขน และคิวงาน Automation
 *
 * กดแล้วเซิร์ฟเวอร์บันทึกคำขอ (lib/customs-monitor requestRefresh)
 *   ตัว monitor ออนไลน์อยู่ (เครื่องไหนก็ได้) = ตัวนั้นเห็นภายใน 10 วินาทีแล้วเช็กทันที
 *   ไม่มีตัวไหนออนไลน์ = เปิดตัว monitor บนเครื่องที่กด (kola-worker://customs) ตัวนั้นเช็กทันทีที่เปิด
 * เช็กเสร็จ (ERP บันทึก doneAt) หน้าโหลดข้อมูลใหม่เอง
 *
 * กดซ้ำได้ครั้งละหนึ่งนาที (รวมทุกคน — เซิร์ฟเวอร์เป็นคนกัน) ปุ่มนับถอยหลังให้เห็น
 * จำเวลากดไว้ในเบราว์เซอร์ด้วย โหลดหน้าใหม่ปุ่มก็ยังนับต่อ ไม่ต้องกดแล้วโดนปฏิเสธ
 */
const COOLDOWN_MS = 60_000;                // ตรง REFRESH_COOLDOWN_MS ใน lib/customs-monitor
const LAST_KEY = 'kola-customs-refresh-at';
/** ไม่มีตัว monitor รับคำขอภายในเวลานี้ — บอกให้เปิดบนเครื่องนี้ */
const NO_TAKER_MS = 45_000;

type Refresh = { at: string; doneAt: string | null; worker: string | null; username: string;
  result: { accepted: number; waiting: number; failed: number } | null };

function readLast() {
  try { return Number(localStorage.getItem(LAST_KEY) ?? 0) || 0; } catch { return 0; }
}

export function CustomsRefresh() {
  const router = useRouter();
  const netbayUser = useNetbayUser('customs');
  const [now, setNow] = useState(() => Date.now());
  const [lastAt, setLastAt] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [sending, setSending] = useState(false);
  const [mine, setMine] = useState<string | null>(null);      // เวลาของคำขอที่กดจากหน้านี้ (รอผล)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' | 'muted' } | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => { setLastAt(readLast()); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // รอผลคำขอที่กดจากหน้านี้ — ถามสถานะทุก 3 วินาที เสร็จแล้วโหลดข้อมูลหน้าใหม่
  useEffect(() => {
    if (!mine) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/worker-status?mode=customs', { cache: 'no-store' });
        const data = (await res.json()) as { ok: boolean; refresh?: Refresh | null; workers?: unknown[] };
        const r = data.refresh;
        if (!alive || !data.ok) return;
        setOnline((data.workers ?? []).length > 0);
        if (!r) return;
        if (r.at !== mine) { setMine(null); return; }           // มีคนกดใหม่ทับไปแล้ว
        if (r.doneAt) {
          setMine(null);
          setNote({
            text: r.result
              ? `เช็กเสร็จ (${r.username}) — ACCEPT ${r.result.accepted} · รอ ${r.result.waiting}${r.result.failed ? ` · ผิดพลาด ${r.result.failed}` : ''}`
              : `เช็กเสร็จ (${r.username})`,
            tone: 'ok',
          });
          router.refresh();
        }
      } catch { /* เน็ตสะดุด รอบหน้าค่อยถามใหม่ */ }
    };
    const t = setInterval(poll, 3_000);
    return () => { alive = false; clearInterval(t); };
  }, [mine, router]);

  const cooldownLeft = Math.max(0, Math.max(lastAt + COOLDOWN_MS, waitUntil) - now);
  const disabled = sending || cooldownLeft > 0;
  // ตัว monitor ที่ออนไลน์อาจกำลังเช็กรอบปกติอยู่ (รอบละหลายสิบวินาที) — เตือนเร็วเฉพาะตอนไม่มีตัวไหนออนไลน์
  // ออนไลน์อยู่แต่เกิน 2 นาทียังไม่เสร็จ = อาจเป็นตัวรุ่นเก่าที่ไม่รู้จัก Refresh
  const elapsed = mine ? now - Date.parse(mine) : 0;
  const stuck = mine !== null && (online ? elapsed > 120_000 : elapsed > NO_TAKER_MS);

  async function press() {
    if (disabled) return;
    setSending(true);
    setNote(null);
    try {
      const r = await refreshCustoms(netbayUser);
      if (!r.ok) {
        if ('waitSec' in r && r.waitSec) setWaitUntil(Date.now() + r.waitSec * 1000);
        setNote({ text: r.reason, tone: 'warn' });
        router.refresh();
        return;
      }
      const at = Date.parse(r.at);
      setLastAt(at);
      try { localStorage.setItem(LAST_KEY, String(at)); } catch { /* นับถอยหลังแค่ในหน้านี้ */ }
      setMine(r.at);
      if (r.online) {
        setNote({ text: `ส่งให้ตัว monitor เช็ก ${r.pending} รายการแล้ว — กำลังเช็กใน NETBAY…`, tone: 'muted' });
      } else {
        setNote({ text: `เปิดตัว monitor บนเครื่องนี้เช็ก ${r.pending} รายการ…`, tone: 'muted' });
        window.location.href = MONITOR_LINK;
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="worker-launcher customs-refresh">
      <NetbayUserPicker purpose="customs" />
      <button type="button" className="button tiny primary" disabled={disabled} onClick={press}
        title="เข้าไปเช็กสถานะใบขนที่ค้างใน NETBAY ตอนนี้เลย แล้วดึงเลขใบขน + PDF ของใบที่ ACCEPT แล้ว">
        {sending ? 'กำลังส่ง…' : cooldownLeft > 0 ? `↻ Refresh (${Math.ceil(cooldownLeft / 1000)} วิ)` : '↻ Refresh เช็ก NETBAY'}
      </button>
      {note ? <small className={`worker-launcher-note ${note.tone === 'warn' ? '' : 'muted'}`}>{note.text}</small> : null}
      {stuck ? (
        <small className="worker-launcher-note">
          {online ? 'ตัว monitor ยังเช็กไม่เสร็จ (อาจเป็นรุ่นเก่าที่ไม่รู้จัก Refresh)' : 'ยังไม่มีตัว monitor รับไปเช็ก'}
          {' '}— <a href={MONITOR_LINK}>เปิดบนเครื่องนี้</a>
          {' '}(ถ้ากดแล้วไม่ขึ้น แปลว่าเครื่องนี้ยังไม่ได้ติดตั้งตัวเปิด)
        </small>
      ) : null}
    </div>
  );
}
