# ส่งค่าใช้จ่ายราย BL จาก ERP SHIPME เข้า ERP KOLA (Total cost)

เอกสารสำหรับผู้พัฒนา ERP SHIPME

เมื่อแผนกบัญชี SHIPME จัดชุดใบแจ้งหนี้ ADV (หรือเพิ่มใบเข้าชุด / กดส่งซ้ำ) ERP SHIPME ส่งรายการค่าใช้จ่ายของทุก BL ในชุดมาที่ endpoint นี้
ฝ่ายบัญชี KOLA (role ACCOUNT OFFICER) ดูได้ที่เมนู **Total cost** ซึ่งรวมเป็น BL ละแถว

ส่งรอบเดียวกับค่าใช้จ่ายพิเศษ (`/api/shipme/special-charges`) และใช้คีย์เดียวกัน

## Endpoint

```
POST https://erp-kola.vercel.app/api/shipme/costs
Content-Type: application/json
Authorization: Bearer <SHIPME_API_KEY>
```

## Body

```json
{
  "batchName": "ชุดที่ 03/11",
  "bls": [
    {
      "blNo": "AMP0561328B",
      "customer": "HEIWA AUTO",
      "invoices": [
        { "number": "V20261105", "kind": "V", "issueDate": "2026-11-10", "batchName": "ชุดที่ 03/11" },
        { "number": "NV20261105", "kind": "NV", "issueDate": "2026-11-10", "batchName": "ชุดที่ 03/11" }
      ],
      "lines": [
        { "source": "INVOICE", "ref": "V20261105", "kind": "V", "label": "ADV - ค่าแลก DO (VAT)", "amount": 1000, "vat": 70 },
        { "source": "INVOICE", "ref": "V20261105", "kind": "V", "label": "ADV - ค่า LIFT ON", "amount": 1000, "vat": 70 },
        { "source": "INVOICE", "ref": "NV20261105", "kind": "NV", "label": "ADV - ค่าแลก DO", "amount": 3000 },
        { "source": "SETTLEMENT", "ref": "ชิปปิ้ง สมชาย · ตรวจปล่อย 09/11/2026", "key": "overtime", "label": "ค่าล่วงเวลา (มีใบเสร็จ)", "amount": 300 },
        { "source": "SETTLEMENT", "ref": "ชิปปิ้ง สมชาย · ตรวจปล่อย 09/11/2026", "key": "special", "label": "ค่าน็อคตู้", "amount": 100 },
        { "source": "TRANSPORT", "ref": "ชีตงานขนส่ง · 09/11/2026", "key": "dem", "label": "DEM", "amount": 4500 }
      ]
    }
  ]
}
```

| ช่อง | คำอธิบาย |
|---|---|
| `bls` | 1–200 BL ต่อครั้ง · BL ที่เคยส่งแล้ว = แทนรายการเดิมทั้งหมดด้วยชุดนี้ |
| `lines[].source` | `INVOICE` บรรทัดในใบแจ้งหนี้ ADV · `SETTLEMENT` ช่องในใบปิดบัญชีชิปปิ้ง · `TRANSPORT` ช่องในชีตงานขนส่ง (ตอนนี้ส่งเฉพาะ DEM) |
| `lines[].amount` | ยอดก่อน VAT (ใบ V = ยอดในใบที่หาร 1.04 แล้ว) |
| `lines[].vat` | VAT 7% ของบรรทัด · ใบ NV และบรรทัดที่ไม่เข้าฐานภาษี (DO NON VAT) = 0 |
| `lines[].key` | คีย์ช่องฝั่ง SHIPME (`lift_off`, `overtime`, `seal`, `extra_service`, `special` …) — KOLA ใช้จัดหมวดบรรทัดจากใบปิดบัญชี |

ส่งรายการดิบ ไม่ต้องจัดหมวดหรือคิดหัก ณ ที่จ่ายเอง — KOLA ทำเอง (src/lib/total-cost/cost.ts)

## กติกาฝั่ง KOLA

- หมวด: DO (VAT) · DO (No VAT) · DEM · EXTRA MOVEMENT · STORAGE · LIFT ON · LIFT OFF · ค่านายตรวจ · ค่าล่วงเวลา · ค่าตะกั่ว · ค่า พรบ. · ค่า ER ท่า B2 · ค่าน็อค · ค่าใช้จ่ายพิเศษ (Sale) · อื่น ๆ
- หัก ณ ที่จ่าย 3% คิดทีละบรรทัดจากยอดก่อน VAT เฉพาะบรรทัดที่มี VAT ของหมวด DO / EXTRA MOVEMENT / STORAGE / LIFT ON / LIFT OFF
- ไม่นับซ้ำ: DO / LIFT ON / EXTRA MOVEMENT / STORAGE / พรบ. นับจากใบแจ้งหนี้เท่านั้น · หมวดอื่นนับจากใบปิดบัญชี เว้นแต่ใบแจ้งหนี้มีบรรทัดหมวดนั้น · DEM จากชีตใช้เมื่อใบแจ้งหนี้ไม่มี DEM
- ยางเกิน / สำแดงเท็จ ใช้ยอดที่ Sale เจรจา (อนุมัติแล้ว = ยอดที่ตกลง · ยังไม่อนุมัติ = ยอดที่ SHIPME ขอ พร้อมป้ายเตือน)

## Response

`200` `{ "ok": true, "results": [{ "blNo": "AMP0561328B", "id": "TCO-…", "created": true, "lines": 6, "jobMatched": true }] }`

| HTTP | ความหมาย |
|---|---|
| 400 | ข้อมูลไม่ครบ / ไม่ถูกต้อง (ดู `error`) |
| 401 | API key ไม่ถูกต้อง |
| 503 | KOLA ยังไม่ได้ตั้งคีย์ หรือยังไม่ได้สร้างตาราง (`npm run migrate:total-cost`) |
