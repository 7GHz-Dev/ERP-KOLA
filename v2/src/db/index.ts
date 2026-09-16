import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { loadEnv } from '../lib/env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ยังไม่ได้ตั้ง DATABASE_URL — คัดลอก .env.example เป็น .env.local แล้วใส่ค่าจาก Supabase');

/*
 * Next.js dev รีโหลดโมดูลบ่อย ถ้าไม่ cache ไว้จะเปิด connection ใหม่ทุกครั้งจนเต็ม pool
 * บน Vercel ก็ cache เหมือนกัน เพราะแต่ละ instance ถูกใช้ซ้ำหลาย request
 * ถ้าเปิด pool ใหม่ทุกครั้งจะเสียเวลา handshake (~350ms) ก่อน query แรกเสมอ
 */
const globalForDb = globalThis as unknown as { kolaSql?: ReturnType<typeof postgres> };

const sql = globalForDb.kolaSql ?? postgres(url, {
  prepare: false,

  /*
   * ต่อผ่าน transaction pooler (พอร์ต 6543) ซึ่งแจก connection ต่อ transaction อยู่แล้ว
   * ฝั่งเราจึงเปิดค้างไว้เท่าที่จำเป็น — instance บน Vercel มีหลายตัวพร้อมกัน
   * มากเกินไปจะกิน quota ของ pooler จนตัวอื่นต้องรอคิว
   *
   * เดิมตั้งไว้ 5 ซึ่งตันเวลาหน้าเดียวยิงหลาย query พร้อมกัน
   * (หน้า Master Data นับจำนวนทุกชนิดแล้วดึงรายการ · ตารางงานดึงงานกับนับพร้อมกัน)
   * พอคำขอเกินห้าตัว ตัวที่เหลือรอคิวจนหน้าค้างไปหลายวินาที
   * 10 ยังอยู่ในระดับที่ pooler รับไหวสำหรับหลาย instance
   */
  max: 10,

  // ปิด connection ที่ว่างนานเกินไป กัน pooler ตัดทิ้งข้างเดียวแล้วเราเพิ่งมารู้ตอนใช้
  idle_timeout: 20,
  max_lifetime: 60 * 30,

  // ยอมรอต่อ connection ไม่เกินเท่านี้ ดีกว่าค้างยาวจนผู้ใช้กดใหม่ซ้ำ
  connect_timeout: 10,
});

globalForDb.kolaSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
