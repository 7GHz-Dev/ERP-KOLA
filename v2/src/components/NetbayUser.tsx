'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { NetbayChoice } from '@/lib/netbay-accounts';

/**
 * เลือกบัญชี NETBAY ก่อนกด "สร้าง Draft" (purpose draft) และ "Refresh" (purpose customs)
 *
 * ช่องเลือกอยู่ที่แถบด้านบนช่องเดียว ปุ่มทุกแถวในหน้าอ่านค่าเดียวกัน (ไม่ต้องมีช่องเลือกทุกแถว)
 * จำค่าไว้ในเบราว์เซอร์นี้ — เปิดหน้าใหม่ได้บัญชีเดิม · ที่เก็บใช้ไม่ได้ก็จำแค่ระหว่างเปิดหน้านี้
 * ค่าว่าง = ค่าตั้งต้น: draft ใช้บัญชีประจำเครื่องที่กด · customs ใช้บัญชีของตัว monitor
 */
export type NetbayPurpose = 'draft' | 'customs';

const storageKey = (p: NetbayPurpose) => `kola-netbay-user:${p}`;
const memory: Record<NetbayPurpose, string> = { draft: '', customs: '' };
const listeners = new Set<() => void>();

function read(p: NetbayPurpose) {
  try { return localStorage.getItem(storageKey(p)) ?? memory[p]; } catch { return memory[p]; }
}

function write(p: NetbayPurpose, value: string) {
  memory[p] = value;
  try { localStorage.setItem(storageKey(p), value); } catch { /* จำแค่ในหน้านี้ */ }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith('kola-netbay-user:')) l(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}

export function useNetbayUser(p: NetbayPurpose) {
  return useSyncExternalStore(subscribe, () => read(p), () => '');
}

let choicesRequest: Promise<NetbayChoice[]> | null = null;
function loadChoices() {
  choicesRequest ??= fetch('/api/netbay-accounts', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d: { ok: boolean; choices?: NetbayChoice[] }) => (d.ok ? d.choices ?? [] : []))
    .catch(() => { choicesRequest = null; return []; });
  return choicesRequest;
}

export function NetbayUserPicker({ purpose }: { purpose: NetbayPurpose }) {
  const value = useNetbayUser(purpose);
  const [choices, setChoices] = useState<NetbayChoice[]>([]);
  useEffect(() => { let alive = true; void loadChoices().then((c) => { if (alive) setChoices(c); }); return () => { alive = false; }; }, []);

  // บัญชีที่จำไว้ถูกถอดออกจากชุดแล้ว — กลับไปค่าตั้งต้น ไม่ส่งชื่อที่ไม่มีไปให้เซิร์ฟเวอร์ปฏิเสธ
  useEffect(() => {
    if (choices.length && value && !choices.some((c) => c.username === value)) write(purpose, '');
  }, [choices, value, purpose]);

  const fallback = purpose === 'draft'
    ? 'บัญชีประจำเครื่องนี้'
    : `บัญชี monitor${choices.find((c) => c.kind === 'monitor') ? ` (${choices.find((c) => c.kind === 'monitor')!.username})` : ''}`;
  return (
    <label className="netbay-user" title="บัญชี NETBAY ที่ใช้ — เลือกบัญชีที่เครื่องอื่นกำลังใช้อยู่ เครื่องนั้นจะหลุดจาก NETBAY">
      <span className="filter-label">NETBAY user</span>
      <select value={value} onChange={(e) => write(purpose, e.target.value)}>
        <option value="">{fallback}</option>
        {choices.filter((c) => !(purpose === 'customs' && c.kind === 'monitor')).map((c) => (
          <option key={c.username} value={c.username}>
            {c.username}{c.kind === 'monitor' ? ' (monitor)' : c.machine ? ` · เครื่อง ${c.machine}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
