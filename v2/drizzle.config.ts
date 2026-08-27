import type { Config } from 'drizzle-kit';
import { requireEnv } from './src/lib/env';

// drizzle-kit ไม่อ่าน .env.local ให้เอง ต้องโหลดตรงนี้ ไม่งั้นจะได้ undefined แล้วค้างเงียบ ๆ
const url = requireEnv(
  'DATABASE_URL',
  'ต้องมี connection string ของ Postgres ก่อนจึงจะสร้างตารางได้\n' +
    'หาได้จาก Supabase → Project Settings → Database → Connection string (Transaction pooler)',
);

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
} satisfies Config;
