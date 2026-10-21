<# : batch portion - PowerShell script below (double-click to run)
@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8))"
echo.
pause
exit /b
#>
# ติดตั้ง ERP-KOLA บน Windows ในคลิกเดียว — ให้เครื่องนี้กดเลข Ref No. เปิดใบขนใน NETBAY ได้ (และทำ Draft ใบขนได้)
#
# ดาวน์โหลดจาก ERP-KOLA (ต้องล็อกอิน) แท็บ Draft ใบขน → "ติดตั้งตัวเปิด" แล้วดับเบิลคลิก (รันซ้ำได้ = อัปเดต)
# ไฟล์ที่ดาวน์โหลดผ่าน ERP มี WORKER_API_KEY ฝังมาให้แล้ว — อย่าส่งต่อไฟล์นี้ให้คนนอก
#   1. ตรวจว่าเปิด NETBAY (192.168.1.123) ได้
#   2. ติดตั้ง Git / Node.js LTS / Google Chrome ด้วย winget ถ้ายังไม่มี
#   3. ดึงโค้ด ERP-KOLA ไว้ที่ %USERPROFILE%\ERP-KOLA (มีแล้ว = git pull)
#   4. npm install
#   5. ใส่ WORKER_API_KEY และขอบัญชี NETBAY ประจำเครื่องจาก ERP (เครื่องละบัญชี กัน login ชนกันแล้วหลุด) ลง v2\.env.local
#   6. ลงทะเบียนลิงก์ kola-worker:// และ kola-netbay:// (scripts\install\windows-worker-launcher.ps1)
# ไม่ต้องใช้สิทธิ์ Administrator ยกเว้นตอนติดตั้ง Node.js / Git ครั้งแรก (Windows จะถาม)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$repo = 'https://github.com/7GHz-Dev/ERP-KOLA.git'
$root = Join-Path $env:USERPROFILE 'ERP-KOLA'
$v2 = Join-Path $root 'v2'
$netbayUrl = 'http://192.168.1.123/kola/spn'
# ERP ใส่คีย์ตรงนี้ตอนดาวน์โหลด (/api/install/windows) — ไฟล์ใน git / ลิงก์สาธารณะยังเป็นข้อความแทนที่อยู่
$embeddedKey = '__KOLA_WORKER_API_KEY__'

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  # โปรแกรมที่เพิ่งติดตั้งเพิ่ม PATH ในระบบแล้ว แต่หน้าต่างนี้ยังใช้ PATH เก่า
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Run {
  # โปรแกรมภายนอก (git, npm, winget) เขียนความคืบหน้าออก stderr — อย่าให้ PowerShell ถือเป็น error ดูผลจาก exit code แทน
  # | Out-Host = แสดงบนจอ ไม่ปนกับค่าที่ฟังก์ชันคืน (คืนแค่ exit code)
  # ห้ามประกาศพารามิเตอร์ (เช่น $exe) — PowerShell จะจับ -e / -C ของคำสั่งไปเป็นชื่อพารามิเตอร์นั้น
  # (winget ... -e --silent เคยกลายเป็นสั่งรันโปรแกรมชื่อ --silent) · รับทุกอย่างผ่าน $args แทน
  $ErrorActionPreference = 'Continue'
  $exe, $rest = $args
  & $exe @rest | Out-Host
  return $LASTEXITCODE
}
function Install-App($id, $name) {
  if (-not (Have 'winget')) { throw "ไม่พบ winget — ติดตั้ง $name เองแล้วดับเบิลคลิกไฟล์นี้ใหม่" }
  Write-Host "กำลังติดตั้ง $name ... (ถ้ามีหน้าต่างขอสิทธิ์ ให้กด Yes)"
  Run winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Null   # ติดตั้งไม่ได้ ตรวจด้วย Have ด้านล่าง
  Refresh-Path
}
function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

try {
  Write-Host 'ติดตั้ง ERP-KOLA สำหรับเปิดใบขน NETBAY / สร้าง Draft ใบขน' -ForegroundColor Green

  Step '1/6 ตรวจว่าเปิด NETBAY ได้'
  try {
    Invoke-WebRequest "$netbayUrl/" -UseBasicParsing -TimeoutSec 8 | Out-Null
    Write-Host 'เปิด NETBAY ได้' -ForegroundColor Green
  } catch {
    Write-Host "⚠️  เปิด $netbayUrl ไม่ได้ — เครื่องต้องอยู่ในเครือข่ายออฟฟิศถึงจะเปิดใบขนได้ (ติดตั้งต่อได้)" -ForegroundColor Yellow
  }

  Step '2/6 โปรแกรมที่ต้องมี (Git, Node.js, Google Chrome)'
  if (-not (Have 'git')) { Install-App 'Git.Git' 'Git' }
  if (-not (Have 'node')) { Install-App 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
              "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
              "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ }
  if (-not $chrome) { Install-App 'Google.Chrome' 'Google Chrome' }
  foreach ($c in 'git', 'node', 'npm') {
    if (-not (Have $c)) { throw "ยังไม่มี $c — ปิดหน้าต่างนี้แล้วดับเบิลคลิกไฟล์ติดตั้งอีกครั้ง" }
  }
  Write-Host "$(git --version) · node $(node --version)" -ForegroundColor Green

  Step "3/6 โค้ด ERP-KOLA ($root)"
  $code = if (Test-Path (Join-Path $root '.git')) { Run git -C $root pull --ff-only } else { Run git clone $repo $root }
  if ($code) { throw 'ดึงโค้ด ERP-KOLA ไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วลองใหม่' }

  Step '4/6 ติดตั้งแพ็กเกจ (npm install — ครั้งแรกใช้เวลาสักครู่)'
  Push-Location $v2
  try { $code = Run npm install --no-audit --no-fund } finally { Pop-Location }
  if ($code) { throw 'npm install ไม่สำเร็จ' }

  Step '5/6 ตั้งค่า (v2\.env.local) และบัญชี NETBAY ของเครื่องนี้'
  $envFile = Join-Path $v2 '.env.local'
  $lines = @(if (Test-Path $envFile) { [IO.File]::ReadAllLines($envFile) })
  $current = @{}
  foreach ($l in $lines) { if ($l -match '^([A-Z_]+)=(.*)$') { $current[$Matches[1]] = $Matches[2] } }
  $set = @{}
  if ($embeddedKey -notlike '__KOLA*') {
    $set['WORKER_API_KEY'] = $embeddedKey
  } elseif (-not $current['WORKER_API_KEY']) {
    # ไฟล์จากลิงก์สาธารณะไม่มีคีย์ฝังมา — ดาวน์โหลดใหม่จาก ERP (ล็อกอินแล้ว) จะไม่ต้องกรอก
    do { $key = (Read-Secret 'WORKER_API_KEY (หรือปิดแล้วดาวน์โหลดไฟล์ติดตั้งจากหน้า ERP แทน)').Trim() } until ($key)
    $set['WORKER_API_KEY'] = $key
  }
  if (-not $current['NETBAY_URL']) { $set['NETBAY_URL'] = $netbayUrl }
  # เขียนทับเฉพาะค่าที่ตั้งใหม่ บรรทัดอื่นคงไว้ · UTF-8 ไม่มี BOM (Node อ่านชื่อตัวแปรแรกเพี้ยนถ้ามี BOM)
  $out = @($lines | Where-Object { -not ($_ -match '^([A-Z_]+)=' -and $set.ContainsKey($Matches[1])) })
  foreach ($k in $set.Keys) { $out += "$k=$($set[$k])" }
  [IO.File]::WriteAllText($envFile, (($out -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
  # บัญชี NETBAY ประจำเครื่อง (erpkola1, erpkola2, …) — ERP จองให้ เครื่องเดิมได้บัญชีเดิม
  Push-Location $v2
  try { $code = Run npm run --silent netbay:account } finally { Pop-Location }
  if ($code) { throw 'ขอบัญชี NETBAY จาก ERP ไม่สำเร็จ — ดูข้อความด้านบน' }
  Write-Host "บันทึกแล้ว: $envFile" -ForegroundColor Green

  Step '6/6 ลงทะเบียนลิงก์ (ปุ่มเปิด worker · เลข Ref No.)'
  & (Join-Path $v2 'scripts\install\windows-worker-launcher.ps1')

  Write-Host ''
  Write-Host '✅ ติดตั้งเสร็จ' -ForegroundColor Green
  Write-Host '   เปิด ERP -> กดเลข Ref No. -> เบราว์เซอร์ถามว่าจะเปิด KOLA Worker ไหม -> ติ๊ก "อนุญาตเสมอ" แล้วกดเปิด'
  Write-Host '   สร้าง Draft: กด "สร้าง Draft" ที่ งานคงค้าง -> 3. Draft ใบขน แล้วเครื่องนี้จะเปิด NETBAY ทำให้เอง'
  Write-Host "   log: $env:LOCALAPPDATA\KOLA\   ·   อัปเดตภายหลัง: ดับเบิลคลิกไฟล์นี้อีกครั้ง"
} catch {
  Write-Host ''
  Write-Host "❌ ติดตั้งไม่สำเร็จ: $($_.Exception.Message)" -ForegroundColor Red
}
