#!/bin/bash
#
# ติดตั้งตัวเปิด worker กรอกเว็บบน Mac — ให้ปุ่ม "เปิด worker" ที่หน้าจัดการแลก DO ใช้ได้
#
# สร้างแอป ~/Applications/KOLA Worker.app ที่รับลิงก์ kola-worker://start
# กดปุ่มบนเว็บแล้วแอปนี้เปิด Terminal รัน npm run worker:web ในโฟลเดอร์ v2 นี้
# ถ้า worker เปิดอยู่แล้วจะไม่เปิดซ้ำ (โปรไฟล์ Chrome เปิดได้ทีละตัว)
#
# วิธีใช้ (ในโฟลเดอร์ v2):  bash scripts/install/mac-worker-launcher.sh
# ย้ายโฟลเดอร์โค้ดไปที่อื่นแล้วต้องรันใหม่ เพราะแอปจำที่อยู่โฟลเดอร์ไว้
set -euo pipefail

V2="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$HOME/Applications/KOLA Worker.app"

command -v npm >/dev/null || { echo "ไม่พบ npm — ติดตั้ง Node.js ก่อน"; exit 1; }
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
  -- [r] กันไม่ให้ pgrep เจอคำสั่งของตัวเอง
  set running to do shell script "pgrep -f 'web-template-worke[r]' >/dev/null && echo yes || echo no"
  if running is "yes" then
    display notification "worker เปิดอยู่แล้ว" with title "KOLA Worker"
    return
  end if
  tell application "Terminal"
    activate
    do script "cd " & quoted form of "$V2" & " && npm run worker:web"
  end tell
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
echo "   ปุ่ม 'เปิด worker' ที่หน้าจัดการแลก DO จะเปิด npm run worker:web ใน $V2"
echo "   ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด"
