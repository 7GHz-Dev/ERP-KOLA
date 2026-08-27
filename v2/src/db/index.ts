import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '../lib/env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ยังไม่ได้ตั้ง DATABASE_URL — คัดลอก .env.example เป็น .env.local แล้วใส่ค่าจาก Supabase');

// Next.js dev รีโหลดโมดูลบ่อย ถ้าไม่ cache ไว้จะเปิด connection ใหม่ทุกครั้งจนเต็ม pool
const globalForDb = globalThis as unknown as { kolaSql?: ReturnType<typeof postgres> };
const sql = globalForDb.kolaSql ?? postgres(url, { prepare: false, max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.kolaSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
