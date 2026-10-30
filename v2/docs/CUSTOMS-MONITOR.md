# ใบขน → เดิน E → ลากตู้

ต่อจาก [DRAFT-WORKER.md](DRAFT-WORKER.md) (PAINT สร้าง Draft ใบขนใน NETBAY แล้วส่งให้ FAH ตรวจ)

```
FAH ตรวจ Draft ─ กด SEND TO CUSTOMS ใน NETBAY เอง ─ กด "สร้างใบขนแล้ว" บน ERP
      │                                              (เครื่องที่กดเปิดตัว monitor)
      ▼
คิวงาน Automation › รอสร้างใบขน     ตัว monitor เช็กสถานะใน NETBAY ทุก 5 นาที
      │ ACCEPT → ดึงเลขใบขน (Customs No.) + PDF
      ▼
คิวงาน Automation › ใบขนที่เสร็จแล้ว  +  งานคงค้าง › 4. เตรียมเอกสารเดิน E
      │ สร้างคำร้อง → รวมชุด (คำร้อง → ใบขนทุกหน้า → BL → Final Invoice)
      │ เลือกหลายรายการ → "ส่งมอบคนเดินเอกสาร"
      ▼
Upload ชุดปล่อย E-Office › อัปชุดที่เซ็นแล้ว (สแกน) → "ส่ง Partner"
      ▼
NAMKANG › จัดการลากตู้สินค้า › เลือกตู้ + วันลากตู้ → "ส่งแพลนให้ MAY"
      ▼
MAY › แพลนลากตู้ › "รับแพลน"   (เชื่อม ERP SHIPME ต่อไป)
```

## ตัว monitor ใบขน (`npm run worker:customs`)

- **เปิดเอง** เมื่อ FAH กด "สร้างใบขนแล้ว" — หน้าเว็บเปิดลิงก์ `kola-worker://customs` หลังงานเข้าคิวแล้ว
  ปิดเครื่องไปก่อน ACCEPT ครบ → คิว Automation › รอสร้างใบขน มีปุ่ม **เปิดตัว monitor บนเครื่องนี้**
- **เครื่องที่กดล่าสุดรับหน้าที่** และเช็ก*ทุก*รายการที่ค้าง (ไม่ใช่แค่รายการที่ตัวเองกด)
  บัญชี monitor login ได้ทีละที่ ตัวเก่าเห็นใน 30 วินาทีว่ามีเครื่องอื่นรับไปแล้วก็ปิดตัวเอง (lease ใน `master_records` type `customsMonitor`)
  บนเครื่องเดียวกันถ้าเปิดอยู่แล้ว ตัวเปิดไม่เปิดซ้ำ — ตัวที่เปิดอยู่เห็นงานใหม่ภายในครึ่งนาทีแล้วเช็กทันที
- **ไม่มีหน้าต่าง** (เช็กซ้ำระหว่างที่ FAH ใช้เครื่อง) — ดู log + ภาพหน้าจอได้ที่ **ดูการทำงาน** บนแถบสถานะ
- **ปิดตัวเองเมื่อ ACCEPT ครบทุกรายการ**

ต่อ 1 รายการ: ค้น Reference No. → อ่านรูปป้ายในคอลัมน์ STATUS + คอลัมน์ DECLARATION NO

| สถานะใน NETBAY | ระบบทำ |
|---|---|
| `ACCEPT` Customs Accept | ติ๊กแถวนั้น → ชื่อไฟล์ = **เลขที่ใบขน** → **Save PDF** → แตก zip เอา `<เลขใบขน>.pdf` → เลขใบขน + PDF เข้างาน (FILED) |
| `PREPARE` · `VALIDATED` · `SEND` · `SEND_CANCEL` | ป้ายเหลือง เช็กต่อ |
| `REJECT` · `IMPREJECT` · `ERROR` · `CANCEL_REJECT` | ป้ายแดง เช็กต่อ — แก้ใน NETBAY แล้ว Send ใหม่ จน ACCEPT ระบบดึงให้เอง |
| `CANCELED` · `DRAFT_CANCEL` | หยุดเช็ก คืนงานไป FAH › ตรวจ Draft (ขึ้นป้าย "ใบขนถูกยกเลิกใน NETBAY") |
| ไม่พบ Ref No. | ป้ายแดง "ไม่พบใน NETBAY" เช็กต่อ |
| อ่านรูปป้ายไม่ออก | ถ้ามีเลขใบขนแล้ว ถามช่อง Status = ACCEPT ของ NETBAY ตรง ๆ · ไม่งั้นขึ้น "ไม่รู้จักสถานะ (ชื่อรูป)" |

รหัสสถานะทั้งหมดอยู่ที่ `src/lib/customs-status.ts` (ตรงกับ `<option value>` ของช่อง Status ใน NETBAY)

### ติดตั้ง / ตั้งค่า

1. รันฐานข้อมูลก่อน deploy: `npm run migrate:customs-flow`
2. Vercel: `NETBAY_MONITOR_ACCOUNT=monitorerpkola:<รหัส>` (บัญชีแยกจากชุดบัญชีประจำเครื่อง)
3. เครื่อง FAH: **รันตัวติดตั้งซ้ำหนึ่งครั้ง** (`windows-setup.cmd` หรือ `mac-worker-launcher.sh`) ให้ตัวเปิดรู้จัก `kola-worker://customs`
   (ตัวติดตั้งดึงโค้ดจาก git — push ก่อน)

ค่าในเครื่อง (ไม่ต้องตั้งก็ได้): `CUSTOMS_MONITOR_MINUTES` (ค่าตั้งต้น 5) · `CUSTOMS_MONITOR_SHOW=1` แสดงหน้าต่าง Chrome
log: Windows `%LOCALAPPDATA%\KOLA\customs-monitor.log` · Mac `~/Library/Logs/KOLA/customs-monitor.log`

### ตรวจกับหน้าจริงของ NETBAY

ตัว monitor อ่านรหัสสถานะจาก**ชื่อไฟล์รูปป้าย** (หรือ title/alt) เพราะป้ายเป็นรูปภาพ
ถ้าหน้าคิวขึ้น "ไม่รู้จักสถานะ (…)" ให้รันบนเครื่องในออฟฟิศ (อ่านอย่างเดียว ไม่กดอะไร):

```sh
npm run netbay:probe -- QELS100015966 QELS100015970
```

พิมพ์สิ่งที่อ่านได้ และเก็บ HTML ของแถว/หัวตาราง/ช่อง select/ปุ่ม Save PDF ไว้ที่ `netbay-probe/<Ref No.>.html`
บัญชี: `NETBAY_MONITOR_USER` / `NETBAY_MONITOR_PASSWORD` ใน `.env.local` ถ้ามี ไม่งั้นใช้บัญชีประจำเครื่อง

## ส่งมอบคนเดินเอกสาร

- แท็บ 4 ติ๊กได้เฉพาะงานที่**รวมชุด E-Office แล้ว** → แถบล่าง **ส่งมอบคนเดินเอกสาร n รายการ**
- งานย้ายไป **Upload ชุดปล่อย E-Office** (คอลัมน์ "ส่งมอบคนเดินเอกสาร" บอกเวลา) อัปชุดที่เซ็นแล้วให้ตรงแถว → **ส่ง Partner**
- ส่งมอบผิดใบ (ยังไม่ได้อัปชุดที่เซ็น) → **คืนไปเตรียมเอกสาร**
- งานเก่าที่อัปชุดที่เซ็นไว้ก่อนมีขั้นส่งมอบ ยังอยู่หน้า Upload เหมือนเดิม

## แพลนลากตู้

- **NAMKANG › จัดการลากตู้สินค้า** — แถวละตู้ ของงานที่ PAINT กด**ส่ง Partner** แล้วเท่านั้น
  ติ๊กตู้ → เลือก **วันลากตู้** บนแถบล่าง → **ส่งแพลนให้ MAY** · แท็บส่งแพลนแล้วเปลี่ยนวันได้ (= ส่งใหม่ MAY ต้องรับอีกครั้ง)
  งานที่ไม่มีรายการตู้ขึ้นแจ้งด้านบน ให้เพิ่มตู้ในข้อมูลงานก่อน
- **MAY › แพลนลากตู้** — แพลนใหม่เรียงตามวันลากตู้ ติ๊กหลายตู้ → **รับแพลน**
- เก็บที่ตาราง `haul_plans` (ตู้ละแถว) — ที่ไว้ผูกข้อมูลฝั่ง ERP SHIPME ต่อ

## โค้ด

```
src/lib/customs-status.ts      รหัสสถานะ NETBAY · กลุ่ม/สีป้าย · อ่านรหัสจากรูปป้าย
src/lib/customs-monitor.ts     ฝั่ง ERP: lease · รายการที่ค้าง · บันทึกผลเช็ก/คืนงานที่ถูกยกเลิก
scripts/customs-monitor.ts     ตัววน (worker:customs)      scripts/customs-check.ts  เช็ก 1 รอบ
scripts/netbay-kola.ts         readDeclaration · acceptedByFilter · downloadDeclarationPdf · pdfFromDownload
scripts/netbay-probe.ts        อ่านหน้าจริงแบบไม่กดอะไร
src/lib/actions/eoffice-handover.ts   ส่งมอบ / คืน      src/lib/actions/haul-plan.ts   ส่งแพลน / รับแพลน
```

เทสต์: `npm run test:customs` (NETBAY จำลองใน `tests/draft-mock-netbay.ts` มีป้ายสถานะ ช่อง Status ติ๊กแถว ชื่อไฟล์ และ Save PDF ที่ได้ zip)
