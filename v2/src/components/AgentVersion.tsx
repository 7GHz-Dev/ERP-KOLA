'use client';

import { useEffect, useState } from 'react';
import { AGENT_VERSION, isLatestAgent } from '@/lib/agent-version';
import type { AgentMachine } from '@/lib/agent-machines';

/**
 * เวอร์ชันโค้ดของเครื่องในออฟฟิศเทียบกับเวอร์ชันล่าสุดของ ERP (lib/agent-version)
 * เครื่องที่เก่ากว่าอัปเดตตัวเองเบื้องหลังตอนเปิด Windows และตอนกดปุ่ม/ลิงก์ที่เปิดตัวเปิดของเครื่อง
 */
export function AgentVersionBadge({ version }: { version: string | null | undefined }) {
  if (isLatestAgent(version)) {
    return <span className="badge approved" title="โค้ดบนเครื่องนี้เป็นรุ่นล่าสุด">v{version} ล่าสุด</span>;
  }
  return (
    <span className="badge pending"
      title={`ล่าสุดคือ v${AGENT_VERSION} — เครื่องอัปเดตเองตอนเปิดครั้งถัดไป (หรือรันตัวติดตั้งซ้ำ)`}>
      {version ? `v${version}` : 'รุ่นก่อนมีเลขเวอร์ชัน'} · ยังไม่ล่าสุด
    </span>
  );
}

/** ตารางเครื่องที่ติดตั้งแล้ว — ใช้ในส่วน "ติดตั้งบนเครื่องนี้" โหลดเมื่อเปิดดู */
export function AgentVersions() {
  const [machines, setMachines] = useState<AgentMachine[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/agent-versions', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { ok: boolean; machines?: AgentMachine[] }) => { if (alive) setMachines(d.ok ? d.machines ?? [] : []); })
      .catch(() => { if (alive) setMachines([]); });
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <p>
        <b>เวอร์ชันล่าสุด v{AGENT_VERSION}</b> — เครื่องที่ติดตั้งแล้วอัปเดตเองเบื้องหลัง ตอนเปิด Windows
        และทุกครั้งที่กดปุ่ม/ลิงก์ที่เปิดโปรแกรมบนเครื่อง (ไม่ต้องรันตัวติดตั้งซ้ำ ยกเว้นเครื่องที่ติดตั้งก่อนมีระบบเวอร์ชัน)
      </p>
      {machines === null ? <small>กำลังโหลดรายชื่อเครื่อง…</small>
        : machines.length === 0 ? <small>ยังไม่มีเครื่องรายงานเวอร์ชัน (เครื่องที่ติดตั้งรุ่นก่อนต้องรันตัวติดตั้งซ้ำหนึ่งครั้ง)</small>
        : (
          <table className="agent-versions">
            <thead><tr><th>เครื่อง</th><th>เวอร์ชัน</th><th>รายงานล่าสุด</th></tr></thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.machine}>
                  <td>{m.machine}</td>
                  <td>
                    <AgentVersionBadge version={m.version} />
                    {m.status ? <small className="muted"> {m.status}</small> : null}
                  </td>
                  <td>{new Date(m.seenAt).toLocaleString('th-TH', { hour12: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
