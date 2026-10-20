#!/bin/bash
#
# ติดตั้งตัวเปิด worker บน Mac — ให้ปุ่ม "เปิด worker" บนหน้าเว็บ และลิงก์ Ref No. ใช้ได้
#
# สร้างแอป ~/Applications/KOLA Worker.app ที่รับลิงก์
#   kola-worker://start        หน้าจัดการแลก DO  -> npm run worker:web    (log: ~/Library/Logs/KOLA/web-worker.log)
#   kola-worker://draft        แท็บ Draft ใบขน     -> npm run worker:draft  (log: ~/Library/Logs/KOLA/draft-worker.log)
#   kola-netbay://open?ref=…   เลข Ref No.        -> npm run netbay:open   เปิดใบขนนั้นใน NETBAY (log: netbay-open.log)
# รันในโฟลเดอร์ v2 นี้แบบไม่มีหน้าต่าง Terminal · ถ้า worker ตัวนั้นเปิดอยู่แล้วจะไม่เปิดซ้ำ
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
grep -q '^NETBAY_PASSWORD=.' "$V2/.env.local" 2>/dev/null || echo "⚠️  ยังไม่มี NETBAY_USER / NETBAY_PASSWORD ใน $V2/.env.local — worker สร้าง Draft และลิงก์ Ref No. จะเข้า NETBAY ไม่ได้"

SCRIPT="$(mktemp -t kola-worker).applescript"
cat > "$SCRIPT" <<APPLESCRIPT
on open location theURL
  if theURL starts with "kola-netbay:" then
    openRef(theURL)
  else if theURL contains "draft" then
    startWorker("worker:draft", "draft-worke[r]", "draft-worker.log", "worker สร้าง Draft ใบขน")
  else
    startWorker("worker:web", "web-template-worke[r]", "web-worker.log", "worker แลก DO")
  end if
end open location

on run
  startWorker("worker:web", "web-template-worke[r]", "web-worker.log", "worker แลก DO")
end run

on startWorker(npmScript, pattern, logName, label)
  try
    -- [r] ในรูปแบบกันไม่ให้ pgrep เจอคำสั่งของตัวเอง · ห้ามตั้งชื่อตัวแปรว่า running (AppleScript จองไว้)
    set workerState to do shell script "pgrep -f '" & pattern & "' >/dev/null && echo on || echo off"
    if workerState is "on" then
      display notification label & " เปิดอยู่แล้ว" with title "KOLA Worker"
      return
    end if
    -- เปิดเบื้องหลัง ไม่มีหน้าต่าง Terminal · ดูการทำงานบนหน้าเว็บหรือไฟล์ log
    do shell script "export PATH=" & quoted form of "$NODE_DIR" & ":\$PATH; mkdir -p " & quoted form of "$LOG_DIR" & "; cd " & quoted form of "$V2" & " && nohup npm run " & npmScript & " >> " & quoted form of ("$LOG_DIR/" & logName) & " 2>&1 < /dev/null &"
    display notification "กำลังเปิด " & label & " — ดูสถานะบนหน้าเว็บ" with title "KOLA Worker"
  on error errMsg number errNum
    -- อย่าพังเงียบ ๆ — บอกให้เห็นว่าติดอะไร (เช่นยังไม่อนุญาตให้ควบคุม Terminal)
    display dialog "เปิด " & label & " ไม่สำเร็จ: " & errMsg & " (" & errNum & ")" & return & return & "ดู log ได้ที่ $LOG_DIR/" & logName buttons {"ตกลง"} default button 1 with title "KOLA Worker" with icon caution
  end try
end startWorker

-- ลิงก์ Ref No. บน ERP: เปิด Chrome -> login NETBAY -> ค้นหา Ref No. -> เปิดใบขน
on openRef(theURL)
  try
    do shell script "export PATH=" & quoted form of "$NODE_DIR" & ":\$PATH; mkdir -p " & quoted form of "$LOG_DIR" & "; cd " & quoted form of "$V2" & " && nohup npm run netbay:open -- " & quoted form of theURL & " >> " & quoted form of "$LOG_DIR/netbay-open.log" & " 2>&1 < /dev/null &"
  on error errMsg number errNum
    display dialog "เปิดใบขนไม่สำเร็จ: " & errMsg & " (" & errNum & ")" & return & return & "ดู log ได้ที่ $LOG_DIR/netbay-open.log" buttons {"ตกลง"} default button 1 with title "KOLA Worker" with icon caution
  end try
end openRef
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
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:1 string kola-netbay" \
  "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string th.co.kola.worker-launcher" "$PLIST"

# แก้ Info.plist แล้วลายเซ็นเดิมใช้ไม่ได้ ต้องเซ็นใหม่ ไม่งั้น macOS ไม่ยอมเปิด
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "✅ ติดตั้งแล้ว: $APP"
echo "   ปุ่ม 'เปิด worker' ที่หน้าแลก DO -> npm run worker:web · ที่แท็บ Draft ใบขน -> npm run worker:draft"
echo "   เลข Ref No. บนเว็บ -> เปิดใบขนใน NETBAY (npm run netbay:open) · รันใน $V2 แบบไม่มีหน้าต่าง"
echo "   log: $LOG_DIR/"
echo "   ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด"
