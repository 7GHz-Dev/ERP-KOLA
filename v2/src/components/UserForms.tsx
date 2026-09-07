'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  COMPANIES, DEPARTMENTS, POSITIONS, ROLE_INFO, rolesForDepartment,
} from '@/lib/org';
import { createUser, resetUserPassword, setUserActive, updateUser } from '@/lib/actions/users';
import type { UserRow } from '@/lib/queries/users';

/**
 * ฟอร์มจัดการผู้ใช้
 *
 * เลือกแผนกก่อน แล้วรายการสิทธิ์จะเหลือเฉพาะที่แผนกนั้นใช้ได้
 * เพราะสิทธิ์ที่ไม่เข้ากับแผนกถูกฝั่งเซิร์ฟเวอร์ปฏิเสธอยู่แล้ว
 * ตัดออกตั้งแต่ในเมนูจึงไม่ทำให้คนกรอกเสียเที่ยว
 */

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" type="submit" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/** ช่องแผนก ตำแหน่ง และสิทธิ์ ใช้ร่วมกันทั้งตอนเพิ่มและตอนแก้ */
function OrgFields({ value }: { value?: UserRow }) {
  const [department, setDepartment] = useState(value?.department ?? DEPARTMENTS[0].key);
  const roles = rolesForDepartment(department);
  const [role, setRole] = useState(value?.role ?? roles[0]);

  const dept = DEPARTMENTS.find((d) => d.key === department);
  const company = COMPANIES.find((c) => c.key === dept?.company);
  // แผนกเปลี่ยนแล้วสิทธิ์เดิมอาจใช้ไม่ได้ ต้องถอยไปใช้ตัวแรกของแผนกใหม่
  const effectiveRole = roles.includes(role) ? role : roles[0];

  return (
    <>
      <label className="field">
        <span>แผนก</span>
        <select
          name="department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          {DEPARTMENTS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
        <small className="do-letter-hint">
          สังกัด {company?.kind}: {company?.label}
        </small>
      </label>

      <label className="field">
        <span>ตำแหน่ง</span>
        <select name="position" defaultValue={value?.position ?? 'Employee'}>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <label className="field">
        <span>สิทธิ์การใช้งาน</span>
        <select name="role" value={effectiveRole} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_INFO[r]?.label ?? r} ({r})</option>
          ))}
        </select>
        <small className="do-letter-hint">{ROLE_INFO[effectiveRole]?.detail}</small>
      </label>
    </>
  );
}

export function CreateUserForm() {
  return (
    <details className="user-add">
      <summary>+ เพิ่มผู้ใช้</summary>
      <form className="user-form" action={createUser}>
        <label className="field">
          <span>ชื่อผู้ใช้ (สำหรับล็อกอิน)</span>
          <input name="username" type="text" required maxLength={60} autoComplete="off" />
          <small className="do-letter-hint">a-z 0-9 จุด ขีดกลาง ขีดล่าง</small>
        </label>
        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input name="displayName" type="text" required maxLength={120} />
        </label>
        <OrgFields />
        <label className="field">
          <span>รหัสผ่านตั้งต้น</span>
          <input name="password" type="text" required minLength={10} maxLength={200} autoComplete="off" />
          <small className="do-letter-hint">
            อย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข · ผู้ใช้ต้องเปลี่ยนเองตอนล็อกอินครั้งแรก
          </small>
        </label>
        <div className="do-letter-actions">
          <Submit label="เพิ่มผู้ใช้" busy="กำลังเพิ่ม…" />
        </div>
      </form>
    </details>
  );
}

export function EditUserForm({ user }: { user: UserRow }) {
  return (
    <details className="user-edit">
      <summary>แก้ไข</summary>
      <form className="user-form" action={updateUser}>
        <input type="hidden" name="id" value={user.id} />
        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input name="displayName" type="text" required maxLength={120} defaultValue={user.displayName} />
        </label>
        <OrgFields value={user} />
        <div className="do-letter-actions">
          <Submit label="บันทึก" busy="กำลังบันทึก…" />
        </div>
      </form>
    </details>
  );
}

export function ResetPasswordForm({ user }: { user: UserRow }) {
  return (
    <details className="user-edit">
      <summary>ตั้งรหัสใหม่</summary>
      <form className="user-form" action={resetUserPassword}>
        <input type="hidden" name="id" value={user.id} />
        <label className="field">
          <span>รหัสผ่านใหม่ของ {user.username}</span>
          <input name="password" type="text" required minLength={10} maxLength={200} autoComplete="off" />
          <small className="do-letter-hint">
            ตั้งเสร็จแล้วระบบจะตัดผู้ใช้ออกจากระบบ และให้เปลี่ยนรหัสเองตอนล็อกอินครั้งถัดไป
          </small>
        </label>
        <div className="do-letter-actions">
          <Submit label="ตั้งรหัสใหม่" busy="กำลังตั้ง…" />
        </div>
      </form>
    </details>
  );
}

export function ToggleActiveForm({ user }: { user: UserRow }) {
  return (
    <form action={setUserActive}>
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="active" value={user.isActive ? '0' : '1'} />
      <button className={`button tiny ${user.isActive ? 'ghost' : ''}`} type="submit">
        {user.isActive ? 'ระงับ' : 'เปิดใช้'}
      </button>
    </form>
  );
}
