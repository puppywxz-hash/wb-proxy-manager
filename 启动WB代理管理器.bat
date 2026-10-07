@echo off
REM WB代理管理器 - 双击启动(Electron 桌面版)
REM 需要: electron-app\node_modules 已安装(首次运行 npm install)
setlocal
cd /d "%~dp0electron-app"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
if not exist "node_modules\electron\dist\electron.exe" (
  echo [WB] 首次启动,正在安装 Electron(走国内镜像)…
  call npm install electron --registry=https://registry.npmmirror.com --electron_mirror=https://npmmirror.com/mirrors/electron/
)
start "" "node_modules\electron\dist\electron.exe" --no-sandbox .
