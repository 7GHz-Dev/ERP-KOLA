'use client';

import { useState } from 'react';
import type { CargoCar } from '@/lib/cargo-invoice/parse';
import type { TariffResult, TariffRule } from '@/lib/cargo-invoice/tariff';

/** ส่วนที่ใช้ร่วมกันระหว่าง Create Cargo Invoice แบบอ่านไฟล์ (CargoInvoiceTool) กับแบบคีย์เอง (CargoInvoiceNormal) */

export type Tariff = TariffResult & { similar: TariffRule[]; suggest: { ccMin: number; ccMax: number } | null };

export async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

/** ฟอร์มเพิ่มกฎพิกัดของรถรุ่นใหม่ — ค่าตั้งต้นจากรถคันนี้ ช่วง CC ตามช่วงที่ตารางใช้บ่อย */
export function AddRule({ car, tariff, onAdded }: { car: Pick<CargoCar, 'brand' | 'model' | 'fuel' | 'cc'>; tariff: Tariff; onAdded: () => Promise<void> }) {
  const [v, setV] = useState({
    code: '', brand: car.brand, model: car.model, fuel: car.fuel,
    ccMin: String(tariff.suggest?.ccMin ?? car.cc ?? 0), ccMax: String(tariff.suggest?.ccMax ?? car.cc ?? 99999),
    wMin: '0', wMax: '99999',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await call('/api/cargo-invoice/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cgi-add">
      <p>เพิ่มพิกัดให้รถรุ่นนี้ — บันทึกแล้วใช้ได้ทันทีทั้งระบบ คันอื่นรุ่นเดียวกันในช่วง CC / น้ำหนักนี้จะหาเจอเอง</p>
      <div className="cgi-add-grid">
        <label>พิกัด (8 หลัก)<input value={v.code} onChange={set('code')} placeholder="เช่น 87032290" inputMode="numeric" autoFocus /></label>
        <label>ยี่ห้อ<input value={v.brand} onChange={set('brand')} /></label>
        <label>รุ่น<input value={v.model} onChange={set('model')} /></label>
        <label>เชื้อเพลิง<input value={v.fuel} onChange={set('fuel')} /></label>
        <label>CC ตั้งแต่<input value={v.ccMin} onChange={set('ccMin')} inputMode="numeric" /></label>
        <label>CC ถึง<input value={v.ccMax} onChange={set('ccMax')} inputMode="numeric" /></label>
        <label>น้ำหนัก (KG) ตั้งแต่<input value={v.wMin} onChange={set('wMin')} inputMode="numeric" /></label>
        <label>น้ำหนัก (KG) ถึง<input value={v.wMax} onChange={set('wMax')} inputMode="numeric" /></label>
      </div>
      {tariff.similar.length ? (
        <div className="cgi-similar">
          <span>รุ่นเดียวกันในตาราง (คนละเชื้อเพลิงหรือช่วง CC) — กดเพื่อใช้พิกัดเดียวกัน:</span>
          {tariff.similar.map((r) => (
            <button key={r.id} type="button" className="chip-toggle small" onClick={() => setV({ ...v, code: r.code })}>
              {r.code} · {r.fuel} · CC {r.ccMin}-{r.ccMax}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <p className="cgi-error">⚠️ {err}</p> : null}
      <button type="button" className="button primary" disabled={busy} onClick={() => void submit()}>{busy ? 'กำลังบันทึก…' : 'บันทึกพิกัด'}</button>
    </div>
  );
}
