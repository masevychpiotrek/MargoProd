@echo off
title Synchronizacja zdjec statystyk zmianowych - MargoLine
color 0B
echo ============================================================
echo   MargoLine - synchronizacja zdjec statystyk zmianowych
echo ============================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-shift-photos.ps1"
echo.
echo ============================================================
echo   Gotowe. Nacisnij dowolny klawisz, zeby zamknac to okno.
echo ============================================================
pause >nul
