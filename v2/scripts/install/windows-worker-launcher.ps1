# ติดตั้งตัวเปิด worker กรอกเว็บบน Windows — ให้ปุ่ม "เปิด worker" ที่หน้าจัดการแลก DO ใช้ได้
#
# ลงทะเบียนลิงก์ kola-worker:// ให้ผู้ใช้คนนี้ (ไม่ต้องใช้สิทธิ์ Administrator)
# กดปุ่มบนเว็บแล้วจะเปิดหน้าต่าง cmd รัน npm run worker:web ในโฟลเดอร์ v2 นี้
# ถ้า worker เปิดอยู่แล้วจะไม่เปิดซ้ำ (โปรไฟล์ Chrome เปิดได้ทีละตัว)
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
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*web-template-worker*' }
if ($running) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('worker เปิดอยู่แล้ว', 'KOLA Worker') | Out-Null
  exit
}
Start-Process cmd.exe -ArgumentList '/k', 'chcp 65001 >nul && title KOLA worker && cd /d "__V2__" && npm run worker:web'
'@
$body.Replace('__V2__', $v2) | Set-Content -Encoding UTF8 -Path $launcher

$key = 'HKCU:\Software\Classes\kola-worker'
New-Item -Force -Path $key | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:KOLA Worker'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
New-Item -Force -Path "$key\shell\open\command" | Out-Null
Set-ItemProperty -Path "$key\shell\open\command" -Name '(Default)' `
  -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" `"%1`""

Write-Host "ติดตั้งแล้ว — ปุ่ม 'เปิด worker' ที่หน้าจัดการแลก DO จะเปิด npm run worker:web ใน $v2" -ForegroundColor Green
Write-Host 'ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด'
