# WorkBuddy Proxy 管理面板 - 启动器
# 双击运行: 在本机启动本地 Web 面板 (默认 http://127.0.0.1:8500) 并自动打开浏览器。
# 面板等价于在 PowerShell 里手动跑 codex\proxy.ps1 / zcode\proxy.ps1, 但多了图形按钮与状态/日志。

$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Dir

# 自动定位 node (需要 Node.js >= 18 且已加入 PATH)
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "[gui] 未找到 node.exe。请先安装 Node.js >= 18 并确保 node 在 PATH 中。" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}

Write-Host "[gui] 启动管理面板, 监听 http://127.0.0.1:8500 (Ctrl+C 退出)" -ForegroundColor Cyan
try {
  & $node gui.mjs
} finally {
  Read-Host "面板已退出, 按回车关闭窗口"
}
