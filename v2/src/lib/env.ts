/**
 * โหลดตัวแปรสภาพแวดล้อมสำหรับสคริปต์ที่รันนอก Next.js
 *
 * Next.js อ่าน .env.local ให้เอง แต่ drizzle-kit และสคริปต์ที่รันด้วย tsx ไม่อ่าน
 * ถ้าไม่โหลดตรงนี้ ค่าจะเป็น undefined แล้วเครื่องมือจะค้างเงียบ ๆ โดยไม่บอกสาเหตุ
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  // .env.local ทับ .env เหมือนลำดับของ Next.js
  for (const file of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

export function requireEnv(name: string, hint: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `\nไม่พบตัวแปร ${name}\n\n${hint}\n\n` +
        `วิธีตั้งค่า:\n` +
        `  1) cp .env.example .env.local\n` +
        `  2) เปิด .env.local แล้วใส่ค่าให้ครบ\n`,
    );
  }
  return value;
}
