'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { customsEntries, eofficeRequests, jobSequences, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { storeRequestPdf } from '@/lib/eoffice-bundle';
import { loadEofficeForm } from '@/lib/eoffice-form';
import { logActivity, newId, number, required, runAction, text } from './common';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** เลขที่คำร้องถัดไป — ล็อกแถวไว้กันสองคนออกเลขซ้ำกัน */
async function nextRunningNo(tx: Tx): Promise<string> {
  const year = String(new Date().getFullYear());
  const [existing] = await tx
    .select()
    .from(jobSequences)
    .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, 'EOFFICE')))
    .for('update')
    .limit(1);

  let next: number;
  if (existing) {
    next = existing.lastNumber + 1;
    await tx.update(jobSequences)
      .set({ lastNumber: next, updatedAt: new Date() })
      .where(eq(jobSequences.id, existing.id));
  } else {
    next = 1;
    await tx.insert(jobSequences).values({
      id: newId('SEQ'), year, prefix: 'EOFFICE', lastNumber: next,
    });
  }
  return String(next).padStart(4, '0');
}

/**
 * ออกคำร้องขอนำของเข้าเขตปลอดอากร
 *
 * เก็บค่าที่พิมพ์ลงกระดาษไว้ในตาราง เพราะข้อมูลใน Job อาจเปลี่ยนทีหลัง
 * แต่กระดาษที่ยื่นไปแล้วต้องพิมพ์ซ้ำได้เหมือนเดิมทุกตัวอักษร
 */
async function createEofficeRequestImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const [entry] = await db.select().from(customsEntries)
    .where(eq(customsEntries.jobId, jobId)).orderBy(desc(customsEntries.updatedAt)).limit(1);
  const entryNo = entry?.declarationNo ?? '';
  if (!entryNo) throw new Error('ต้องมีเลขใบขนสินค้าขาเข้าก่อนออกคำร้อง');

  const goodsValue = text(formData.get('goodsValue'), 60);
  const goodsCurrency = text(formData.get('goodsCurrency'), 10).toUpperCase() || 'USD';
  if (!goodsValue) throw new Error('กรุณาระบุราคาของ');

  const packageCount = `${number(formData.get('packageCount'), Number(job.unitAmount ?? 0))} ${
    text(formData.get('packageType'), 20) || job.packageType || 'UNITS'
  }`.trim();
  const netWeight = `${text(formData.get('netWeight'), 40) || Number(job.grossWeight ?? 0)} KGM`;
  const goodsType = text(formData.get('goodsType'), 200)
    || `${job.product ?? 'สินค้า'} (รายละเอียดตามใบขนฯ แนบ)`;
  const attentionName = text(formData.get('attentionName'), 120);

  // เล่มที่ของคำร้องมาจากหน้าตั้งค่าฟอร์มปะหน้า ด่านเปลี่ยนเล่มทีก็แก้ตรงนั้น
  const bookNo = (await loadEofficeForm()).t('bookNo');

  const requestNo = await db.transaction(async (tx) => {
    const running = await nextRunningNo(tx);
    const full = `${bookNo}/${running}`;

    // ออกใหม่ทับของเดิมได้ แต่เก็บเลขเดิมไว้ไม่ให้เลขวิ่งฟรี
    const [existing] = await tx.select().from(eofficeRequests)
      .where(eq(eofficeRequests.jobId, jobId)).limit(1);

    const values = {
      jobId, jobNo: job.jobNo,
      requestNo: existing?.requestNo ?? full,
      bookNo,
      runningNo: existing?.runningNo ?? running,
      requestDate: new Date().toISOString().slice(0, 10),
      entryNo, packageCount, netWeight,
      goodsValue: `${goodsValue} ${goodsCurrency}`,
      goodsType,
      attentionName,
      createdBy: user.id,
      updatedAt: new Date(),
    };

    if (existing) {
      await tx.update(eofficeRequests).set(values).where(eq(eofficeRequests.id, existing.id));
      return existing.requestNo;
    }
    await tx.insert(eofficeRequests).values({ id: newId('EOF'), ...values });
    return full;
  });

  await db.update(jobs)
    .set({ goodsValue, goodsCurrency, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await logActivity(user.id, 'CREATE_EOFFICE_REQUEST', 'JOB', jobId, { requestNo, entryNo });

  // ออกไฟล์ PDF ให้เลย ชุดรวม E-Office จะได้มีคำร้องอยู่ด้วยโดยไม่ต้องพิมพ์แล้วอัปโหลดกลับ
  await storeRequestPdf(jobId, user.id);

  revalidatePath('/pending');
  redirect(`/eoffice/${jobId}`);
}

export async function createEofficeRequest(formData: FormData) {
  return runAction(() => createEofficeRequestImpl(formData));
}
