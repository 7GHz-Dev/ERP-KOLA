# ติดตั้งตัวเปิด worker บน Windows — ให้ปุ่ม "เปิด worker" บนหน้าเว็บ และลิงก์ Ref No. ใช้ได้
#
# ลงทะเบียนลิงก์ให้ผู้ใช้คนนี้ (ไม่ต้องใช้สิทธิ์ Administrator)
#   kola-worker://start        หน้าจัดการแลก DO  -> npm run worker:web
#   kola-worker://draft        แท็บ Draft ใบขน     -> npm run worker:draft
#   kola-worker://draft?task=… ปุ่ม "สร้าง Draft"  -> npm run worker:draft -- --task … (ทำงานนั้นบนเครื่องนี้)
#   kola-netbay://open?ref=…   เลข Ref No.        -> npm run netbay:open (เปิดใบขนนั้นใน NETBAY)
# รันในโฟลเดอร์ v2 นี้แบบไม่มีหน้าต่าง · log อยู่ที่ %LOCALAPPDATA%\KOLA\ · worker ที่เปิดอยู่แล้วจะไม่เปิดซ้ำ
#
# วิธีใช้: ดับเบิลคลิก windows-worker-launcher.cmd ในโฟลเดอร์เดียวกันนี้
# ย้ายโฟลเดอร์โค้ดไปที่อื่นแล้วต้องรันใหม่ เพราะตัวเปิดจำที่อยู่โฟลเดอร์ไว้
$ErrorActionPreference = 'Stop'

$v2 = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host 'ไม่พบ npm — ติดตั้ง Node.js (https://nodejs.org) ก่อนแล้วรันใหม่' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $v2 'node_modules'))) {
  Write-Host 'ยังไม่ได้ npm install — กำลังติดตั้ง'
  Push-Location $v2; npm install; Pop-Location
}
$envFile = Join-Path $v2 '.env.local'
if (-not ((Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^WORKER_API_KEY=.' -Quiet))) {
  Write-Host "ยังไม่มี WORKER_API_KEY ใน $envFile — worker จะต่อ ERP ไม่ได้จนกว่าจะใส่" -ForegroundColor Yellow
}

# ตัวเปิดที่ลิงก์เรียก — เก็บไว้ในโฟลเดอร์ของผู้ใช้
$dir = Join-Path $env:LOCALAPPDATA 'KOLA'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$launcher = Join-Path $dir 'start-worker.ps1'
$body = @'
param([string]$url = '')
$logDir = Join-Path $env:LOCALAPPDATA 'KOLA'
function Show($msg) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($msg, 'KOLA Worker') | Out-Null
}
function Start-Npm($npmArgs, $logName) {
  $log = Join-Path $logDir $logName
  Start-Process cmd.exe -WindowStyle Hidden -ArgumentList '/c', ('chcp 65001 >nul && cd /d "__V2__" && npm run ' + $npmArgs + ' >> "' + $log + '" 2>&1')
}
function Start-Worker($npmScript, $pattern, $logName, $label) {
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$pattern*" }
  if ($running) { Show "$label เปิดอยู่แล้ว"; exit }
  Start-Npm $npmScript $logName
}
if ($url -like 'kola-netbay:*') {
  # ส่งต่อเฉพาะ Ref No. ที่เป็นตัวอักษร/ตัวเลข — URL มาจากเบราว์เซอร์ ห้ามต่อเป็นคำสั่งตรง ๆ
  if ($url -notmatch '[?&]ref=([A-Za-z0-9][A-Za-z0-9-]{3,39})(&|$)') { Show "ลิงก์ Ref No. ไม่ถูกต้อง: $url"; exit }
  Start-Npm ('netbay:open -- ' + $Matches[1]) 'netbay-open.log'
} elseif ($url -like '*draft*task=*') {
  # กด "สร้าง Draft" ที่เครื่องนี้ — ทำเฉพาะงานนั้นบนเครื่องนี้ (เลขงานตรวจรูปแบบก่อน ห้ามต่อ URL เป็นคำสั่งตรง ๆ)
  if ($url -notmatch '[?&]task=(TASK-[A-F0-9]{8,40})(&|$)') { Show "ลิงก์งาน Draft ไม่ถูกต้อง: $url"; exit }
  Start-Npm ('worker:draft -- --task ' + $Matches[1]) 'draft-worker.log'
} elseif ($url -like '*draft*') {
  Start-Worker 'worker:draft' 'draft-worker' 'draft-worker.log' 'worker สร้าง Draft ใบขน'
} else {
  Start-Worker 'worker:web' 'web-template-worker' 'web-worker.log' 'worker แลก DO'
}
'@
$body.Replace('__V2__', $v2) | Set-Content -Encoding UTF8 -Path $launcher

foreach ($scheme in @('kola-worker', 'kola-netbay')) {
  $key = "HKCU:\Software\Classes\$scheme"
  New-Item -Force -Path $key | Out-Null
  Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:KOLA Worker'
  Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
  New-Item -Force -Path "$key\shell\open\command" | Out-Null
  Set-ItemProperty -Path "$key\shell\open\command" -Name '(Default)' `
    -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" `"%1`""
}

if (-not (Select-String -Path $envFile -Pattern '^NETBAY_PASSWORD=.' -Quiet -ErrorAction SilentlyContinue)) {
  Write-Host "ยังไม่มี NETBAY_USER / NETBAY_PASSWORD ใน $envFile — worker สร้าง Draft และลิงก์ Ref No. จะเข้า NETBAY ไม่ได้" -ForegroundColor Yellow
}
Write-Host "ติดตั้งแล้ว — ปุ่ม 'เปิด worker' (แลก DO / Draft ใบขน) และเลข Ref No. บนเว็บ จะรันใน $v2 แบบไม่มีหน้าต่าง" -ForegroundColor Green
Write-Host "log: $dir\"
Write-Host 'ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด'
