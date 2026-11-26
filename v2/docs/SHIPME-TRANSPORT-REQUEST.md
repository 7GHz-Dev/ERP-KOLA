# Transport Request + ใบขน / E-Office → ERP SHIPME (เมนูชั่วคราวของ MAY)

**สถานะ:** ใช้ระหว่างที่ KOLA ยังส่งแพลนลากตู้และเอกสารตรวจปล่อยให้ SHIPME เองไม่ได้
**ออกแบบ:** `docs/superpowers/specs/2026-11-26-transport-request-to-shipme-design.md` (root ของ repo)

## ภาพรวม

```
KOLA /may/transport-request ── kolaTransportPush ──▶ SHIPME transport_records (BL + วันที่ TRANSPORT)
KOLA /may/transport-docs ──── kolaDocUploadUrl ───▶ signed upload URL
         เบราว์เซอร์ PUT ไฟล์ ──────────────────────▶ SHIPME Supabase Storage (kola-docs/<BL>/…)
                             ── kolaDocRegister ──▶ SHIPME transport_docs
SHIPME แพลนงาน / งานปล่อย ── GET /api/shipme/doc-status ──▶ KOLA (สถานะ DO)
```

## KOLA → SHIPME

- เรียกด้วย `POST {SHIPME_API_URL}` และส่ง body JSON `{ action, token: SHIPME_SYNC_TOKEN, ... }`
- client อยู่ที่ `src/lib/shipme-client.ts`

| action | body | คืน |
|---|---|---|
| `kolaTransportPush` | `source` (MAESOT FREEZONE \| TRANSIT), `rows[]` (`line, transportDate, customer, quantity, bl, containers` (คั่นด้วย `,`), `vessel` (SHIPLINE), `vesselName`, `port`), `commit`, `sentBy` | `{ok, preview[], summary, committed}` (เหมือนปุ่ม "📥 รับ Transport Request" ของ SHIPME) |
| `kolaDocUploadUrl` | `bl, kind (DECL\|EOFFICE), fileName (.pdf), size (≤ 20MB)` | `{ok, storageKey, signedUrl}` |
| `kolaDocRegister` | `storageKey, bl, kind, fileName, size, kolaJobId, declarationNo, sentBy` | `{ok, id}` |
| `kolaDocList` | `limit` (≤ 50) | `{ok, rows[]}` (มี `url` เปิดไฟล์ 1 ชม.) |
| `kolaDocDelete` | `id` | `{ok}` |

**ส่งซ้ำและอัปไฟล์ซ้ำ**
- ส่งแถวที่มี BL และวันที่ TRANSPORT เดิม จะอัปเดตแถวเดิม
- อัปไฟล์ของ BL และประเภทเดิม ไฟล์ใหม่จะเป็นไฟล์ปัจจุบัน ไฟล์เก่ายังเก็บไว้

## SHIPME → KOLA

`GET /api/shipme/doc-status?bl=A&bl=B` พร้อม header `Authorization: Bearer <SHIPME_API_KEY>` (ถามได้ไม่เกิน 300 BL ต่อครั้ง)

```json
{ "ok": true, "items": { "AMP0572751A": { "found": true, "jobNo": "KOLA-2026-0565", "doExchangedAt": "2026-11-24T02:21:25.182Z" },
                         "NOPE1234": { "found": false } } }
```

**การตอบ**
- `doExchangedAt` คือเวลาที่ ANN ส่งชุดแลก DO แล้ว ถ้ายังไม่ได้ส่งจะเป็น `null`
- คีย์ในคำตอบเป็น BL ตามที่ถามมา ตัดเหลือ A-Z0-9

**การจับคู่ BL**
- ใช้แบบตรงทั้งค่า จาก `jobs.bl_no` หรือตาราง `bls`
- BL แบบ `X(Y)` จับคู่ได้ทั้ง X, Y และค่าเต็ม
- BL ที่ตรงกับหลายงานจะตอบ `found: false`

## ค่าที่ต้องตั้ง

| ที่ไหน | ตัวแปร | ค่า |
|---|---|---|
| KOLA (production เท่านั้น) | `SHIPME_API_URL` | `https://<โดเมน SHIPME>/api` |
| KOLA (production เท่านั้น) | `SHIPME_SYNC_TOKEN` | ค่าเดียวกับ `KOLA_SYNC_TOKEN` ของ SHIPME |
| SHIPME | `KOLA_SYNC_TOKEN` | `openssl rand -hex 24` |
| SHIPME | `KOLA_SPECIALS_KEY` / `KOLA_SPECIALS_URL` | มีอยู่แล้ว (ใช้ส่งค่าพิเศษ) จึงใช้ถาม doc-status ด้วย |

- ตั้งไม่ครบ = เมนูของ KOLA ขึ้นว่า "ยังไม่ได้ตั้งค่าการเชื่อม SHIPME" และไม่ส่งอะไรออกไป
- ระบบทดสอบ erp-kola-test ไม่ต้องตั้ง

## ถอดออกเมื่อ KOLA ส่งเองได้

ฝั่ง KOLA ลบสิ่งเหล่านี้:
- หน้า `src/app/(app)/may/transport-request` และ `src/app/(app)/may/transport-docs`
- คอมโพเนนต์ `TransportRequestImport` / `TransportDocsUpload`
- `src/lib/actions/transport-request.ts` และ `src/lib/transport-request/ai-read.ts`
- เมนู 2 รายการใน `layout.tsx`

เก็บไว้ใช้ต่อ:
- `doc-status` และ `shipme-client.ts`
- action `kola*` ฝั่ง SHIPME
