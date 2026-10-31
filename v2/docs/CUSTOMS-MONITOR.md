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
  บัญชี monitor login ได้ทีละที่ ตัวเก่าเห็นใน 10 วินาทีว่ามีเครื่องอื่นรับไปแล้วก็ปิดตัวเอง (lease ใน `master_records` type `customsMonitor`)
  บนเครื่องเดียวกันถ้าเปิดอยู่แล้ว ตัวเปิดไม่เปิดซ้ำ — ตัวที่เปิดอยู่เห็นงานใหม่ภายใน 10 วินาทีแล้วเช็กทันที
- **ปุ่ม ↻ Refresh** ที่หัวหน้า FAH › ตรวจ Draft / รอไฟล์และเลขใบขน และคิวงาน Automation = เข้าไปเช็กใน NETBAY ตอนกดเลย
  เลือก **NETBAY user** ข้างปุ่มก่อนกด (ค่าตั้งต้น = บัญชี monitor · จำค่าไว้ในเบราว์เซอร์) — ใช้บัญชีนี้เฉพาะรอบที่กด รอบปกติยังใช้บัญชี monitor
  ตัว monitor ออนไลน์อยู่ (เครื่องไหนก็ได้) รับไปเช็กภายใน 10 วินาที · ไม่มี = เปิดตัว monitor บนเครื่องที่กด · เช็กเสร็จหน้าโหลดข้อมูลใหม่เอง
  **กดได้ครั้งละ 1 นาที รวมทุกคน** (เซิร์ฟเวอร์กัน · ปุ่มนับถอยหลัง) · คำขอเก็บที่ `master_records` type `customsMonitor` code `refresh`
- **ปิดเอง** ได้จากปุ่ม **ปิดเช็คสถานะ** บนแถบสถานะ (คิว Automation › รอสร้างใบขน และ FAH › ตรวจ Draft › แท็บรอผล)
  ระบบยึด lease ไว้ ตัว monitor ปิดหลังจบรอบที่เช็กอยู่ (ตัวรุ่นเก่าก็ปิดตาม) · รายการค้างยังอยู่ในคิว กดเปิดใหม่เมื่อไรก็เช็กต่อ
- **ไม่มีหน้าต่าง** (เช็กซ้ำระหว่างที่ FAH ใช้เครื่อง) — ดู log + ภาพหน้าจอได้ที่ **ดูการทำงาน** บนแถบสถานะ
- **ปิดตัวเองเมื่อ ACCEPT ครบทุกรายการ**

ต่อ 1 รายการ: ค้น Reference No. → อ่านรูปป้ายในคอลัมน์ STATUS
→ ป้าย ACCEPT (หรืออ่านไม่ออก) **เปิดใบขนแล้วเอาเลขใบขนจากแถบเขียวด้านบน** `REF … Decl A0310691002615 Status Customs Accept`
(คอลัมน์ DECLARATION NO ในหน้ารายการว่างได้แม้ ACCEPT แล้ว — ใช้เป็นทางสำรอง) · เลขต้องติดคำว่า Decl
ไม่จับเลขรูปแบบเดียวกันอื่นในหน้า (เช่น Export Tax Incentives ID) · Status บนแถบใช้แทนเมื่ออ่านรูปป้ายไม่ออก

| สถานะใน NETBAY | ระบบทำ |
|---|---|
| `ACCEPT` Customs Accept · `AUDIT_LOADED` Audit Loaded 04 · `AUDIT_CHECKED` Audit Checked 03 | ติ๊กแถวนั้น → ชื่อไฟล์ = **เลขที่ใบขน** → **Save PDF** → แตก zip เอา `<เลขใบขน>.pdf` → เลขใบขน + PDF เข้างาน (FILED) |
| `PREPARE` · `VALIDATED` · `SEND` · `SEND_CANCEL` | ป้ายเหลือง เช็กต่อ |
| `REJECT` · `IMPREJECT` · `ERROR` · `CANCEL_REJECT` | ป้ายแดง เช็กต่อ — แก้ใน NETBAY แล้ว Send ใหม่ จน ACCEPT ระบบดึงให้เอง |
| `CANCELED` · `DRAFT_CANCEL` | หยุดเช็ก คืนงานไป FAH › ตรวจ Draft (ขึ้นป้าย "ใบขนถูกยกเลิกใน NETBAY") |
| ไม่พบ Ref No. | ป้ายแดง "ไม่พบใน NETBAY" เช็กต่อ |
| อ่านรูปป้ายไม่ออก | ดู Status บนแถบเขียวของหน้าใบขน · ไม่ได้อีกและมีเลขใบขน ถามช่อง Status = ACCEPT ของ NETBAY · ไม่งั้นขึ้น "ไม่รู้จักสถานะ (ชื่อรูป)" |

รหัสสถานะทั้งหมดอยู่ที่ `src/lib/customs-status.ts` (ตรงกับ `<option value>` ของช่อง Status ใน NETBAY)

### ติดตั้ง / ตั้งค่า

1. รันฐานข้อมูลก่อน deploy: `npm run migrate:customs-flow`
2. Vercel: `NETBAY_MONITOR_ACCOUNT=monitorerpkola:<รหัส>` (บัญชีแยกจากชุดบัญชีประจำเครื่อง)
3. เครื่อง FAH: **รันตัวติดตั้งซ้ำหนึ่งครั้ง** (`windows-setup.cmd` หรือ `mac-worker-launcher.sh`) ให้ตัวเปิดรู้จัก `kola-worker://customs`
   (ตัวติดตั้งดึงโค้ดจาก git — push ก่อน) · หลังจากนั้นเครื่อง Windows อัปเดตเองเบื้องหลัง (ดู DRAFT-WORKER.md › เวอร์ชัน / อัปเดตอัตโนมัติ)

ค่าในเครื่อง (ไม่ต้องตั้งก็ได้): `CUSTOMS_MONITOR_MINUTES` (ค่าตั้งต้น 5) · `CUSTOMS_MONITOR_SHOW=1` แสดงหน้าต่าง Chrome
log: Windows `%LOCALAPPDATA%\KOLA\customs-monitor.log` · Mac `~/Library/Logs/KOLA/customs-monitor.log`

### ตรวจกับหน้าจริงของ NETBAY

ป้ายสถานะเป็นรูปภาพ — ตัว monitor โหลดไฟล์รูปของแถวนั้นแล้ว**เทียบกับรูปต้นฉบับทีละไบต์** (sha256)
รูปต้นฉบับ 10 แบบเก็บไว้ที่ `assets/netbay/status/<รหัส>.gif` (ได้จากหน้าจริง) · ไม่ตรงรูปไหนค่อยเดาจากชื่อไฟล์/title/alt
ยังไม่มีรูปของ Customer Reject · Sending Cancel · Cancel Draft — เจอแล้วขึ้น "ไม่รู้จักสถานะ" ให้บันทึกรูปนั้นมาเพิ่ม
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
src/lib/customs-status.ts      รหัสสถานะ NETBAY · กลุ่ม/สีป้าย · อ่านรหัสจากรูปป้าย · parseDeclarationHeader (แถบ Decl)
src/lib/customs-monitor.ts     ฝั่ง ERP: lease · รายการที่ค้าง · บันทึกผลเช็ก/คืนงานที่ถูกยกเลิก · คำขอ Refresh
src/components/CustomsRefresh.tsx   ปุ่ม Refresh + ช่อง NETBAY user (src/components/NetbayUser.tsx)
scripts/customs-monitor.ts     ตัววน (worker:customs)      scripts/customs-check.ts  เช็ก 1 รอบ
scripts/netbay-kola.ts         readDeclaration · readDeclarationHeader · acceptedByFilter · downloadDeclarationPdf · pdfFromDownload
scripts/netbay-probe.ts        อ่านหน้าจริงแบบไม่กดอะไร
src/lib/actions/eoffice-handover.ts   ส่งมอบ / คืน      src/lib/actions/haul-plan.ts   ส่งแพลน / รับแพลน
```

เทสต์: `npm run test:customs` (NETBAY จำลองใน `tests/draft-mock-netbay.ts` มีป้ายสถานะ แถบ Decl ในหน้าใบขน ช่อง Status ติ๊กแถว ชื่อไฟล์ และ Save PDF ที่ได้ zip)
