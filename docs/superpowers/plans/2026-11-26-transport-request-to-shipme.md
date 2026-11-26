# Transport Request + ใบขน / E-Office → SHIPME Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สองเมนูชั่วคราวของ MAY ใน KOLA สำหรับส่งข้อมูลเข้า SHIPME
- ส่ง Transport Request (จากรูปหรือข้อความ) เข้าตารางขนส่งและแพลนงานของ SHIPME
- อัปไฟล์ใบขน / E-Office เข้า SHIPME

แพลนงานของ SHIPME แสดงความพร้อม DO · ใบขน · E-Office ต่อ BL

**Architecture:**
- KOLA เรียก action ใหม่ของ SHIPME (`/api`, ยืนยันด้วย `KOLA_SYNC_TOKEN`) เพื่อส่งแถวและลงทะเบียนไฟล์
- ไฟล์อัปจากเบราว์เซอร์ตรงเข้า Supabase Storage ของ SHIPME ผ่าน signed upload URL
- SHIPME ถามสถานะ DO จาก KOLA ทุกครั้งที่โหลดแพลน ผ่าน `GET /api/shipme/doc-status` (Bearer `SHIPME_API_KEY`)

**Tech Stack:**
- KOLA: Next.js 15 app router, Drizzle/postgres-js, Anthropic SDK (read-ai), pdfjs-dist (`loadPdfjs`)
- SHIPME v2: Next.js API dispatcher (`src/lib/dispatch.ts`), Drizzle, Supabase Storage, หน้า admin แบบ vanilla JS (`public/job-plan.js`, `public/release-jobs.js`)

**Spec:** `docs/superpowers/specs/2026-11-26-transport-request-to-shipme-design.md`

## Global Constraints

**วันที่และการจับคู่**
- วันที่ของงานใน SHIPME = คอลัมน์ **TRANSPORT** · ETA ใช้แสดงและเทียบเท่านั้น
- ปุ่ม "📥 รับ Transport Request" เดิมของ SHIPME **ต้องใช้คอลัมน์ TRANSPORT ด้วย** (ผู้ใช้ยืนยัน 26 พ.ย.)
  - `TR_HEADERS` ใน `public/transport-import.js` ไม่จับ ETA เป็นวันที่อีก
  - ข้อความ error เป็น "วันที่ TRANSPORT ไม่ถูกต้อง" (S1)
- bl key = ตัวพิมพ์ใหญ่ ตัดทุกอย่างที่ไม่ใช่ A-Z0-9 (`blKeyOf` ของ SHIPME ตัดแค่ช่องว่าง ห้ามเปลี่ยนตัวเดิม เพราะ unique index ใช้อยู่)
  - ฝั่ง KOLA จับคู่ด้วย key แบบตัดหมด
  - ส่งไป SHIPME เป็นค่า `bl` ดิบตาม KOLA
- BL ที่มีวงเล็บ `X(Y)` ลองจับคู่ทั้ง `X(Y)` เต็ม · `X` · `Y`
- จับคู่งาน KOLA แบบ **ตรงทั้งค่าเท่านั้น** ไม่ใช้ `like` (ห้ามแนบผิดงาน)

**สิทธิ์และการเชื่อมต่อ**
- KOLA ใช้ได้เฉพาะ role `MAY`
- KOLA ห้ามเขียนตารางใดในฐานของตัวเองเพิ่ม (ไม่มี migration ฝั่ง KOLA)
- ตัวแปรไม่ครบ (`SHIPME_API_URL` / `SHIPME_SYNC_TOKEN`) = แสดง "ยังไม่ได้ตั้งค่าการเชื่อม SHIPME" ไม่ยิงออก
- สถานะ DO ถาม KOLA ไม่ได้ = `'unknown'` (แสดง "?") ห้ามแสดงเป็นพร้อมหรือไม่พร้อม · timeout 4000ms · สูงสุด 300 BL ต่อครั้ง

**ไฟล์**
- จำกัด 20MB ต่อไฟล์ · PDF เท่านั้นสำหรับเอกสาร
- รูป Transport Request: png/jpg/webp ไม่เกิน 10MB ต่อรูป ไม่เกิน 5 รูปต่อครั้ง
- `kind` = `'DECL' | 'EOFFICE'`
- อัปทับ BL+kind เดิม → ไฟล์ใหม่ `current = true` ไฟล์เก่า `false` (ไม่ลบไฟล์เก่า)

**ข้อความหน้าจอและการ deploy**
- ข้อความบนหน้าจอเป็นภาษาไทย
- เมนู: "ส่ง Transport Request → SHIPME (ชั่วคราว)" · "อัปใบขน / E-Office → SHIPME (ชั่วคราว)"
- deploy KOLA: commit + push main แล้ว `vercel --prod --local-config v2/vercel.json` จาก root
- deploy SHIPME: โปรเจกต์ `erp-shipme-ovmf` · commit เฉพาะไฟล์ของงานนี้
- migration SHIPME 0024 ต้องรันกับฐานจริงก่อน deploy SHIPME

## Review Focus

1. **AI อ่านรูปแล้วเลขตู้/BL ผิดหนึ่งตัวอักษร**
   - แถวที่จับคู่ KOLA ได้ต้องใช้ค่าจาก KOLA และขึ้นคำเตือนเทียบค่า
   - แถวที่จับไม่ได้ต้องขึ้น "ไม่พบใน KOLA" ไม่เดาด้วย like
   - เทสต์: K1 `mergeWithJob`
2. **วันที่รูปแบบ dd/mm/yyyy ปี พ.ศ. หรือ 2 หลัก ในรูป/ข้อความที่วาง**
   - ต้องได้ `YYYY-MM-DD` ค.ศ. หรือว่างพร้อม error ไม่ใช่วันผิด
   - เทสต์: K1 `toIsoDate` cases
3. **ไฟล์ใบขนและ E-Office ของ BL เดียวกันวางพร้อมกัน หรือชื่อไฟล์มีทั้งเลขใบขนและ BL**
   - ต้องแยกประเภทถูก
   - เทสต์: K1 `classifyDocFile`
4. **KOLA ล่มหรือคีย์ผิดตอน SHIPME โหลดแพลน**
   - แพลนยังโหลดได้ ช่อง DO เป็น "?"
   - เทสต์: S3 `fetchKolaDo` คืน unknown
5. **ส่ง Transport Request ชุดเดิมซ้ำ หรือส่งทั้งจาก KOLA และปุ่มเดิมใน SHIPME**
   - ต้องอัปเดตแถวเดิมด้วย BL + วันที่ ไม่สร้างแถวใหม่
   - เทสต์: S1 ใช้ upsert เดิม (`onConflictDoUpdate` บน `bl_key, transport_date`) ตรวจด้วยการ preview ซ้ำได้สถานะ `update`

---

## ไฟล์

**SHIPME** (`/Users/toon/Projects/ERP-SHIPME/v2`)

| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/transport-records.ts` (แก้) | export `cleanImport`, แยก `runTransportImport` ใช้ร่วมกับ action เดิม |
| `src/lib/kola-transport.ts` (ใหม่) | `kolaTransportPush`, `kolaDocUploadUrl`, `kolaDocRegister`, `kolaDocList`, `kolaDocDelete` |
| `src/lib/doc-status.ts` (ใหม่) | `fetchKolaDo`, `docStatusFor` (ไฟล์ + DO ต่อ BL) |
| `src/db/schema.ts` + `drizzle/0024_transport_docs.sql` | ตาราง `transport_docs` |
| `src/lib/kola-plans.ts` (แก้) | export `denied` |
| `src/lib/plans.ts` (แก้) | `transportRowsFor` รวม `transport_records` · `planLoad` / `myReleaseJobs` คืน `docs` |
| `src/lib/dispatch.ts` (แก้) | ผูก action ใหม่ |
| `public/job-plan.js`, `public/release-jobs.js` (แก้) | ป้าย DO / ใบขน / E-Office |
| `test/transport-kola.test.ts` (ใหม่) | เทสต์ฟังก์ชันล้วน (`npx tsx --test test/transport-kola.test.ts`) |

**KOLA** (`/Users/toon/Projects/ERP-KOLA/v2`)

| ไฟล์ | หน้าที่ |
|---|---|
| `src/lib/transport-request/parse.ts` (ใหม่, ใช้ได้ทั้ง client/server) | ฟังก์ชันล้วน: key, วันที่, วางข้อความ, sanitize ผล AI, รวมกับงาน, แยกประเภทไฟล์ |
| `src/lib/transport-request/jobs.ts` (ใหม่, server) | `jobsByBlKeys`, `jobsByDeclarationNos` |
| `src/lib/transport-request/ai-read.ts` (ใหม่, server) | `readTransportImage` |
| `src/lib/shipme-client.ts` (ใหม่, server) | `shipmeConfigured`, `shipmeCall` |
| `src/lib/actions/transport-request.ts` (ใหม่, `'use server'`) | action ของทั้งสองเมนู |
| `src/app/api/shipme/doc-status/route.ts` (ใหม่) | endpoint สถานะ DO |
| `src/app/(app)/may/transport-request/page.tsx` + `src/components/TransportRequestImport.tsx` | เมนู 1 |
| `src/app/(app)/may/transport-docs/page.tsx` + `src/components/TransportDocsUpload.tsx` | เมนู 2 |
| `src/app/(app)/layout.tsx` (แก้) | เมนู MAY 2 รายการ |
| `src/app/globals.css` (แก้) | `.tr-*` สไตล์ตารางตัวอย่าง (หัวฟ้า `#9ec5f8`, จำนวนตู้หัวเหลือง `#ffe08a` ตามรูปที่ 2) |
| `tests/transport-request.ts` (ใหม่) | `npx tsx tests/transport-request.ts` |
| `docs/SHIPME-TRANSPORT-REQUEST.md` (ใหม่) | สัญญา API ทั้งสองทาง + ค่าที่ต้องตั้ง + วิธีถอดออก |

---

### Task 1: [S1] SHIPME — `kolaTransportPush` ใช้ตรรกะนำเข้าเดิม

**Files:** Modify `src/lib/transport-records.ts`, `src/lib/kola-plans.ts` · Create `src/lib/kola-transport.ts`, `test/transport-kola.test.ts` · Modify `src/lib/dispatch.ts`

**Interfaces:**
- Produces:
  - `runTransportImport(rows: unknown, opts: { source: string; commit: boolean; actor: string; importedFrom: 'import' | 'kola' }): Promise<ApiResult>` (ผลรูปเดียวกับ `importTransportRequest` เดิม: `{ok, source, preview, summary, committed}`)
  - `export function cleanImport(input: unknown)`
  - `export function denied(body: ApiBody): ApiResult | null` (จาก kola-plans)
  - action `kolaTransportPush` body `{ token, source, rows: {line, transportDate, customer, quantity, bl, containers: string, vessel, vesselName, port}[], commit: boolean, sentBy: string }`

- [ ] **Step 1: เขียนเทสต์ `cleanImport`**
  - `test('cleanImport keeps TRANSPORT date and flags CON mismatch')`
    - แถว `{transportDate:'2026-11-27', bl:'AMP0572751A', containers:'SEKU6323323,TLLU7829812', quantity:3}` → `error` ไม่มี · `warning === 'CON 3 แต่มีเลขตู้ 2 ตู้'` · `containers.length === 2`
  - `test('cleanImport rejects bad date')`
    - `transportDate:'2026-02-30'` → `error === 'วันที่ TRANSPORT ไม่ถูกต้อง'`
  - ปุ่มเดิม: `TR_HEADERS[0].re` เป็น `/^\s*(TRANSPORT|DATE|วันที่)/i` (ไม่มี ETA) · คำอธิบายหัวไฟล์และ placeholder เปลี่ยน ETA → TRANSPORT
- [ ] **Step 2: รัน** `npx tsx --test test/transport-kola.test.ts`
  - คาดว่า FAIL (`cleanImport` ไม่ได้ export)
- [ ] **Step 3: แยกโค้ด**
  - export `cleanImport`
  - error วันที่เป็น `'วันที่ TRANSPORT ไม่ถูกต้อง'` · แก้ `public/transport-import.js` ตามข้อจำกัดด้านบน
  - ย้ายเนื้อ `importTransportRequest` ไป `runTransportImport`
    - `createdBy` / `updatedBy` = `opts.actor`
    - `importedFrom` = `opts.importedFrom`
  - `importTransportRequest` เรียกต่อด้วย `{actor: actor.username, importedFrom: 'import'}`
- [ ] **Step 4: ฟังก์ชันใน `kola-transport.ts`**
  - export `denied` ใน kola-plans
  - `kolaTransportPush(body)` = `denied` → `runTransportImport(body.rows, {source, commit: body.commit === true, actor: 'kola:' + text(body.sentBy, 60), importedFrom: 'kola'})`
  - ผูกใน `dispatch.ts` แบบเดียวกับ `kolaPlanPush` (ไม่ใช้ session)
- [ ] **Step 5: ตรวจ**
  - `npx tsx --test test/transport-kola.test.ts` → PASS
  - `npx tsc --noEmit` → ไม่มี error ใหม่
- [ ] **Step 6: Commit** `git add` เฉพาะไฟล์ข้างบน
  - ข้อความ "SHIPME: รับ Transport Request จาก ERP-KOLA (kolaTransportPush) ใช้ตรรกะนำเข้าเดิม"

### Task 2: [S2] SHIPME — ตาราง `transport_docs` + action ไฟล์

**Files:** Modify `src/db/schema.ts`, `src/lib/kola-transport.ts`, `src/lib/dispatch.ts`, `test/transport-kola.test.ts` · Create `drizzle/0024_transport_docs.sql` (ผ่าน `npm run db:generate` แล้วเติม `ENABLE ROW LEVEL SECURITY` แบบ 0023)

**Interfaces:**
- Consumes: `denied` (S1), `supabaseAdmin`, `env.bucket`
- Produces:
  - ตาราง `transportDocs`: `id text pk`, `bl text`, `blKey text`, `kind text`, `fileName text`, `storageKey text`, `size integer`, `mime text`, `current boolean default true`, `kolaJobId text default ''`, `declarationNo text default ''`, `uploadedBy text`, `uploadedAt text` · index (`blKey`, `kind`, `current`)
  - `export const docKey = (bl: unknown) => String(bl ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')`
  - action ต่อไปนี้ (ทุกตัวรับ `token`)

| action | รับ | คืน |
|---|---|---|
| `kolaDocUploadUrl` | `{bl, kind, fileName, size}` | `{ok, storageKey, signedUrl, token}` · storageKey = `kola-docs/<docKey>/<kind>-<id>.pdf` |
| `kolaDocRegister` | `{storageKey, bl, kind, fileName, size, kolaJobId, declarationNo, sentBy}` | `{ok, id}` |
| `kolaDocList` | `{limit?: number}` (≤50) | `{ok, rows: {id, bl, kind, fileName, size, current, uploadedBy, uploadedAt, url}[]}` (url = signed 1 ชม.) |
| `kolaDocDelete` | `{id}` | `{ok}` |

- [ ] **Step 1: เขียนเทสต์**
  - `test('docKey strips everything but A-Z0-9')`
    - `docKey(' kg1042026-74915(amp0574862) ') === 'KG104202674915AMP0574862'`
  - `test('validDocInput rejects non-pdf, >20MB, bad kind')`
    - `validDocInput({bl:'X1', kind:'DECL', fileName:'a.pdf', size: 20*1024*1024+1})` → `'file_too_large'`
    - `kind:'OTHER'` → `'bad_kind'`
    - `fileName:'a.jpg'` → `'pdf_only'`
    - ค่าถูก → `null`
- [ ] **Step 2: รัน** → FAIL
- [ ] **Step 3: Implement**
  - `docKey` · `validDocInput(input): string | null`
  - action ทั้งสี่ (upload URL ใช้ `createSignedUploadUrl` แบบ `docscan-cloud.ts`)
  - register: ตรวจไฟล์มีจริงด้วย `list(dir, {search: file})` ไม่เจอ = `'file_missing'` · ในธุรกรรมเดียว ตั้งแถวเดิมของ `blKey+kind` เป็น `current=false` แล้ว insert ใหม่
  - delete: ลบไฟล์ใน Storage + แถว · ถ้าแถวที่ลบเป็น current ให้แถวล่าสุดที่เหลือของ `blKey+kind` เป็น current
  - ผูก dispatch
- [ ] **Step 4: Migration**
  - `npm run db:generate` → ได้ 0024 · เติม RLS
  - **อย่ารันกับฐานจริงในขั้นนี้** (รันตอน deploy ที่ Task F)
- [ ] **Step 5: ตรวจ** เทสต์ PASS · `npx tsc --noEmit` ผ่าน
- [ ] **Step 6: Commit** "SHIPME: transport_docs — รับไฟล์ใบขน / E-Office จาก ERP-KOLA (signed upload)"

### Task 3: [S3] SHIPME — แพลนงานดึง `transport_records` + ป้ายเอกสาร

**Files:** Create `src/lib/doc-status.ts` · Modify `src/lib/plans.ts`, `public/job-plan.js`, `public/release-jobs.js`, `test/transport-kola.test.ts`

**Interfaces:**
- Consumes: `transportDocs`, `docKey` (S2), `KOLA_SPECIALS_KEY` / `KOLA_SPECIALS_URL` (เหมือน `kola-specials.ts`)
- Produces:
  - `type DocState = { do: 'yes' | 'no' | 'unknown' | 'notfound'; decl: { id: string; url: string; fileName: string } | null; eoffice: same | null }`
  - `fetchKolaDo(keys: string[], fetcher = fetch): Promise<Map<string, 'yes' | 'no' | 'notfound'> | null>` (null = ถามไม่ได้)
  - `docStatusFor(bls: string[]): Promise<Record<string /*docKey*/, DocState>>`
  - `planLoad` และ `myReleaseJobs` คืนฟิลด์เพิ่ม `docs: Record<string, DocState>`

- [ ] **Step 1: เขียนเทสต์ (fetcher ปลอม)**
  - `test('fetchKolaDo returns null on network error')` → fetcher throw → `null`
  - `test('fetchKolaDo returns null on 401')` → `null`
  - `test('fetchKolaDo maps found/doExchangedAt')`
    - ตอบ `{ok:true, items:{A1:{found:true, doExchangedAt:'2026-11-20T00:00:00Z'}, B2:{found:true, doExchangedAt:null}, C3:{found:false}}}` → `A1→'yes'`, `B2→'no'`, `C3→'notfound'`
  - `test('fetchKolaDo chunks at 300 keys')` → 301 keys = เรียก fetcher 2 ครั้ง
- [ ] **Step 2: รัน** → FAIL
- [ ] **Step 3: Implement `doc-status.ts`**
  - URL = origin ของ `KOLA_SPECIALS_URL` (หรือ DEFAULT_URL ใน `kola-specials.ts`) + `/api/shipme/doc-status?bl=..`
  - Header `Authorization: Bearer <KOLA_SPECIALS_KEY>` · `AbortSignal.timeout(4000)`
  - ไม่มีคีย์ = `null`
  - `docStatusFor` อ่านไฟล์ `current` ของ BL ทั้งหมด (signed URL 1 ชม. ผ่าน `createSignedUrls`) · `do` = ผล fetch หรือ `'unknown'`
- [ ] **Step 4: `plans.ts`**
  - `transportRowsFor(date)` เพิ่มแถวจาก `transportRecords` ของวันนั้น แตก `containersJson` เป็นแถวละตู้ (ไม่มีตู้ = 1 แถวตู้ว่าง)
    - `source = r.source` · `sheetShipping = ''` · `sheetUser = String(r.username)` · `sheetDriver = ''`
    - ใส่ก่อนแถวชีตเพื่อให้ dedupe เก็บแถวระบบ
  - `planLoad` / `myReleaseJobs` เรียก `docStatusFor` กับ BL ทั้งหมดในผล
- [ ] **Step 5: หน้าเว็บ**
  - `job-plan.js` (`plRowHtml`) และ `release-jobs.js` แสดงป้ายสามช่องหลังคอลัมน์ BL จาก `res.docs[plBlKey(bl)]`
  - DO: `✓ DO` เขียว / `✗ DO` แดง / `? DO` เทา title "ตรวจกับ KOLA ไม่ได้" / `DO ไม่พบใน KOLA` เทา
  - ใบขน / E-Office: ✓ เป็นลิงก์เปิด url แท็บใหม่ / ✗ แดง
- [ ] **Step 6: ตรวจ**
  - เทสต์ PASS · `npx tsc --noEmit` · `npm run build` ผ่าน
- [ ] **Step 7: Commit** "SHIPME: แพลนงาน/งานปล่อย — ดึงตารางขนส่งของระบบ + ป้ายเอกสาร DO · ใบขน · E-Office"

### Task 4: [K1] KOLA — ฟังก์ชันล้วน `transport-request/parse.ts`

**Files:** Create `src/lib/transport-request/parse.ts`, `tests/transport-request.ts`

**Interfaces:**
- Produces:
```ts
export type TrRow = { line: number; eta: string; kind: string; transportDate: string; customer: string;
  quantity: number; bl: string; containers: string[]; vessel: string /*SHIPLINE*/; vesselName: string; port: string };
export type JobLite = { id: string; jobNo: string; blNo: string; containers: string[]; shipline: string; vessel: string;
  eta: string | null; doExchangedAt: string | null };
export type TrPreviewRow = TrRow & { jobId: string | null; jobNo: string | null; doExchanged: boolean | null;
  warnings: string[]; error: string };
export function keyOf(v: unknown): string                          // upper, A-Z0-9 only
export function blCandidates(bl: string): string[]                  // keys: full, outside (), inside ()
export function toIsoDate(v: string): string                       // '' when invalid
export function parsePastedSheet(text: string): TrRow[]
export function sanitizeAiRows(raw: unknown): TrRow[]
export function mergeWithJob(row: TrRow, job: JobLite | null): TrPreviewRow
export type DocGuess = { kind: 'DECL' | 'EOFFICE' | null; declarationNo: string; blHint: string; by: 'filename' | 'text' | '' };
export function classifyDocFile(fileName: string, pdfText?: string): DocGuess
```

- [ ] **Step 1: เขียนเทสต์ใน `tests/transport-request.ts`** (assert แบบ `tests/do-slip-match.ts`)

**`keyOf` และ `blCandidates`**
- `blCandidates('KG1042026-74915(AMP0574862)')` deepEqual `['KG104202674915AMP0574862','KG104202674915','AMP0574862']`
- `blCandidates('AMP0572751A')` → `['AMP0572751A']`

**`toIsoDate`**

| ค่าเข้า | คาด |
|---|---|
| `'27/11/2026'` | `'2026-11-27'` |
| `'27/11/2569'` | `'2026-11-27'` |
| `'27/11/26'` | `'2026-11-27'` |
| `'2026-11-27'` | `'2026-11-27'` |
| `'31/02/2026'` | `''` |
| `''` | `''` |

**`parsePastedSheet`**
- ข้อความแท็บคั่น มีหัว `ETA\tประเภท\tINV.\tSUR\tTRANSPORT\tSHIPPER\tCON\tBILL OF LADING\tCONTAINER NO.\tSHIPLINE\tVESSEL\tPORT` + แถว `25/11/2026\tMSFZ\tY\tSWB\t27/11/2026\tAHMED ULLAH OLD SPARE PART\t2\tAMP0572751A\tSEKU6323323,TLLU7829812\tCNC\tCNC SULAWESI V.JTV0E0S89\tKERRY`
  - → 1 แถว: `transportDate '2026-11-27'` · `eta '2026-11-25'` · `quantity 2` · `containers ['SEKU6323323','TLLU7829812']` · `vessel 'CNC'` · `port 'KERRY'`
- หัวตารางไม่มี TRANSPORT → `transportDate` ว่าง (ไม่ใช้ ETA แทน)

**`sanitizeAiRows`**
- ทิ้งแถวไม่มี BL
- เลขตู้ที่ไม่ใช่รูป `^[A-Z]{4}\d{7}$` ยังเก็บ (ให้ `mergeWithJob` เตือน)
- `quantity` ไม่ใช่ตัวเลข → 0
- ไม่ใช่ array → `[]`

**`mergeWithJob`**
- งาน `{blNo:'AMP0572751A', containers:['SEKU6323323','TLLU7829812']}` + แถวที่อ่านได้ `containers ['SEKU632332','TLLU7829812']`
  - → `containers` = ของงาน
  - `warnings` มี `'เลขตู้ในรูปไม่ตรง KOLA: SEKU632332'`
  - `jobId` ตั้งค่า
- `job = null` → `warnings` มี `'ไม่พบใน KOLA'` · `jobId null` · `containers` คงตามรูป
- `quantity 3` กับตู้ 2 ใบ → warning `'CON 3 แต่มีเลขตู้ 2 ตู้'`
- `transportDate` ว่าง → `error 'ไม่มีวันที่ TRANSPORT'`

**`classifyDocFile`**

| ไฟล์ / ข้อความ | คาด |
|---|---|
| `'A0310691002615.pdf'` | `{kind:'DECL', declarationNo:'A0310691002615', by:'filename'}` |
| `'AMP0572751A E-744810.pdf'` | `{kind:'EOFFICE', blHint:'AMP0572751A', by:'filename'}` |
| `'scan001.pdf'` + text `'ใบตราส่งเลขที่ (EGLV060600257813) ... A031-0-6910-02615'` | `{kind:'DECL', declarationNo:'A0310691002615', blHint:'EGLV060600257813', by:'text'}` |
| `'scan002.pdf'` + text `'คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร'` | `{kind:'EOFFICE', by:'text'}` |
| `'x.pdf'` ไม่มี text | `{kind:null, by:''}` |

- [ ] **Step 2: รัน** `npx tsx tests/transport-request.ts` → FAIL (ไม่มีโมดูล)
- [ ] **Step 3: Implement `parse.ts`**
  - ไม่ import อะไรฝั่ง server
  - เลขใบขน = `/A\d{3}-?\d-?\d{4}-?\d{5}/` ตัดขีด
  - ปี > 2400 ลบ 543 · ปี 2 หลัก + 2000
  - หัวตารางหาแบบ regex ไม่สนลำดับ: `TRANSPORT` · `ETA` · `SHIPPER` · `CON` (ตรงคำ ไม่ใช่ CONTAINER) · `BILL OF LADING|BL` · `CONTAINER` · `SHIPLINE` · `VESSEL` · `PORT` · `ประเภท`
- [ ] **Step 4: รัน** → PASS
- [ ] **Step 5: Commit** "KOLA: ตัวอ่าน Transport Request / แยกไฟล์ใบขน·E-Office (ฟังก์ชันล้วน + เทสต์)"

### Task 5: [K2] KOLA — ค้นงาน + endpoint `doc-status` + client SHIPME

**Files:** Create `src/lib/transport-request/jobs.ts`, `src/app/api/shipme/doc-status/route.ts`, `src/lib/shipme-client.ts`, `docs/SHIPME-TRANSPORT-REQUEST.md` · Modify `tests/transport-request.ts`

**Interfaces:**
- Consumes: `keyOf`, `blCandidates`, `JobLite` (K1), `shipmeAuthorized`
- Produces:
  - `jobsByBlKeys(keys: string[]): Promise<Map<string /*key*/, JobLite>>`
    - ตรงทั้งค่ากับ `keyOf(jobs.bl_no)` หรือ `keyOf(bls.bl_no)` (SQL `regexp_replace(upper(x),'[^A-Z0-9]','','g')`)
    - `is_archived = false`
    - key ที่ตรงหลายงานไม่ใส่ใน Map (กันแนบผิด)
  - `jobsByDeclarationNos(nos: string[]): Promise<Map<string /*keyOf(no)*/, JobLite>>` ผ่าน `customs_entries.declaration_no`
  - `findJob(bl: string, map: Map<string, JobLite>): JobLite | null` (ลองตาม `blCandidates`) อยู่ใน `parse.ts`
  - `docStatusBody(keys: string[], map: Map<string, JobLite>)` → `{ ok: true, items: Record<string, {found: boolean; jobNo?: string; doExchangedAt?: string | null}> }` อยู่ใน `parse.ts`
  - `GET /api/shipme/doc-status?bl=..&bl=..` → 401 ถ้าคีย์ผิด · 400 ถ้าไม่มี bl หรือเกิน 300 · 200 `docStatusBody`
  - `shipmeConfigured(): boolean`
  - `shipmeCall<T>(action: string, body: Record<string, unknown>): Promise<{ok: true} & T | {ok: false; error: string}>`
    - POST `SHIPME_API_URL` JSON `{action, token: SHIPME_SYNC_TOKEN, ...body}` · timeout 20000ms
    - network/HTTP error → `{ok:false, error:'ติดต่อ SHIPME ไม่ได้'}`

- [ ] **Step 1: เขียนเทสต์ `findJob` / `docStatusBody`**
  - Map มีเฉพาะ `'AMP0574862'` → `findJob('KG1042026-74915(AMP0574862)')` ได้งานนั้น
  - `docStatusBody(['A1','ZZ'], map)` → `items.ZZ.found === false` · `items.A1.doExchangedAt` ตามงาน
- [ ] **Step 2: รัน** → FAIL
- [ ] **Step 3: Implement** ทั้งหมดใน Interfaces
  - ฟังก์ชันล้วนไป `parse.ts`
  - route: `export const dynamic = 'force-dynamic'` แบบ `costs/route.ts`
  - doc: สัญญา API สองทาง · ตัวแปร env · วิธีถอดออก
- [ ] **Step 4: ตรวจ**
  - เทสต์ PASS · `npx tsc --noEmit`
  - ลอง query จริงแบบอ่านอย่างเดียว: สคริปต์ชั่วคราวใน `scripts/` เรียก `jobsByBlKeys(['AMP0572751A'])` แล้วลบสคริปต์ → ได้ 0 หรือ 1 งาน ไม่ error
- [ ] **Step 5: Commit** "KOLA: /api/shipme/doc-status (สถานะ DO ให้แพลน SHIPME) + client เรียก SHIPME"

### Task 6: [K3] KOLA — AI อ่านรูป + server actions

**Files:** Create `src/lib/transport-request/ai-read.ts`, `src/lib/actions/transport-request.ts`

**Interfaces:**
- Consumes: K1, K2, `aiConfigured` และวิธีเรียก Anthropic แบบ `read-ai.ts` (MODEL เดียวกัน)
- Produces (ทุกตัว `requireUserReady(['MAY'])` · คืน `{ok:false, detail}` เมื่อผิด ไม่ throw)

| action | รับ | คืน |
|---|---|---|
| `readTransportImages(fd: FormData /*images[]*/)` | รูป | `{ok, rows: TrRow[], costThb: number}` |
| `previewTransport(rows: TrRow[], source: string)` | แถว | `{ok, rows: TrPreviewRow[], shipme: {preview, summary} \| null, shipmeError?: string}` จับคู่ด้วย `jobsByBlKeys` + `mergeWithJob` แล้วเรียก `shipmeCall('kolaTransportPush', {commit:false})` กับแถวที่ไม่มี error |
| `pushTransport(rows: TrRow[], source: string)` | แถว | เหมือน `previewTransport` แต่ `commit:true` · **จับคู่ใหม่ฝั่ง server** ไม่เชื่อเลขตู้ที่หน้าเว็บส่ง |
| `matchDocFiles(files: {name: string; text: string}[])` | ไฟล์ | `{ok, items: {name, kind, bl, jobId, jobNo, declarationNo, doExchanged, by}[]}` |
| `docUploadUrl(input: {bl, kind, fileName, size})` | ไฟล์ | ผ่าน `shipmeCall('kolaDocUploadUrl')` |
| `registerDoc(input)` | ไฟล์ | ผ่าน `shipmeCall('kolaDocRegister')` · `sentBy` = ชื่อผู้ใช้ KOLA |
| `listDocs()` | — | ผ่าน `shipmeCall('kolaDocList')` |
| `deleteDoc(id)` | id | ผ่าน `shipmeCall('kolaDocDelete')` |

- `readTransportImages`: รูปละครั้ง · คำสั่ง AI ระบุชื่อคอลัมน์ตามตาราง (ETA, ประเภท, TRANSPORT, SHIPPER, CON, BILL OF LADING, CONTAINER NO., SHIPLINE, VESSEL, PORT) · ตอบ JSON array · ห้ามเดา ช่องที่อ่านไม่ออกให้ว่าง · ผลผ่าน `sanitizeAiRows` · `line` เรียงต่อกันข้ามรูป

- [ ] **Step 1: Implement** ตาม Interfaces
- [ ] **Step 2: ตรวจ `npx tsc --noEmit`** ผ่าน
- [ ] **Step 3: ลองอ่านรูปจริงหนึ่งครั้ง**
  - สคริปต์ชั่วคราวเรียก `readTransportImage` กับ `/private/tmp/claude-501/-Users-toon-Projects-ERP-KOLA/4f2a4fa1-9e58-4cef-b246-0886a977fd7b/images/3.png`
  - คาด 13 แถว แถว 10 BL `AMP0572751A` ตู้ `SEKU6323323, TLLU7829812` TRANSPORT `2026-11-27`
  - ลบสคริปต์หลังลอง
- [ ] **Step 4: Commit** "KOLA: actions ส่ง Transport Request / ไฟล์ใบขน·E-Office ไป SHIPME + AI อ่านรูปตาราง"

### Task 7: [K4] KOLA — หน้าเมนู 1 `/may/transport-request`

**Files:** Create `src/app/(app)/may/transport-request/page.tsx`, `src/components/TransportRequestImport.tsx` · Modify `src/app/(app)/layout.tsx`, `src/app/globals.css`

**Interfaces:** Consumes K3 actions, `TrRow` / `TrPreviewRow`, `shipmeConfigured`

**ลำดับบนจอ**
1. `page-head` + ป้ายชั่วคราว
   - ถ้า `!shipmeConfigured()` แสดงแถบเตือน และปุ่มส่งปิดไว้
2. แถบเลือก source: MAESOT FREEZONE (ค่าเริ่ม) · TRANSIT
3. สองแท็บรับข้อมูล
   - "รูป": วาง Ctrl+V / เลือกไฟล์ / ลากวาง สูงสุด 5 รูป มีภาพย่อ
   - "วางข้อความ": textarea → `parsePastedSheet` ฝั่ง client
4. ปุ่ม "อ่านรูป" (แสดงค่า AI ประมาณ ฿)
5. ตารางตัวอย่าง `.tr-preview`
   - คอลัมน์: `#` · TRANSPORT · ชิปเปอร์ · VESSEL · เลข BL · CONTAINER NO. (บรรทัดละตู้) · จำนวนตู้ · KOLA (เลขงาน / ไม่พบ) · DO · SHIPME (ใหม่/อัปเดต/ผิดพลาด + ชิปปิ้ง) · คำเตือน · ลบแถว
   - ช่อง TRANSPORT / ชิปเปอร์ / VESSEL / BL / ตู้ / จำนวน / ท่า แก้ได้ (input เต็มช่อง)
   - แก้แล้วสถานะ SHIPME ล้าง ต้องกด "ตรวจกับ SHIPME" ใหม่
   - แถวรวมท้าย "รวม n BL · ตู้ n"
6. ปุ่ม "ตรวจกับ SHIPME" (`previewTransport`) → ปุ่ม "ส่งให้ SHIPME" (ConfirmSubmit, `pushTransport`) เปิดหลังตรวจแล้วเท่านั้น
   - ผลสรุป "ใหม่ n · อัปเดต n · ผิดพลาด n"

**เมนูใน layout**
- ใต้ MAY หลัง "แพลนลากตู้": `{ href: '/may/transport-request', label: 'ส่ง Transport Request → SHIPME (ชั่วคราว)' }`

- [ ] **Step 1: Implement** หน้า + คอมโพเนนต์ + CSS + เมนู
- [ ] **Step 2: ตรวจหน้าตา**
  - หน้า harness ชั่วคราวใส่ข้อมูลสมมติ 3 แถว (จับคู่ได้ · ไม่พบใน KOLA · มีคำเตือน)
  - เปิดด้วย playwright-core + Chrome ของเครื่อง จอ 1440 และ 390
  - ตรวจว่าตารางไม่ล้นแนวนอนนอกกรอบ หัวตารางสีตามรูปที่ 2
  - ลบ harness
- [ ] **Step 3: ตรวจ build** `npx tsc --noEmit` และ `npm run build` ผ่าน
- [ ] **Step 4: Commit** "KOLA: เมนู MAY ส่ง Transport Request → SHIPME (ชั่วคราว) — อ่านรูป/วางข้อความ · จับคู่งาน · ตัวอย่างแบบตารางขนส่ง"

### Task 8: [K5] KOLA — หน้าเมนู 2 `/may/transport-docs`

**Files:** Create `src/app/(app)/may/transport-docs/page.tsx`, `src/components/TransportDocsUpload.tsx` · Modify `src/app/(app)/layout.tsx`

**Interfaces:** Consumes K3 actions, `classifyDocFile`, `loadPdfjs` (`src/lib/parse-arrival.ts`)

**ลำดับการทำงาน**
1. ลากวาง / เลือก PDF หลายไฟล์
   - เกิน 20MB หรือไม่ใช่ PDF ขึ้นแถวสีแดงทันที ไม่อัป
2. ฝั่ง client อ่าน text หน้า 1–2 ด้วย `loadPdfjs` (อ่านไม่ได้ = text ว่าง)
3. เรียก `matchDocFiles`
4. ตารางไฟล์: ชื่อไฟล์ · ประเภท (select ใบขน / E-Office) · BL (input + datalist งานที่จับได้) · จับได้จาก (ชื่อไฟล์/ข้อความในไฟล์/เลือกเอง) · งาน KOLA · DO · สถานะอัป
5. ปุ่ม "อัปทั้งหมด"
   - ทีละไฟล์: `docUploadUrl` → `fetch(signedUrl, {method:'PUT', body:file, headers:{'content-type':'application/pdf'}})` → `registerDoc`
   - แถวที่ไม่มี BL หรือประเภทข้าม
   - แถวล้มเหลวขึ้นเหตุผล กดลองใหม่รายแถวได้
6. ใต้ตาราง "ส่งไปแล้วล่าสุด" จาก `listDocs` (ลิงก์เปิด · ลบผ่าน ConfirmSubmit)

**เมนูใน layout**
- `{ href: '/may/transport-docs', label: 'อัปใบขน / E-Office → SHIPME (ชั่วคราว)' }`

- [ ] **Step 1: Implement**
- [ ] **Step 2: ตรวจหน้าตาด้วย harness** แบบ K4
  - ป้อนสองไฟล์ PDF ที่ผู้ใช้แนบ (ชื่อ `A0310691002615.pdf`, `AMP0572751A E-744810.pdf`)
  - ใช้ `matchDocFiles` จำลอง
  - คาดว่าแยกประเภทได้ ใบขน / E-Office
- [ ] **Step 3: ตรวจ build** `npx tsc --noEmit` และ `npm run build` ผ่าน · รัน `npx tsx tests/transport-request.ts` และ `npx tsx tests/do-pay-batch.ts` ผ่าน
- [ ] **Step 4: Commit** "KOLA: เมนู MAY อัปใบขน / E-Office → SHIPME (ชั่วคราว) — จับคู่ BL จากชื่อไฟล์/เลขใบขน/ข้อความใน PDF"

### Task 9: [F] ตั้งค่า + deploy ทั้งสองระบบ

- [ ] **Step 1: ตรวจ env ที่มีอยู่แล้ว** `vercel env ls` ของทั้งสองโปรเจกต์ (ดูชื่อ ไม่อ่านค่า)
  - ถ้าขาด `KOLA_SYNC_TOKEN` (SHIPME) / `SHIPME_API_URL`, `SHIPME_SYNC_TOKEN` (KOLA production เท่านั้น ไม่ใส่ใน erp-kola-test) ให้**ขอผู้ใช้**ก่อนเพิ่ม (เป็นการเปิดช่องเชื่อมระบบ)
- [ ] **Step 2: Migration SHIPME 0024** กับฐานจริง
  - ขอผู้ใช้รันหรืออนุญาต (เคยถูกบล็อกตอนรัน migration ฐานจริง)
- [ ] **Step 3: Deploy**
  - SHIPME: push + deploy โปรเจกต์ `erp-shipme-ovmf`
  - KOLA: push main + `vercel --prod --local-config v2/vercel.json` จาก root
  - ตรวจทั้งสอง Ready
- [ ] **Step 4: ทดสอบจริงหลัง deploy**
  - `curl` `/api/shipme/doc-status?bl=X` ไม่มีคีย์ → 401
  - หน้า KOLA ทั้งสองเมนูไม่ login → 307 ไป login
