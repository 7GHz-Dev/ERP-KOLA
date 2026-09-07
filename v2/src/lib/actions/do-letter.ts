'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import {
  DO_LETTER_ASSET_PREFIX, DO_LETTER_FIELDS, LETTER_BLOCKS, LETTER_COMPANIES, SHIPPING_LINES,
  blockCode, lineKey, saveDoLetterValues,
  signKey, signNameKey, stampKey, stampNameKey, type CompanyNo,
} from '@/lib/do-letter';
import { ensureBucket, uploadFile } from '@/lib/storage';
import { storeDoLetterPdf } from '@/lib/do-letter-store';
import { logActivity, newId, runAction, text } from './common';

/**
 * บันทึกแบบฟอร์มจดหมายแลก D/O จากหน้า /master/do-letter
 *
 * ช่องที่เว้นว่าง = กลับไปใช้ค่าที่สืบทอดมา (ค่ากลาง แล้วค่าตั้งต้นในโค้ด)
 * จึงลบแถวนั้นทิ้งแทนการเก็บค่าว่าง เพื่อไม่ให้ค่าว่างไปบังค่ากลาง
 *
 * รวบทุกช่องใส่ Map ก่อนแล้วค่อยยิงทีเดียว — เดิมบันทึกทีละช่องจนกดทีรอหลายวินาที
 */
async function saveDoLetterFormImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const line = text(formData.get('line'), 60);
  if (line && !SHIPPING_LINES.includes(line as (typeof SHIPPING_LINES)[number])) {
    throw new Error('ไม่พบสายเรือที่เลือก');
  }

  const entries = new Map<string, string>();
  /** ช่องที่ฟอร์มไม่ได้ส่งมาต้องคงค่าเดิมไว้ ไม่ใช่ลบทิ้ง */
  const collect = (field: string, maxLength: number) => {
    if (!formData.has(field)) return;
    entries.set(line ? lineKey(line, field) : field, text(formData.get(field), maxLength));
  };

  for (const field of DO_LETTER_FIELDS) {
    if (line && field.sharedOnly) continue;
    collect(field.key, 4000);
  }

  // พิกัดของแต่ละบล็อก — ว่าง = กลับไปใช้ตำแหน่งเริ่มต้น
  for (const block of LETTER_BLOCKS) {
    for (const part of ['x', 'y', 'gap'] as const) collect(blockCode(block.key, part), 12);
  }

  await saveDoLetterValues(entries, () => newId('MD'));

  await logActivity(user.id, 'SAVE_DO_LETTER_FORM', 'doLetterForm', line || 'shared', { line });
  revalidatePath('/master/do-letter');
}

export async function saveDoLetterForm(formData: FormData) {
  return runAction(() => saveDoLetterFormImpl(formData));
}

/*
 * แก้ข้อความบนจดหมายแลก D/O ของงานหนึ่ง แล้วออกจดหมายใหม่ทันที
 *
 * เก็บค่าที่แก้ไว้กับงาน ไม่ไปแตะ blNo / eta / vessel ตัวจริง
 * เพราะสายเรือขอให้แก้ถ้อยคำบนจดหมายไม่ได้แปลว่าข้อมูลงานผิด
 * ตารางงาน ใบขน และชุด E-Office จึงยังเห็นค่าเดิมทุกที่
 *
 * ช่องที่ล้างจนว่างคือขอให้กลับไปใช้ค่าจากงาน จึงเก็บเป็น null ไม่ใช่สตริงว่าง
 * ออกจดหมายใหม่ให้เลยในคำสั่งเดียว ผู้ใช้จะได้ไม่ต้องกดสองครั้งแล้วลืมกดปุ่มที่สอง
 */
async function saveDoLetterTextImpl(formData: FormData) {
  const user = await requireActiveSession(['ANN']);
  const jobId = text(formData.get('jobId'), 80);
  if (!jobId) throw new Error('ไม่พบงาน');

  const field = (name: string) => text(formData.get(name), 200) || null;

  await db.update(jobs).set({
    doLetterBlNo: field('blNo'),
    doLetterOrigin: field('origin'),
    doLetterDestination: field('destination'),
    doLetterVessel: field('vessel'),
    doLetterEta: field('eta'),
    updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));

  const { id } = await storeDoLetterPdf(jobId, user.id);
  await logActivity(user.id, 'EDIT_DO_LETTER_TEXT', 'JOB', jobId, { fileId: id });

  revalidatePath('/do-exchange');
  revalidatePath(`/do-exchange/${jobId}/letter`);
}

export async function saveDoLetterText(formData: FormData) {
  return runAction(() => saveDoLetterTextImpl(formData));
}

/** ขนาดสูงสุดของรูปตราและลายเซ็น — เล็กกว่าไฟล์แนบทั่วไปเพราะเป็นรูปเดียว */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/**
 * อัปโหลดตราประทับหรือลายเซ็นของบริษัทหนึ่ง
 *
 * รับเฉพาะ PNG กับ JPEG เพราะตัววาด PDF ฝังได้แค่สองแบบนี้
 * แนะนำ PNG พื้นหลังโปร่ง จะได้ไม่มีกรอบสี่เหลี่ยมขาวทับข้อความบนจดหมาย
 */
async function uploadDoLetterAssetImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);

  const co = Number(text(formData.get('company'), 4)) as CompanyNo;
  if (!LETTER_COMPANIES.includes(co)) throw new Error('ไม่พบบริษัทที่เลือก');
  const kind = text(formData.get('kind'), 10);
  if (kind !== 'stamp' && kind !== 'sign') throw new Error('ชนิดรูปไม่ถูกต้อง');

  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์');
  if (blob.size > MAX_ASSET_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 4 MB');

  const bytes = Buffer.from(await blob.arrayBuffer());
  const isPng = bytes.subarray(1, 4).toString('latin1') === 'PNG';
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) throw new Error('ต้องเป็นไฟล์ PNG หรือ JPG เท่านั้น');

  const key = `${DO_LETTER_ASSET_PREFIX}/${newId('IMG')}-${kind}${co}${isPng ? '.png' : '.jpg'}`;
  await ensureBucket();
  await uploadFile(key, bytes, isPng ? 'image/png' : 'image/jpeg');

  await saveDoLetterValues(new Map([
    [kind === 'stamp' ? stampKey(co) : signKey(co), key],
    [kind === 'stamp' ? stampNameKey(co) : signNameKey(co), blob.name],
  ]), () => newId('MD'));

  await logActivity(user.id, 'UPLOAD_DO_LETTER_ASSET', 'doLetterForm', `${kind}${co}`,
    { fileName: blob.name });
  revalidatePath('/master/do-letter');
}

/** เอาตราหรือลายเซ็นออก กลับไปเว้นที่ให้เซ็นสด */
async function removeDoLetterAssetImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const co = Number(text(formData.get('company'), 4)) as CompanyNo;
  if (!LETTER_COMPANIES.includes(co)) throw new Error('ไม่พบบริษัทที่เลือก');
  const kind = text(formData.get('kind'), 10);
  if (kind !== 'stamp' && kind !== 'sign') throw new Error('ชนิดรูปไม่ถูกต้อง');

  /*
   * ล้างค่าในตารางอย่างเดียว ไม่ลบไฟล์ใน storage
   * จดหมายที่ออกไปแล้วฝังรูปไว้ในตัว PDF จึงไม่กระทบ และถ้าเผลอลบก็ยังกู้กลับได้
   */
  await saveDoLetterValues(new Map([
    [kind === 'stamp' ? stampKey(co) : signKey(co), ''],
    [kind === 'stamp' ? stampNameKey(co) : signNameKey(co), ''],
  ]), () => newId('MD'));

  await logActivity(user.id, 'REMOVE_DO_LETTER_ASSET', 'doLetterForm', `${kind}${co}`, {});
  revalidatePath('/master/do-letter');
}

export async function uploadDoLetterAsset(formData: FormData) {
  return runAction(() => uploadDoLetterAssetImpl(formData));
}
export async function removeDoLetterAsset(formData: FormData) {
  return runAction(() => removeDoLetterAssetImpl(formData));
}
