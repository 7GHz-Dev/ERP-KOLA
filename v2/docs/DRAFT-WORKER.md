# worker สร้าง Draft ใบขนใน NETBAY

PAINT → งานคงค้าง → **3. Draft ใบขน** → กด **สร้าง Draft** → งานเข้าคิว `DRAFT_ENTRY` พร้อมไฟล์ Final Invoice
`npm run worker:draft` บนเครื่องในออฟฟิศหยิบงานไปทำ:

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

ต้องมี Node.js, Google Chrome และโค้ด ERP-KOLA · เครื่องต้องเปิด `http://192.168.1.123` ได้

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
