@echo off
rem ดับเบิลคลิกไฟล์นี้เพื่อติดตั้งตัวเปิด worker (เรียก windows-worker-launcher.ps1)
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-worker-launcher.ps1"
pause
