# KOLA Automation Hub

เว็บพักข้อมูลระหว่าง **KOLA ERP** กับ **โปรแกรม Python** ที่รัน automate

Hub ไม่รู้จัก business logic ของ ERP หน้าที่เดียวคือ **รับงานเข้าคิว เก็บไฟล์ ส่งต่อให้ worker และพักผลลัพธ์ไว้ให้ ERP มาดึง**

```
[KOLA ERP] --submitTask--> [HUB] <--claimNext-- [Python worker]
     ^                       |                        |
     +----- getTasks --------+<---- completeTask -----+
```

## ตั้งค่าครั้งแรก

1. `npm run hub:open` เปิด Apps Script editor
2. รัน **`hubSetup()`** หนึ่งครั้ง แล้วกดอนุญาตสิทธิ์
3. คัดลอก **`apiKeyErp`** และ **`apiKeyWorker`** จาก Execution log เก็บไว้ — จะไม่แสดงซ้ำที่อื่น
   (ลืมได้ เรียก `hubShowKeys()` ดูใหม่ / สงสัยว่ารั่ว เรียก `hubRotateKeys()`)

`hubSetup()` จะสร้าง Spreadsheet และโฟลเดอร์ Drive ของ Hub เองอัตโนมัติ ไม่ต้องตั้ง ID ด้วยมือ
เรียกซ้ำได้ ของเดิมไม่ถูกสร้างใหม่และคีย์ไม่เปลี่ยน

## Endpoint

```
POST https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
Content-Type: application/json

{ "key": "<api key>", "fn": "<คำสั่ง>", "args": { ... } }
```

ตอบกลับเสมอเป็น `{"ok":true,"data":...}` หรือ `{"ok":false,"error":"CODE|ข้อความ"}`

**API key แยกสองใบตามบทบาท** — คีย์ของ worker เรียก `submitTask` ไม่ได้ เพื่อไม่ให้เครื่องที่รัน Python
ยัดงานเข้าคิวเองได้ และคีย์ของ ERP ก็เรียก `completeTask` ไม่ได้

| คำสั่ง | ใครเรียกได้ | ทำอะไร |
|---|---|---|
| `submitTask` | ERP | ส่งงานเข้าคิว |
| `getTasks` | ERP, worker | ดูสถานะ/ผลลัพธ์ |
| `downloadResultFile` | ERP | ดึงไฟล์ผลลัพธ์ (base64) |
| `retryTask` | ERP | เอางานที่ ERROR กลับเข้าคิว |
| `claimNext` | worker | ขอรับงานถัดไป |
| `downloadInputFile` | worker | ดึงไฟล์ input (base64) |
| `completeTask` | worker | ส่งผลลัพธ์กลับ |
| `failTask` | worker | แจ้งว่าทำไม่สำเร็จ |

## ประเภทงาน

| type | ERP ส่งมา | worker ต้องคืน |
|---|---|---|
| `DRAFT_ENTRY` | ไฟล์ Final Invoice (xlsx) | `refNo` |
| `CUSTOMS_ENTRY` | `data.refNo` | `entryNo` + ไฟล์ใบขนสินค้าขาเข้า |

สถานะ: `QUEUED` → `PROCESSING` → `DONE` / `ERROR`

งานที่ค้าง `PROCESSING` เกิน 30 นาทีถือว่า worker ตาย จะถูกปล่อยให้ตัวอื่นรับต่อได้เอง

`submitTask` ของ job + type เดียวกันที่ยังไม่จบ จะคืน task เดิม (`reused: true`) ไม่สร้างซ้ำ — กันกดปุ่มรัว

## ตัวอย่าง Python worker

```python
import base64, time, requests

HUB = "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
KEY = "<apiKeyWorker>"

def call(fn, args=None):
    r = requests.post(HUB, json={"key": KEY, "fn": fn, "args": args or {}},
                      timeout=120, allow_redirects=True)
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise RuntimeError(body.get("error", "unknown"))
    return body["data"]

def handle_draft_entry(task):
    blob = call("downloadInputFile", {"taskId": task["id"]})
    xlsx = base64.b64decode(blob["base64"])
    # TODO: รัน automate ด้วย xlsx แล้วได้เลข ref
    ref_no = run_draft_automation(xlsx)
    call("completeTask", {"taskId": task["id"], "refNo": ref_no, "worker": "py-1"})

def handle_customs_entry(task):
    ref_no = task["data"]["refNo"]
    # TODO: รัน automate ด้วย ref_no แล้วได้เลขใบขน + ไฟล์ PDF
    entry_no, pdf_bytes = run_customs_automation(ref_no)
    call("completeTask", {
        "taskId": task["id"],
        "entryNo": entry_no,
        "worker": "py-1",
        "file": {
            "name": f"{entry_no}.pdf",
            "mimeType": "application/pdf",
            "base64": base64.b64encode(pdf_bytes).decode(),
        },
    })

HANDLERS = {"DRAFT_ENTRY": handle_draft_entry, "CUSTOMS_ENTRY": handle_customs_entry}

while True:
    task = call("claimNext", {"worker": "py-1"}).get("task")
    if not task:
        time.sleep(20)
        continue
    try:
        HANDLERS[task["type"]](task)
        print("done", task["id"])
    except Exception as exc:
        call("failTask", {"taskId": task["id"], "error": str(exc), "worker": "py-1"})
        print("failed", task["id"], exc)
```

`claimNext` ใส่ `{"type": "DRAFT_ENTRY"}` ได้ถ้าอยากให้ worker ตัวนั้นรับเฉพาะงานประเภทเดียว

## ข้อจำกัด

- ไฟล์ต่อคำขอไม่เกิน **20 MB** (ส่งเป็น base64 จึงกินขนาดเพิ่มราว 33%)
- Apps Script มีโควตาการเรียกต่อวัน — worker ควร `sleep` อย่างน้อย 20 วินาทีเมื่อคิวว่าง ไม่ควร poll ถี่กว่านี้
- Endpoint เปิดสาธารณะ ความปลอดภัยอยู่ที่ API key ล้วน ๆ **อย่า commit คีย์ลง git**

## Deploy

```
npm run hub:release    # push + deploy
npm run hub:open       # เปิด editor
```
