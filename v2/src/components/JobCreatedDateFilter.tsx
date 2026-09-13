'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function JobCreatedDateFilter({ createdFrom, createdTo }: {
  createdFrom: string;
  createdTo: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(createdFrom);
  const [to, setTo] = useState(createdTo);
  const [pending, startTransition] = useTransition();

  function apply(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set('createdFrom', nextFrom);
    else params.delete('createdFrom');
    if (nextTo) params.set('createdTo', nextTo);
    else params.delete('createdTo');
    params.delete('page');
    startTransition(() => {
      router.replace(`/jobs?${params}`, { scroll: false });
    });
  }

  return (
    <div className="search-form chip-row" aria-busy={pending}>
      <label>วันที่สร้าง JOB ตั้งแต่ <input type="date" name="createdFrom" value={from}
        onChange={(event) => {
          if (event.target.validity.valid) apply(event.target.value, event.target.value);
        }} /></label>
      <label>ถึง <input type="date" name="createdTo" value={to} min={from || undefined}
        onChange={(event) => {
          if (event.target.validity.valid) apply(from, event.target.value);
        }} /></label>
      {(from || to) ? <button className="button tiny" type="button" onClick={() => apply('', '')}>ล้างวันที่</button> : null}
      <span className="meta" role="status">{pending ? 'กำลังปรับตาราง…' : 'Export ใช้ช่วงวันที่ที่เลือก'}</span>
    </div>
  );
}
