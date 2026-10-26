# worker สร้าง Draft ใบขนใน NETBAY

PAINT → งานคงค้าง → **3. Draft ใบขน** → กด **สร้าง Draft** → งานเข้าคิว `DRAFT_ENTRY` พร้อมไฟล์ Final Invoice
แล้ว**เครื่องที่กดเป็นคนทำ**: หน้าเว็บเปิดลิงก์ `kola-worker://draft?task=<เลขงาน>` ให้ตัวเปิดในเครื่องรัน
`npm run worker:draft -- --task <เลขงาน>` (ทำงานนั้นงานเดียวแล้วปิด) — worker กลางที่เปิดค้างไว้ไม่หยิบงานแบบนี้
ถ้าไม่มีหน้าต่าง NETBAY ขึ้นมา กด **เปิดบนเครื่องนี้** ข้างป้ายสถานะ (หรือเครื่องยังไม่ได้ติดตั้ง)

ขั้นตอนของงาน 1 ชิ้น:

1. ตรวจ Final Invoice (template MSFZ, JTC, AICHI, HUAYO, JAN TRADING) + เลข BL ต้องตรงกับงาน
   ไม่ผ่าน → งานขึ้น **สร้าง Draft ไม่สำเร็จ** พร้อมเหตุผล แก้ไฟล์แล้วกดสร้างใหม่ได้ (ไม่ออกเลข ไม่แตะ NETBAY)
2. ออกเลขเครื่อง 7 หลักที่ไม่ซ้ำ (ตาราง `engine_numbers`) เติมลง Excel และสร้าง CSV (TIS-620)
   chassis ที่เคยได้เลขใน BL เดียวกันใช้เลขเดิม — กดสร้าง Draft ซ้ำได้ เลขไม่เปลี่ยน
   ไม่พบพิกัด = `XXXX` / หลายพิกัด = `0000XXXX` เหมือนโปรแกรมเดิม — แก้ในใบขนบน NETBAY
3. NETBAY: login → New (610) → กรอกหัวใบขน → Add Invoice → Import CSV
   **จบเมื่อขึ้น "success please check your invoice"** — ไม่กด Save / Send to Customs
4. ส่ง **Ref No.** (เช่น `QENX000000019`) + ไฟล์ "FN Invoice (เติมเลขเครื่องแล้ว)" + "CSV นำเข้า NETBAY" เข้างาน

เลข Ref No. ทุกหน้า (รวมหน้าตรวจ Draft ของ FAH) เป็นลิงก์ `kola-netbay://open?ref=…`
กดแล้วเครื่องนั้นเปิด Chrome → login → Import → ค้นหา Ref No. → เปิดใบขน
(ลิงก์ตรงไปหน้าใบขนใช้ไม่ได้ เพราะ NETBAY ผูก session ไว้กับเบราว์เซอร์ที่ login)

## ติดตั้งบนเครื่องในออฟฟิศ (ครั้งเดียว)

กด **สร้าง Draft** ได้จากทุกเครื่องโดยไม่ต้องติดตั้งอะไร (ขอแค่มี worker เปิดอยู่สักเครื่อง)
ที่ต้องติดตั้งคือเครื่องที่จะ **กดเลข Ref No. เปิดใบขน** หรือ **เปิด worker** — เครื่องต้องเปิด `http://192.168.1.123` ได้

### Windows 10/11 — คลิกเดียว

ล็อกอิน ERP แล้วดาวน์โหลดจากส่วน **"ติดตั้งบนเครื่องนี้"** ที่แท็บ Draft ใบขน (`/api/install/windows`) แล้วดับเบิลคลิก
ติดตั้ง Git / Node.js LTS / Google Chrome ที่ยังไม่มี (winget) → ดึงโค้ดไว้ที่ `%USERPROFILE%\ERP-KOLA` → `npm install`
→ ใส่ `WORKER_API_KEY` (ฝังมากับไฟล์ที่ดาวน์โหลด ไม่ต้องกรอก) → จองบัญชี NETBAY ประจำเครื่อง → ลงทะเบียนลิงก์
ไม่ต้องกรอกอะไร · ไฟล์นี้มีคีย์ของระบบ ห้ามส่งต่อให้คนนอก (ไฟล์ต้นแบบ `public/install/windows-setup.cmd` ไม่มีคีย์)
รันซ้ำได้ = อัปเดตโค้ด · ถ้า Windows ขึ้น "ป้องกันพีซีของคุณ" กด ข้อมูลเพิ่มเติม → เรียกใช้

### ติดตั้งเอง (Mac หรือ Windows)

ต้องมี Node.js, Google Chrome และโค้ด ERP-KOLA

```sh
cd v2 && npm install
```

ใส่ใน `v2/.env.local`

```
WORKER_API_KEY=<ตัวเดียวกับบน Vercel>
NETBAY_USER=<user NETBAY>
NETBAY_PASSWORD=<รหัส NETBAY>
```

ติดตั้งตัวเปิด (ปุ่ม "เปิด worker" และลิงก์ Ref No.)

| เครื่อง | ติดตั้ง |
|---|---|
| Mac | `bash scripts/install/mac-worker-launcher.sh` |
| Windows | ดับเบิลคลิก `scripts\install\windows-worker-launcher.cmd` |

ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊ก "อนุญาตเสมอ" แล้วกดเปิด

## บัญชี NETBAY (เครื่องละบัญชี)

NETBAY ให้ login ด้วยบัญชีเดียวได้ทีละที่ — สองเครื่องใช้บัญชีเดียวกันพร้อมกัน เครื่องแรกจะหลุดกลางงาน
ตัวติดตั้งจึงขอบัญชีจาก ERP ด้วยชื่อเครื่อง (`npm run netbay:account`) แล้วเขียน `NETBAY_USER` / `NETBAY_PASSWORD` ลง `.env.local`
เครื่องเดิมได้บัญชีเดิมเสมอ · ชุดทดลอง `erpkola1` ถึง `erpkola10` (รหัสผ่านเหมือนชื่อ)
เปลี่ยนชุดได้ด้วย `NETBAY_ACCOUNT_POOL="user1:pass1,user2:pass2"` บน Vercel · การจองเก็บใน `master_records` (type `netbayAccount`)
ข้อจำกัด: ในเครื่องเดียวกัน ถ้ากดเปิดเลข Ref No. ระหว่างที่เครื่องนั้นกำลังสร้าง Draft จะ login บัญชีเดียวกันซ้อนกัน

## หน้าต่าง NETBAY

หน้าต่าง NETBAY เปิดเต็มจอ · ย่อการแสดงผลตาม `NETBAY_ZOOM` (ค่าตั้งต้น `0.8`) ให้เห็นทั้งหน้าโดยไม่ต้องเลื่อน
(ฝัง NETBAY ลงในหน้า ERP ไม่ได้ — ERP เป็น https แต่ NETBAY เป็น http ในเครือข่ายภายใน และผูก session กับเบราว์เซอร์ที่ login)

- สร้าง Draft: เห็นการทำงานในหน้าต่างเต็มจอตั้งแต่ login
- กดเลข Ref No.: เห็นการทำงานในหน้าต่างเต็มจอ (ไม่มีแถบ tab/ช่อง URL) ตั้งแต่ login ค้นหา จนเปิดใบขน

## ใช้งาน

- กด **เปิด worker** ที่แท็บ 3. Draft ใบขน (หรือรัน `npm run worker:draft` เอง · ทดสอบ 1 งาน: `-- --once`)
- แถบเดียวกันบอกว่า worker ออนไลน์ไหม ทำงานไหนอยู่ · **ดูการทำงาน** = log + ภาพหน้าจอ NETBAY สด
- `NETBAY_HEADLESS=1` = ไม่มีหน้าต่าง Chrome
- log ของตัวเปิด: Mac `~/Library/Logs/KOLA/` · Windows `%LOCALAPPDATA%\KOLA\`

## เลขเครื่อง (ตาราง engine_numbers)

ใช้ร่วมกันทุกเครื่อง ออกเลขใน transaction ที่ล็อกทั้งตาราง — worker หลายเครื่องก็ไม่ได้เลขซ้ำ

```sh
npm run engine:migrate                       # สร้างตาราง (ครั้งเดียว รันซ้ำได้)
npm run engine:import -- db_random_engine.csv # นำเข้าเลขเดิม (SQL Server / engine.db ของ imp) แถวที่มีแล้วข้าม
```

## ไฟล์ข้อมูล (`assets/netbay/`)

| ไฟล์ | ใช้เป็น |
|---|---|
| `csv_template.xlsx` | หัวคอลัมน์ CSV (แถว 1) และค่าคงที่ (แถว 3) เช่น `FX_permitNo1` |
| `brand_country.xlsx` | ยี่ห้อที่ไม่ได้ผลิตในญี่ปุ่น → `originCountry` |
| `DATA TARIFF.xlsx` | ตารางพิกัดสำรอง เมื่อ invoice ไม่มีชีต `datatariff` |

แก้ไฟล์แล้วเปิด worker ใหม่

## โค้ด

```
src/lib/draft/          อ่าน invoice · ตรวจ · พิกัด · CSV · TIS-620 · เขียนเลขเครื่องลง Excel (แก้ XML เฉพาะช่อง)
src/lib/engine-numbers.ts  ค้นหา/ออกเลขเครื่อง (เรียกผ่าน /api/worker: engineLookup · engineIssue)
scripts/draft-worker.ts วนรับงาน + สัญญาณสถานะ        scripts/draft-task.ts  งาน 1 ชิ้น
scripts/netbay-kola.ts  คุมหน้าเว็บ NETBAY              scripts/netbay-open.ts ลิงก์ Ref No.
```

ยกมาจากโปรแกรม imp (Python) — ผลตรวจและ CSV ตรงกันทุกไบต์ ตรวจด้วย `npm run test:draft`
(golden files ใน `tests/fixtures/draft/` + NETBAY จำลองใน `tests/draft-mock-netbay.ts`)
