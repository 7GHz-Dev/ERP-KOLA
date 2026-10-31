# ติดตั้งตัวเปิด worker บน Windows — ให้ปุ่ม "เปิด worker" บนหน้าเว็บ และลิงก์ Ref No. ใช้ได้
#
# ลงทะเบียนลิงก์ให้ผู้ใช้คนนี้ (ไม่ต้องใช้สิทธิ์ Administrator)
#   kola-worker://start        หน้าจัดการแลก DO  -> npm run worker:web
#   kola-worker://draft        แท็บ Draft ใบขน     -> npm run worker:draft
#   kola-worker://draft?task=… ปุ่ม "สร้าง Draft"  -> npm run worker:draft -- --task … (ทำงานนั้นบนเครื่องนี้)
#   kola-netbay://open?ref=…   เลข Ref No.        -> npm run netbay:open (เปิดใบขนนั้นใน NETBAY)
#   kola-worker://customs      ปุ่ม "สร้างใบขนแล้ว" / "Refresh" -> npm run worker:customs (ตัว monitor ใบขน จน ACCEPT ครบ)
#   kola-worker://update       ตอนเปิด Windows (Run key KOLA-Update) -> อัปเดตโค้ดอย่างเดียว
# รันในโฟลเดอร์ v2 นี้แบบไม่มีหน้าต่าง · log อยู่ที่ %LOCALAPPDATA%\KOLA\ · worker ที่เปิดอยู่แล้วจะไม่เปิดซ้ำ
#
# อัปเดตตัวเองเบื้องหลัง: ทุกครั้งที่ตัวเปิดถูกเรียก (รวมตอนเปิด Windows) ถาม ERP ว่าเวอร์ชันในเครื่อง
# (AGENT_VERSION ใน src\lib\agent-version.ts) ล่าสุดหรือยัง — เก่ากว่าก็ git pull · npm install (ถ้าแพ็กเกจเปลี่ยน)
# · ลงทะเบียนตัวเปิดใหม่ ให้เสร็จก่อนแล้วค่อยทำสิ่งที่ลิงก์สั่ง · log การอัปเดตที่ %LOCALAPPDATA%\KOLA\update.log
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
$v2 = '__V2__'
$root = Split-Path $v2 -Parent
$logDir = Join-Path $env:LOCALAPPDATA 'KOLA'
function Show($msg) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($msg, 'KOLA Worker') | Out-Null
}
function Start-Npm($npmArgs, $logName) {
  $log = Join-Path $logDir $logName
  Start-Process cmd.exe -WindowStyle Hidden -ArgumentList '/c', ('chcp 65001 >nul && cd /d "' + $v2 + '" && npm run ' + $npmArgs + ' >> "' + $log + '" 2>&1')
}
function Find-Worker($pattern) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$pattern*" }
}
function Start-Worker($npmScript, $pattern, $logName, $label, [switch]$Quiet) {
  if (Find-Worker $pattern) { if (-not $Quiet) { Show "$label เปิดอยู่แล้ว" }; exit }
  Start-Npm $npmScript $logName
}

# ---------- อัปเดตตัวเองเบื้องหลัง ----------
function Log-Update($msg) {
  Add-Content -Encoding UTF8 -Path (Join-Path $logDir 'update.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg)
}
function Env-Value($name) {
  $f = Join-Path $v2 '.env.local'
  if (-not (Test-Path $f)) { return '' }
  foreach ($line in [IO.File]::ReadAllLines($f)) { if ($line -match "^$name=(.*)$") { return $Matches[1].Trim() } }
  return ''
}
function Local-Version {
  $f = Join-Path $v2 'src\lib\agent-version.ts'
  if ((Test-Path $f) -and ([IO.File]::ReadAllText($f) -match "AGENT_VERSION = '([0-9.]+)'")) { return $Matches[1] }
  return '0'
}
# รายงานเวอร์ชันในเครื่องให้ ERP (หน้าติดตั้งแสดงว่าเครื่องไหนล่าสุดแล้ว) — คืน { latest, upToDate } หรือ $null ถ้าถามไม่ได้
function Check-Agent($status) {
  $key = Env-Value 'WORKER_API_KEY'
  if (-not $key) { return $null }
  $erp = Env-Value 'ERP_URL'
  if (-not $erp) { $erp = 'https://erp-kola.vercel.app' }
  $json = @{ key = $key; fn = 'agentCheck'; args = @{ machine = $env:COMPUTERNAME; version = (Local-Version); status = $status } } | ConvertTo-Json -Depth 4
  try {
    $r = Invoke-RestMethod -Method Post -Uri ($erp.TrimEnd('/') + '/api/worker') -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 5
    return $r.data
  } catch { return $null }
}
# คำสั่งภายนอก (git, npm) แบบไม่มีหน้าต่าง รอจนจบ · ผลต่อท้าย update.log · คืน exit code
function Run-Logged($cmdline) {
  $log = Join-Path $logDir 'update.log'
  $p = Start-Process cmd.exe -WindowStyle Hidden -Wait -PassThru -ArgumentList '/c', ('chcp 65001 >nul && ' + $cmdline + ' >> "' + $log + '" 2>&1')
  return $p.ExitCode
}
function Update-Agent {
  $check = Check-Agent ''
  if (-not $check -or $check.upToDate) { return $false }
  $lock = Join-Path $logDir 'update.lock'
  if ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalMinutes -lt 15) {
    # อีกตัว (เช่นตอนเปิด Windows) กำลังอัปเดตอยู่ — รอให้เสร็จก่อน ไม่เกิน 10 นาที แล้วใช้โค้ดใหม่
    for ($i = 0; $i -lt 300 -and (Test-Path $lock); $i++) { Start-Sleep -Seconds 2 }
    return $true
  }
  Set-Content -Path $lock -Value $PID
  try {
    Log-Update ('อัปเดต v' + (Local-Version) + ' -> v' + $check.latest)
    $pkg = Join-Path $v2 'package-lock.json'
    $before = (Get-FileHash $pkg).Hash
    if (Run-Logged ('git -C "' + $root + '" pull --ff-only')) {
      Log-Update 'git pull ไม่สำเร็จ (มีไฟล์ในเครื่องถูกแก้? ดูด้านบน)'
      Check-Agent 'อัปเดตไม่สำเร็จ: git pull' | Out-Null
      return $false
    }
    if (((Get-FileHash $pkg).Hash -ne $before) -or -not (Test-Path (Join-Path $v2 'node_modules'))) {
      if (Run-Logged ('cd /d "' + $v2 + '" && npm install --no-audit --no-fund')) {
        Log-Update 'npm install ไม่สำเร็จ'
        Check-Agent 'อัปเดตไม่สำเร็จ: npm install' | Out-Null
        return $false
      }
    }
    # ลงทะเบียนตัวเปิดใหม่ — ไฟล์นี้ถูกเขียนทับด้วยรุ่นใหม่ (รอบนี้ยังรันรุ่นที่โหลดไว้แล้วจนจบ)
    Run-Logged ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $v2 'scripts\install\windows-worker-launcher.ps1') + '"') | Out-Null
    Check-Agent '' | Out-Null
    Log-Update ('อัปเดตเสร็จ v' + (Local-Version))
    return $true
  } finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$updated = $false
try { $updated = Update-Agent } catch { Log-Update ('อัปเดตไม่สำเร็จ: ' + $_.Exception.Message) }

if ($url -like '*//update*') {
  exit                                       # ตอนเปิด Windows — อัปเดตอย่างเดียว
} elseif ($url -like 'kola-netbay:*') {
  # ส่งต่อเฉพาะ Ref No. ที่เป็นตัวอักษร/ตัวเลข — URL มาจากเบราว์เซอร์ ห้ามต่อเป็นคำสั่งตรง ๆ
  if ($url -notmatch '[?&]ref=([A-Za-z0-9][A-Za-z0-9-]{3,39})(&|$)') { Show "ลิงก์ Ref No. ไม่ถูกต้อง: $url"; exit }
  Start-Npm ('netbay:open -- ' + $Matches[1]) 'netbay-open.log'
} elseif ($url -like '*customs*') {
  # เพิ่งอัปเดต — ปิดตัว monitor รุ่นเก่าที่เปิดค้าง แล้วเปิดรุ่นใหม่แทน (ตัว monitor ไม่ถืองานค้าง รอบที่ตัดกลางทางเช็กใหม่ได้)
  if ($updated) { Find-Worker 'customs-monitor' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
  # กดสร้างใบขน/Refresh หลายครั้ง — เปิดอยู่แล้วไม่ต้องเตือน ตัวที่เปิดอยู่เห็นงานใหม่/คำขอ Refresh เองภายใน 10 วินาที
  Start-Worker 'worker:customs' 'customs-monitor' 'customs-monitor.log' 'ตัว monitor ใบขน' -Quiet
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

# ตอนเปิด Windows: เช็กเวอร์ชันแล้วอัปเดตเบื้องหลังให้เสร็จ (ไม่มีหน้าต่าง)
Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'KOLA-Update' `
  -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" `"kola-worker://update`""

if (-not (Select-String -Path $envFile -Pattern '^NETBAY_PASSWORD=.' -Quiet -ErrorAction SilentlyContinue)) {
  Write-Host "ยังไม่มี NETBAY_USER / NETBAY_PASSWORD ใน $envFile — worker สร้าง Draft และลิงก์ Ref No. จะเข้า NETBAY ไม่ได้" -ForegroundColor Yellow
}
$version = if ([IO.File]::ReadAllText((Join-Path $v2 'src\lib\agent-version.ts')) -match "AGENT_VERSION = '([0-9.]+)'") { $Matches[1] } else { '?' }
Write-Host "ติดตั้งแล้ว v$version — ปุ่ม 'เปิด worker' (แลก DO / Draft ใบขน) และเลข Ref No. บนเว็บ จะรันใน $v2 แบบไม่มีหน้าต่าง" -ForegroundColor Green
Write-Host 'อัปเดตเองเบื้องหลังตอนเปิด Windows และทุกครั้งที่กดปุ่ม/ลิงก์ (log: update.log)'
Write-Host "log: $dir\"
Write-Host 'ครั้งแรกเบราว์เซอร์จะถามว่าจะเปิด KOLA Worker ไหม — ติ๊กอนุญาตเสมอแล้วกดเปิด'

