# KOLA Import ERP v1.1

Web App สำหรับงานนำเข้าของ PAINT, FAH และ NAMKANG โดยใช้ Google Apps Script เป็น backend, Google Sheets เป็นฐานข้อมูล และ Google Drive เก็บเอกสาร

## ปลายทางที่ตั้งค่าไว้

- Spreadsheet ID: `1OlGfGpTLvRK7BzX1Gpp3d8qDlRin4DNeFxImeJBHV7k`
- Drive Folder ID: `1DaRGrWUFo9R6tKR2yEgWV9GN6DJNS82a`
- เปลี่ยนปลายทางได้ใน `Config.gs`

## ความสามารถหลัก

- หน้าอัปโหลด AN และ BL แยกกันตาม mockup
- อ่าน PDF ที่มี text layer ด้วย PDF.js และกรอก BL, Shipper, Container, Vessel, Voyage, ETA, Product, Weight, Shipline และ Port ให้อัตโนมัติ
- แสดง PDF Preview ทางขวาระหว่างตรวจข้อมูล
- รองรับหลาย BL และหลาย Container ในหนึ่ง Job
- Queue และเมนูแยกตาม PAINT, FAH, NAMKANG และ Master Data
- ลำดับอนุมัติ AN โดย NAMKANG และ Final Invoice โดย FAH
- PAINT สร้างและส่ง Draft จากนั้น FAH ยืนยันเลขใบขน
- E-Office และ Surrender BL เป็น gate ก่อน NAMKANG แจ้งปล่อยสินค้า
- Job Drawer แสดงรายละเอียด, Container, ไฟล์, Timeline และเลื่อนไป Job ก่อนหน้า/ถัดไปได้
- เมื่อ NAMKANG เปลี่ยน Invoice สินค้า ต้องระบุเหตุผล แถว Job จะเป็นสีแดงจน PAINT หรือ FAH กดรับทราบ
- เก็บไฟล์ทุก version และบันทึก Activity Log

## ลำดับงาน

1. PAINT อัปโหลด AN หรือ BL ระบบอ่านไฟล์และกรอกข้อมูล
2. PAINT ตรวจข้อมูล แล้วส่ง AN ให้ NAMKANG อนุมัติ
3. เมื่อ AN ผ่าน งาน Invoice DO, Invoice สินค้า และ Surrender BL จึงเริ่มทำงานได้
4. NAMKANG บันทึกลูกค้า อัปโหลด Invoice สินค้าและ Surrender BL
5. FAH อัปโหลด Invoice DO และส่งข้อมูล Port Release Partner
6. PAINT อัปโหลด Final Invoice แล้วส่งให้ FAH อนุมัติ
7. เมื่อ Final Invoice ผ่าน PAINT สร้าง Draft และส่งให้ FAH ตรวจ
8. FAH ยืนยันเลขใบขน จากนั้น PAINT อัปโหลด E-Office
9. NAMKANG ตั้ง Surrender เป็น `CLEARED` เมื่อมีไฟล์แล้ว
10. เมื่อ E-Office ครบและ Surrender เคลียร์ NAMKANG จึงแจ้งปล่อยสินค้าได้

Port Release ทำขนานกับขั้นตอนใบขนได้ เมื่อทั้งสองฝั่งเสร็จ Job จะเป็น `RELEASED`

## ติดตั้งครั้งแรก

1. สร้าง Apps Script project ใหม่ที่ [script.google.com](https://script.google.com/)
2. สร้างไฟล์ใน Apps Script ให้ชื่อตรงกับไฟล์ในโฟลเดอร์นี้ แล้วใส่เนื้อหาแต่ละไฟล์ หรือใช้ `clasp push`
3. เปิดไฟล์ `Setup.gs`
4. เลือกฟังก์ชันสาธารณะชื่อ `setupSystem` จาก dropdown ด้านบน แล้วกด Run
5. อนุญาตสิทธิ์ Google Sheets, Google Drive และข้อมูลอีเมลผู้ใช้
6. เปิด `Executions` แล้วดู log ของ `setupSystem`
7. เก็บค่า `adminUsername` และ `temporaryPassword` จาก log

ฟังก์ชันที่ต้องเลือกคือ `setupSystem` ไม่มีขีดล่างท้ายชื่อ ส่วน `setupSystem_` เป็นฟังก์ชันภายใน จึงไม่ต้องเลือกจากหน้า Run

`setupSystem()` สร้างชีต, headers, Master Data เริ่มต้น, password pepper และบัญชี `admin` โดยไม่ลบข้อมูลเดิม

## อัปเกรดจากรุ่นก่อน

1. แทนที่ไฟล์ใน Apps Script ด้วยไฟล์ชุด v1.1 นี้ทั้งหมด
2. ลบไฟล์ `Scripts.html` รุ่นเก่าจาก Apps Script หากยังมีอยู่
3. เปิด `Setup.gs` แล้ว Run ฟังก์ชัน `setupSystem` อีกครั้ง เพื่อเพิ่ม column และ Master Data ที่ขาด โดยไม่ลบข้อมูลเดิม
4. ไปที่ `Deploy` > `Manage deployments` > `Edit`
5. เลือก `New version` แล้ว Deploy เพื่อให้ Web App URL เดิมใช้โค้ดล่าสุด

## Deploy Web App

1. เลือก `Deploy` > `New deployment`
2. Type: `Web app`
3. Execute as: `Me`
4. Who has access: `Anyone`
5. เปิด Web App URL และ login ด้วยบัญชี `admin`
6. เปลี่ยนรหัสผ่านชั่วคราวทันที
7. ไปที่ Master Data > ผู้ใช้งาน แล้วสร้างบัญชี PAINT, FAH และ NAMKANG

ระบบมีบัญชีผู้ใช้และ session ภายใน จึงไม่จำเป็นต้องใช้ Google Workspace แต่เจ้าของ Apps Script ต้องมีสิทธิ์เข้าถึง Spreadsheet และ Drive Folder ที่ตั้งค่าไว้

## ข้อจำกัดการอ่าน PDF

- PDF.js อ่านได้เฉพาะ PDF ที่มี text layer เช่นไฟล์ที่ export จากระบบสายเรือ
- PDF ที่เป็นภาพสแกนอย่างเดียวจะเปิด Preview ได้ แต่กรอกข้อมูลอัตโนมัติไม่ได้ และจะแจ้งให้กรอกเอง
- Web App ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อโหลด PDF.js จาก CDN
- จำกัดไฟล์อัปโหลดไม่เกิน 8 MB ต่อไฟล์

## กติกา Invoice สินค้า

- Upload ครั้งแรกเป็น version 1 และไม่สร้าง alert
- การเปลี่ยนไฟล์ต้องระบุเหตุผล
- ไฟล์เดิมยังอยู่ในประวัติ และไฟล์ใหม่เป็น current version
- `JOBS.hasInvoiceAlert` จะเป็น `true` และทุกตารางที่แสดง Job นั้นจะเป็นแถวสีแดง
- PAINT หรือ FAH ต้องกด `รับทราบ` แล้วแถวจึงกลับเป็นปกติ

## ทดสอบ

รัน regression test ของ backend ด้วย mock Google Sheets/Drive:

```powershell
node test/gas-core.test.js
# หรือ
npm test
```

สร้างหน้า preview สำหรับตรวจโครง UI (ครั้งเดียว, ไม่มี live reload):

```powershell
node test/build-preview.js
# หรือ
npm run build:preview
```

## Dev ผ่าน VS Code (preview สด + sync ขึ้น Apps Script จริง)

ครั้งแรก:

```powershell
npm install          # ติดตั้ง @google/clasp (แค่ครั้งเดียว)
```

### 1. Preview UI แบบสด (ไม่แตะ Spreadsheet/Drive จริง)

```powershell
npm run dev
```

เปิด `http://localhost:5173/` แล้วแก้ `Index.html`, `Styles.html`, `MockupStyles.html`, `AppScripts.html`
ได้เลย — server จะ build ใหม่อัตโนมัติทุกครั้งที่ save แค่ refresh browser ก็เห็นผล
หน้านี้ mock `google.script.run` ด้วยข้อมูลปลอมใน `test/preview-mock.js` (ดูใน `test/jobs` ตัวอย่าง)
จึงเหมาะกับงานแก้ layout/ฟอร์ม/logic ฝั่ง client เท่านั้น ไม่ใช่การทดสอบกับข้อมูลจริง

### 2. Sync โค้ดขึ้น Apps Script project จริง (ทดสอบ end-to-end)

`.clasp.json` ผูกกับ project จริงไว้แล้ว (scriptId `1b8_3iGPvQgyXBvG3eLSmNTSJo1b1YhoRRlYbT_dkl7uqO5TCr5K7rXaO`)
ล็อกอินครั้งแรกเท่านั้น (เปิด browser ให้ auth ด้วย Google account ที่มีสิทธิ์ project นี้):

```powershell
npx clasp login
```

จากนั้น sync ได้ตามต้องการ:

```powershell
npx clasp push     # หรือ npm run clasp:push  — ส่งโค้ดโลคัลขึ้น Apps Script
npx clasp pull      # หรือ npm run clasp:pull  — ดึงโค้ดจาก Apps Script ลงมาโลคัล (เผื่อแก้ในเว็บ)
npx clasp open      # หรือ npm run clasp:open  — เปิด Apps Script editor ใน browser
```

หลัง push แล้วต้อง deploy version ใหม่เอง (`Deploy` > `Manage deployments` > `Edit` > `New version`)
Web App URL เดิมถึงจะใช้โค้ดล่าสุด — clasp push ไม่ deploy อัตโนมัติ

## Acceptance Check

1. อัปโหลด AN และ BL ที่มี text layer แล้วตรวจว่าฟอร์มถูกกรอกและ Preview เปิดด้านขวา
2. ส่ง AN, ให้ NAMKANG อนุมัติ/ไม่อนุมัติพร้อมเหตุผล และแก้ไขก่อนอนุมัติ
3. อัปโหลด Final Invoice แล้วตรวจว่า FAH เป็นผู้อนุมัติเท่านั้น
4. ตรวจว่า PAINT สร้าง Draft ได้หลัง FN ผ่าน และ FAH ยืนยันเลขใบขนได้หลัง PAINT ส่ง Draft เท่านั้น
5. เปลี่ยน Invoice สินค้าโดยไม่ใส่เหตุผล ต้องถูกปฏิเสธ
6. เปลี่ยน Invoice พร้อมเหตุผล แถวต้องแดงจน PAINT หรือ FAH กดรับทราบ
7. ตั้ง Surrender เป็นเคลียร์โดยยังไม่มีไฟล์ ต้องถูกปฏิเสธ
8. ตรวจ Drawer, Timeline, File Preview และปุ่มก่อนหน้า/ถัดไป
9. ทำ E-Office, Surrender และ Release ให้ครบหนึ่ง Job
