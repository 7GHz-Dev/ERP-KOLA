import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { logActivity } from '@/lib/actions/common';
import { storeInvoicePdf } from '@/lib/eoffice-bundle';
import { storeJobFileVersion } from '@/lib/job-files';
import { assignEngineNumbers } from '@/lib/engine-numbers';
import { xlsxToPdf } from '@/lib/xlsx-pdf';
import { cleanEdit, fieldProblems } from '@/lib/cargo-invoice/edit';
import { enginePrefix, existingEngineNumber } from '@/lib/cargo-invoice/engine-format';
import { draftCsv } from '@/lib/cargo-invoice/draft-csv';
import { cargoReader, cargoUser, json } from '@/lib/cargo-invoice/http';
import { jobById } from '@/lib/cargo-invoice/jobs';
import { buildNormalWorkbook, normalInvoice, type NormalCar, type NormalDoc } from '@/lib/cargo-invoice/normal';
import { allRules, lookup, TARIFF_CODE } from '@/lib/cargo-invoice/tariff';
import { writeSummary } from '@/lib/cargo-invoice/write';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Final Invoice แบบ NORMAL (ผู้ขายที่ไม่ใช่ JAN TRADING / AICHI) — คนคีย์ข้อมูลรถจากไฟล์ที่เปิดดูข้าง ๆ
 *
 *   mode=preview  PDF ของ Final Invoice (เลขเครื่อง xxxxxxx)
 *   mode=csv      CSV สำหรับ Draft ใบขน (เลขเครื่อง 0000000)
 *   mode=save     ออกเลขเครื่อง · บันทึกเป็น FINAL_INVOICE ของงาน + PDF
 *
 * ข้อมูลเรือ (VESSEL … CARRIER) ตู้ และที่อยู่ Shipper ดึงจากฐานข้อมูลใหม่ทุกครั้ง ไม่เชื่อค่าที่หน้าเว็บส่งมา
 */
type Body = {
  mode?: string; jobId?: string; shipperId?: string; currency?: string; invoiceDate?: string; invoiceNo?: string;
  cars?: Array<Record<string, unknown>>; tariffs?: unknown[];
};

const ymdToDmy = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json(); } catch { return json({ error: 'ข้อมูลที่ส่งมาอ่านไม่ได้' }, 400); }
  const mode = body.mode === 'save' ? 'save' : body.mode === 'csv' ? 'csv' : 'preview';
  const user = mode === 'save' ? await cargoUser() : await cargoReader();
  if (user instanceof Response) return user;

  const job = await jobById(String(body.jobId ?? ''));
  if (!job) return json({ error: 'เลือกงานก่อน — ข้อมูลเรือ BL และตู้มาจากงาน' }, 400);
  const [shipper] = body.shipperId ? await db.select({ name: masterRecords.name, address: masterRecords.address })
    .from(masterRecords).where(and(eq(masterRecords.id, String(body.shipperId)), eq(masterRecords.type, 'shippers'))).limit(1) : [];
  if (!shipper && mode === 'save') return json({ error: 'เลือก Shipper ก่อน' }, 400);

  const currency = String(body.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'เลือกสกุลเงิน (Currency) ก่อน' }, 400);
  const invoiceDate = ymdToDmy(String(body.invoiceDate ?? ''));
  const invoiceNo = String(body.invoiceNo ?? '').trim().toUpperCase().slice(0, 60);
  if (mode === 'save' && (!invoiceDate || !invoiceNo)) return json({ error: 'ใส่ Invoice Date และ Invoice No. ก่อนบันทึก' }, 400);

  const raw = Array.isArray(body.cars) ? body.cars.slice(0, 200) : [];
  if (!raw.length) return json({ error: 'ยังไม่มีรายการรถ — กด + เพิ่มคัน' }, 400);
  const boxes = job.containers.length ? job.containers : [];
  const cars = raw.map((c) => ({
    brand: String(cleanEdit('brand', c.brand) ?? ''), model: String(cleanEdit('model', c.model) ?? ''),
    chassis: String(cleanEdit('chassis', c.chassis) ?? ''), engine: String(cleanEdit('engine', c.engine) ?? ''),
    fuel: String(cleanEdit('fuel', c.fuel) ?? ''), cc: cleanEdit('cc', c.cc) as number | null,
    year: cleanEdit('year', c.year) as number | null, weight: cleanEdit('weight', c.weight) as number | null,
    price: cleanEdit('price', c.amount) as number | null,
    container: String(c.container ?? '').replace(/[\s-]/g, '').toUpperCase(),
  }));

  if (mode === 'save') {
    const problems = fieldProblems(cars);
    const bad = problems.findIndex((p) => p.length);
    if (bad >= 0) return json({ error: `คันที่ ${bad + 1}: ${problems[bad][0]}` }, 400);
    const noBox = cars.findIndex((c) => !c.container || (boxes.length && !boxes.includes(c.container)));
    if (noBox >= 0) return json({ error: `คันที่ ${noBox + 1}: เลือกตู้ของงาน ${job.jobNo}` }, 400);
  }

  // พิกัด — บันทึกต้องมาจากกฎเสมอ (เหมือน save route) · Preview / CSV ใช้เท่าที่เลือกไว้
  const chosen = Array.isArray(body.tariffs) ? body.tariffs.map((t) => String(t ?? '')) : [];
  const tariffs = cars.map((_, i) => chosen[i] ?? '');
  if (mode === 'save') {
    const rules = await allRules();
    for (const [i, car] of cars.entries()) {
      const res = lookup(rules, car);
      if (!TARIFF_CODE.test(tariffs[i]) || !res.candidates.some((c) => c.code === tariffs[i])) {
        return json({ error: res.status === 'missing'
          ? `คันที่ ${i + 1} ${car.brand} ${car.model} ยังไม่มีพิกัด — เพิ่มพิกัดก่อนบันทึก`
          : `พิกัดของคันที่ ${i + 1} ไม่ตรงกับกฎ — กดดึงพิกัดใหม่อีกครั้ง` }, 400);
      }
    }
  }

  // เลขเครื่อง: ส่วนหน้าขีดแรก + เลข 7 หลัก (เหมือน JAN TRADING / AICHI) — มีเลข 7 หลักอยู่แล้วใช้ตามนั้น
  let numbers = cars.map((c) => existingEngineNumber(c.engine) ?? (mode === 'csv' ? '0000000' : 'xxxxxxx'));
  let engines: { issued: number; reused: number } | null = null;
  if (mode === 'save') {
    const assigned = await assignEngineNumbers({
      jobId: job.id, blNo: (job.blNo ?? '').replace(/\s/g, '').toUpperCase(), invoiceNo, sourceFile: `${job.jobNo} NORMAL`,
      cars: cars.map((c) => ({ chassis: c.chassis, prefix: enginePrefix(c.engine), existing: existingEngineNumber(c.engine) })),
    });
    numbers = assigned.numbers;
    engines = { issued: assigned.issued, reused: assigned.reused };
  }

  const doc: NormalDoc = {
    shipper: { name: shipper?.name ?? '(เลือก Shipper)', address: shipper?.address ?? '' },
    invoiceNo, invoiceDate, currency,
    vessel: job.ship.vessel, voyage: job.ship.voyage, portOfLoading: job.ship.portOfLoading,
    portOfDestination: job.ship.portOfDestination, dateOfShip: ymdToDmy(job.ship.etd),
    blNo: (job.blNo ?? '').trim(), carrier: job.ship.carrier,
    containers: boxes.length ? boxes : [...new Set(cars.map((c) => c.container).filter(Boolean))],
    cars: cars.map((c, i): NormalCar => ({
      brand: c.brand, model: c.model, chassis: c.chassis, weight: c.weight, year: c.year, cc: c.cc, fuel: c.fuel,
      amount: c.price, container: c.container, engine: c.engine ? `${enginePrefix(c.engine)}-${numbers[i]}` : '',
    })),
  };
  let bytes: Buffer;
  try {
    bytes = await writeSummary(await buildNormalWorkbook(doc), normalInvoice(doc), tariffs);
  } catch (e) {
    return json({ error: `สร้าง Final Invoice ไม่ได้: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }

  if (mode === 'csv') {
    try { return json(await draftCsv(bytes)); } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
  }
  if (mode === 'preview') {
    const pdf = await xlsxToPdf(bytes);
    if (!pdf) return json({ error: 'แปลง PDF ไม่ได้' }, 400);
    return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  }

  const stored = await storeJobFileVersion({
    jobId: job.id, category: 'FINAL_INVOICE', bytes, fileName: `${job.jobNo} Final Invoice.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    userId: user.id, note: `สร้างจาก Create Cargo Invoice · NORMAL · ${cars.length} คัน · ${invoiceNo}`,
    changeReason: 'บันทึกใหม่จาก Create Cargo Invoice',
  });
  let pdf = true;
  try { pdf = Boolean(await storeInvoicePdf(job.id, user.id, bytes)); } catch { pdf = false; }
  await logActivity(user.id, stored.current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', stored.id,
    { jobId: job.id, category: 'FINAL_INVOICE', version: stored.version, source: 'CARGO_INVOICE_NORMAL', cars: cars.length, engines });
  revalidatePath('/pending');
  revalidatePath('/fah/fn');
  return json({ ok: true, jobId: job.id, jobNo: job.jobNo, fileId: stored.id, version: stored.version, pdf, engines, invoiceNo });
}
