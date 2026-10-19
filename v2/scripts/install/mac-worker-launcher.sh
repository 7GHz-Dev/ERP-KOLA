#!/bin/bash
#
# ติดตั้งตัวเปิด worker กรอกเว็บบน Mac — ให้ปุ่ม "เปิด worker" ที่หน้าจัดการแลก DO ใช้ได้
#
# สร้างแอป ~/Applications/KOLA Worker.app ที่รับลิงก์ kola-worker://start
# กดปุ่มบนเว็บแล้วแอปนี้รัน npm run worker:web ในโฟลเดอร์ v2 นี้แบบไม่มีหน้าต่าง Terminal
# ดูการทำงานได้ที่ปุ่ม "ดูการทำงาน" บนหน้าแลก DO หรือไฟล์ ~/Library/Logs/KOLA/web-worker.log
# ถ้า worker เปิดอยู่แล้วจะไม่เปิดซ้ำ (โปรไฟล์ Chrome เปิดได้ทีละตัว)
#
# วิธีใช้ (ในโฟลเดอร์ v2):  bash scripts/install/mac-worker-launcher.sh
# ย้ายโฟลเดอร์โค้ดไปที่อื่นแล้วต้องรันใหม่ เพราะแอปจำที่อยู่โฟลเดอร์ไว้
set -euo pipefail

V2="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Applications/KOLA Worker.app"

command -v npm >/dev/null || { echo "ไม่พบ npm — ติดตั้ง Node.js ก่อน"; exit 1; }
# แอปที่เปิดจากลิงก์ไม่ได้โหลด PATH ของ shell — จำที่อยู่ของ node ไว้ตอนติดตั้ง
NODE_DIR="$(dirname "$(command -v node)")"
LOG_DIR="$HOME/Library/Logs/KOLA"
[ -d "$V2/node_modules" ] || { echo "ยังไม่ได้ npm install — กำลังติดตั้ง"; (cd "$V2" && npm install); }
grep -q '^WORKER_API_KEY=.' "$V2/.env.local" 2>/dev/null || echo "⚠️  ยังไม่มี WORKER_API_KEY ใน $V2/.env.local — worker จะต่อ ERP ไม่ได้จนกว่าจะใส่"

SCRIPT="$(mktemp -t kola-worker).applescript"
cat > "$SCRIPT" <<APPLESCRIPT
on open location theURL
  startWorker()
end open location

on run
  startWorker()
end run

on startWorker()
  try
    -- [r] กันไม่ให้ pgrep เจอคำสั่งของตัวเอง · ห้ามตั้งชื่อตัวแปรว่า running (AppleScript จองไว้)
    set workerState to do shell script "pgrep -f 'web-template-worke[r]' >/dev/null && echo on || echo off"
    if workerState is "on" then
      display notification "worker เปิดอยู่แล้ว" with title "KOLA Worker"
      return
    end if
    -- เปิดเบื้องหลัง ไม่มีหน้าต่าง Terminal · ดูการทำงานบนหน้าแลก DO หรือไฟล์ log
    do shell script "export PATH=" & quoted form of "$NODE_DIR" & ":\$PATH; mkdir -p " & quoted form of "$LOG_DIR" & "; cd " & quoted form of "$V2" & " && nohup npm run worker:web >> " & quoted form of "$LOG_DIR/web-worker.log" & " 2>&1 < /dev/null &"
    display notification "กำลังเปิด worker — ดูสถานะที่หน้าแลก DO" with title "KOLA Worker"
  on error errMsg number errNum
    -- อย่าพังเงียบ ๆ — บอกให้เห็นว่าติดอะไร (เช่นยังไม่อนุญาตให้ควบคุม Terminal)
    display dialog "เปิด worker ไม่สำเร็จ: " & errMsg & " (" & errNum & ")" & return & return & "ดู log ได้ที่ $LOG_DIR/web-worker.log" buttons {"ตกลง"} default button 1 with title "KOLA Worker" with icon caution
  end try
end startWorker
APPLESCRIPT

mkdir -p "$HOME/Applications"
rm -rf "$APP"
osacompile -o "$APP" "$SCRIPT"
rm -f "$SCRIPT"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy \
  -c "Set :CFBundleIdentifier th.co.kola.worker-launcher" \
  -c "Add :CFBundleURLTypes array" \
  -c "Add :CFBundleURLTypes:0 dict" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLName string KOLA Worker" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string kola-worker" \
  "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string th.co.kola.worker-launcher" "$PLIST"

# แก้ Info.plist แล้วลายเซ็นเดิมใช้ไม่ได้ ต้องเซ็นใหม่ ไม่งั้น macOS ไม่ยอมเปิด
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "✅ ติดตั้งแล้ว: $APP"
echo "   ปุ่ม 'เปิด worker' ที่หน้าจัดการแลก DO จะเปิด npm run worker:web ใน $V2 แบบไม่มีหน้าต่าง"
echo "   log: $LOG_DIR/web-worker.log"
echo "   ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด"
