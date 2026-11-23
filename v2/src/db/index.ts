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
const globalForDb = globalThis as unknown as {
  kolaSql?: ReturnType<typeof postgres>;
  kolaTxSql?: ReturnType<typeof postgres>;
};

const common = {
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
} as const;

/*
 * ห้าม pipeline (ส่ง query ถัดไปเข้า connection เดิมก่อนตัวก่อนหน้าตอบ) — max_pipeline: 0
 *
 * transaction pooler (Supavisor) ค้างถาวรเมื่อเจอ query ที่ pipeline ข้าม transaction
 * postgres.js ทำแบบนั้นเองทุกครั้งที่ query รอคิวเกิน connection ที่มี (ค่าตั้งต้น 100 ต่อ connection)
 * ทดลองแล้ว: max 3 ยิง 12 ตัวพร้อมกัน ค้างไม่ตอบ ไม่ error · ตั้ง 0 แล้วยิง 500 ตัวพร้อมกันผ่านใน 2 วินาที
 * (ตั้ง 1 ไม่พอ — ตัวแรกไม่นับ ยังมี 2 ตัวค้างใน connection)
 *
 * เหตุการณ์จริง 23 พ.ย. 69 08:28 — บันทึกแผง D/O รัว ๆ ทำให้ query ซ้อนเกินคิว
 * connection ค้างทั้ง pool ทุกหน้ารวมถึง login รอจนครบ 300 วินาที ระบบเข้าไม่ได้ ~20 นาที
 */
// max_pipeline มีใน postgres.js (src/index.js) แต่ไม่อยู่ใน type ของ package จึงต้อง cast
const sql = globalForDb.kolaSql ?? postgres(url, { ...common, max_pipeline: 0 } as Parameters<typeof postgres>[1]);

/*
 * transaction ใช้อีก pool หนึ่ง เพราะ max_pipeline: 0 ทำให้ sql.begin จอง connection ไม่ได้ (UNSAFE_TRANSACTION)
 * ใน transaction pipeline ได้ปลอดภัย — pooler ผูก connection ฝั่งฐานข้อมูลไว้จนกว่าจะ commit
 * และแต่ละ transaction จอง connection ของตัวเองตั้งแต่ BEGIN จึงไม่ซ้อนข้าม transaction
 */
const txSql = globalForDb.kolaTxSql ?? postgres(url, { ...common, max: 5 });

globalForDb.kolaSql = sql;
globalForDb.kolaTxSql = txSql;

// drizzle ตั้งตัวแปลงวันที่/JSON ลงใน options ของ client — ทำกับ pool ของ transaction ด้วย ให้อ่านค่าเหมือนกัน
drizzle(txSql);

/*
 * drizzle ใช้ client แค่ unsafe (query ทั่วไป) · begin (transaction) · options
 * ส่งแต่ละอย่างไปที่ pool ที่ถูกต้อง
 */
const client = Object.assign(
  (...args: Parameters<typeof sql>) => sql(...args),
  sql,
  { unsafe: sql.unsafe, begin: txSql.begin, options: sql.options },
) as unknown as typeof sql;

export const db = drizzle(client, { schema });
export { schema };
