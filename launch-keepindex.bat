@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where docker.exe >nul 2>&1
if errorlevel 1 (
  echo [keepindex] Docker Desktop is required.
  exit /b 127
)
docker.exe compose version >nul 2>&1
if errorlevel 1 (
  echo [keepindex] The Docker Compose plugin is required.
  exit /b 127
)
docker.exe info >nul 2>&1
if errorlevel 1 (
  echo [keepindex] Start Docker Desktop, then run this launcher again.
  exit /b 1
)

if not defined KEEPINDEX_PORT set "KEEPINDEX_PORT=5173"
if defined KEEPINDEX_URL (
  set "KEEPINDEX_APP_URL=%KEEPINDEX_URL%"
) else (
  set "KEEPINDEX_APP_URL=http://localhost:%KEEPINDEX_PORT%"
)

echo [keepindex] Search your world. Keep it yours.
echo [keepindex] Bootstrapping the private local stack...
start "KeepIndex" /D "%~dp0" cmd.exe /k "docker.exe compose up --build --remove-orphans"

echo [keepindex] Waiting for %KEEPINDEX_APP_URL% ...
for /L %%I in (1,1,180) do (
  curl.exe --connect-timeout 1 --max-time 4 -fsS "%KEEPINDEX_APP_URL%/api/health" >nul 2>&1 && goto :ready
  timeout /t 1 /nobreak >nul
)
echo [keepindex] KeepIndex did not become ready. Check the KeepIndex container window.
exit /b 1

:ready
start "" "%KEEPINDEX_APP_URL%"
echo [keepindex] Opened %KEEPINDEX_APP_URL%
endlocal
