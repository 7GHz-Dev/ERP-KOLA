'use server';

import { requireUser } from '@/lib/auth';
import { shipmeCall } from '@/lib/shipme-client';
import { aiConfigured, readTransportImage } from '@/lib/transport-request/ai-read';
import { jobsByBlKeys, jobsByDeclarationNos } from '@/lib/transport-request/jobs';
import {
  blCandidates, classifyDocFile, findJob, keyOf, mergeWithJob, type TrPreviewRow, type TrRow,
} from '@/lib/transport-request/parse';

/**
 * เมนูชั่วคราวของ MAY — ส่ง Transport Request / ไฟล์ใบขน·E-Office ไป ERP SHIPME (docs/SHIPME-TRANSPORT-REQUEST.md)
 * KOLA ไม่เขียนอะไรลงฐานข้อมูลของตัวเอง — ข้อมูลทั้งหมดไปเก็บที่ SHIPME
 * ทุก action คืน { ok:false, detail } แทนการ throw หน้าเว็บจะได้แสดงเหตุผลได้
 */
type Fail = { ok: false; detail: string };
const fail = (detail: string): Fail => ({ ok: false, detail });
const SOURCES = ['MAESOT FREEZONE', 'TRANSIT'];
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_ROWS = 300;

async function may() {
  try {
    return await requireUser(['MAY']);
  } catch {
    return null;
  }
}

// ---------------- Transport Request ----------------

/** อ่านรูปตาราง Transport Request (สูงสุด 5 รูป) — แถวเรียงต่อกันข้ามรูป */
export async function readTransportImages(fd: FormData): Promise<{ ok: true; rows: TrRow[]; baht: number } | Fail> {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  if (!aiConfigured()) return fail('ยังไม่ได้ตั้งค่า AI (ANTHROPIC_API_KEY) — ใช้แบบวางข้อความแทนได้');
  const images = fd.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
  if (!images.length) return fail('ยังไม่ได้เลือกรูป');
  if (images.length > MAX_IMAGES) return fail(`อ่านได้ครั้งละไม่เกิน ${MAX_IMAGES} รูป`);
  for (const f of images) {
    if (!IMAGE_TYPES.includes(f.type)) return fail(`${f.name}: รับเฉพาะรูป PNG / JPG / WEBP`);
    if (f.size > MAX_IMAGE_BYTES) return fail(`${f.name}: รูปใหญ่เกิน 10MB`);
  }
  const rows: TrRow[] = [];
  let baht = 0;
  for (const f of images) {
    try {
      const read = await readTransportImage(Buffer.from(await f.arrayBuffer()), f.type);
      baht += read.baht;
      for (const r of read.rows) rows.push({ ...r, line: rows.length + 1 });
    } catch (e) {
      return fail(`${f.name}: ${e instanceof Error ? e.message : 'อ่านไม่สำเร็จ'}`);
    }
  }
  if (!rows.length) return fail('อ่านรูปแล้วไม่พบแถวที่มีเลข BL');
  return { ok: true, rows, baht };
}

type ShipmePreview = {
  preview: { line: number; status: 'new' | 'update' | 'error'; error: string; warning: string; shipping: string }[];
  summary: { total: number; new: number; update: number; error: number; noShipping: number };
  committed: boolean;
};

/** ค่าที่หน้าเว็บส่งมาเชื่อไม่ได้ — ตัดความยาว / แปลงชนิดก่อนใช้ */
function cleanRows(input: unknown): TrRow[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_ROWS).map((r: Partial<TrRow>, i) => ({
    line: i + 1, eta: String(r?.eta ?? '').slice(0, 10), kind: String(r?.kind ?? '').slice(0, 40),
    transportDate: String(r?.transportDate ?? '').slice(0, 10), customer: String(r?.customer ?? '').slice(0, 200),
    quantity: Math.max(0, Math.round(Number(r?.quantity) || 0)), bl: String(r?.bl ?? '').trim().slice(0, 120),
    containers: (Array.isArray(r?.containers) ? r.containers : []).map(keyOf).filter(Boolean).slice(0, 60),
    vessel: String(r?.vessel ?? '').slice(0, 80), vesselName: String(r?.vesselName ?? '').slice(0, 120),
    port: String(r?.port ?? '').slice(0, 60),
  }));
}

/**
 * จับคู่กับงาน KOLA แล้วถาม SHIPME (commit=false ตรวจ · true บันทึก)
 * จับคู่ใหม่ทุกครั้งที่ฝั่งเซิร์ฟเวอร์ — BL / เลขตู้ที่ส่งไป SHIPME มาจากงาน KOLA ไม่ใช่จากหน้าเว็บ
 */
async function runTransport(input: unknown, source: string, commit: boolean) {
  const user = await may();
  if (!user) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const rows = cleanRows(input);
  if (!rows.length) return fail('ไม่มีแถวให้ตรวจ');
  const jobs = await jobsByBlKeys(rows.flatMap((r) => blCandidates(r.bl)));
  const merged: TrPreviewRow[] = rows.map((r) => mergeWithJob(r, findJob(r.bl, jobs)));
  const sendable = merged.filter((r) => !r.error);
  if (!sendable.length) return { ok: true as const, rows: merged, shipme: null, shipmeError: 'ทุกแถวมีข้อผิดพลาด แก้ก่อนส่ง' };
  const res = await shipmeCall<ShipmePreview>('kolaTransportPush', {
    source: SOURCES.includes(source) ? source : SOURCES[0], commit, sentBy: user.displayName,
    rows: sendable.map((r) => ({
      line: r.line, transportDate: r.transportDate, customer: r.customer, quantity: r.quantity, bl: r.bl,
      containers: r.containers.join(','), vessel: r.vessel, vesselName: r.vesselName, port: r.port,
    })),
  });
  return res.ok
    ? { ok: true as const, rows: merged, shipme: { preview: res.preview, summary: res.summary, committed: res.committed } }
    : { ok: true as const, rows: merged, shipme: null, shipmeError: res.error };
}

export async function previewTransport(rows: TrRow[], source: string) {
  return runTransport(rows, source, false);
}

export async function pushTransport(rows: TrRow[], source: string) {
  return runTransport(rows, source, true);
}

// ---------------- ไฟล์ใบขน / E-Office ----------------

export type DocMatch = {
  name: string; kind: 'DECL' | 'EOFFICE' | null; bl: string; jobId: string; jobNo: string;
  declarationNo: string; doExchanged: boolean | null; by: 'filename' | 'text' | '';
};

/** แยกประเภท + หา BL ของแต่ละไฟล์ (ชื่อไฟล์ / ข้อความหน้าแรก ๆ ที่เบราว์เซอร์อ่านมา) */
export async function matchDocFiles(files: { name: string; text: string }[]): Promise<{ ok: true; items: DocMatch[] } | Fail> {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const list = (Array.isArray(files) ? files : []).slice(0, 100)
    .map((f) => ({ name: String(f?.name ?? '').slice(0, 200), text: String(f?.text ?? '').slice(0, 20000) }));
  const guesses = list.map((f) => ({ f, g: classifyDocFile(f.name, f.text) }));
  const [byDecl, byBl] = await Promise.all([
    jobsByDeclarationNos(guesses.map(({ g }) => g.declarationNo).filter(Boolean)),
    jobsByBlKeys(guesses.flatMap(({ g }) => (g.blHint ? blCandidates(g.blHint) : []))),
  ]);
  return {
    ok: true,
    items: guesses.map(({ f, g }) => {
      const job = (g.declarationNo ? byDecl.get(g.declarationNo) : undefined) ?? (g.blHint ? findJob(g.blHint, byBl) : null);
      return {
        name: f.name, kind: g.kind, bl: job?.blNo || g.blHint, jobId: job?.id ?? '', jobNo: job?.jobNo ?? '',
        declarationNo: g.declarationNo, doExchanged: job ? Boolean(job.doExchangedAt) : null, by: g.by,
      };
    }),
  };
}

/** BL ที่ MAY พิมพ์เองในหน้าอัป → งาน KOLA (ไม่เจอ = ยังอัปได้ แต่ไม่มีเลขงานกำกับ) */
export async function lookupBl(bl: string): Promise<{ ok: true; jobId: string; jobNo: string; bl: string; doExchanged: boolean | null } | Fail> {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const job = findJob(String(bl ?? ''), await jobsByBlKeys(blCandidates(String(bl ?? ''))));
  return { ok: true, jobId: job?.id ?? '', jobNo: job?.jobNo ?? '', bl: job?.blNo || String(bl ?? '').trim(), doExchanged: job ? Boolean(job.doExchangedAt) : null };
}

type DocInput = { bl: string; kind: string; fileName: string; size: number };
const docInput = (i: DocInput) => ({
  bl: String(i?.bl ?? '').trim().slice(0, 120), kind: String(i?.kind ?? ''), fileName: String(i?.fileName ?? '').slice(0, 200),
  size: Math.round(Number(i?.size) || 0),
});

export async function docUploadUrl(input: DocInput) {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const res = await shipmeCall<{ storageKey: string; signedUrl: string }>('kolaDocUploadUrl', docInput(input));
  return res.ok ? res : fail(res.error);
}

export async function registerDoc(input: DocInput & { storageKey: string; kolaJobId: string; declarationNo: string }) {
  const user = await may();
  if (!user) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const res = await shipmeCall<{ id: string }>('kolaDocRegister', {
    ...docInput(input), storageKey: String(input?.storageKey ?? '').slice(0, 300),
    kolaJobId: String(input?.kolaJobId ?? '').slice(0, 60), declarationNo: String(input?.declarationNo ?? '').slice(0, 40),
    sentBy: user.displayName,
  });
  return res.ok ? res : fail(res.error);
}

export type SentDoc = { id: string; bl: string; kind: string; fileName: string; size: number; current: boolean; uploadedBy: string; uploadedAt: string; url: string };

export async function listDocs(): Promise<{ ok: true; rows: SentDoc[] } | Fail> {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const res = await shipmeCall<{ rows: SentDoc[] }>('kolaDocList', { limit: 50 });
  return res.ok ? res : fail(res.error);
}

export async function deleteDoc(id: string) {
  if (!(await may())) return fail('ไม่มีสิทธิ์ใช้เมนูนี้');
  const res = await shipmeCall('kolaDocDelete', { id: String(id ?? '').slice(0, 60) });
  return res.ok ? { ok: true as const } : fail(res.error);
}
