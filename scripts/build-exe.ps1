# 构建 Go 版单文件 exe（任务书-Go单文件exe.md §3.4）
# 用法：在仓库根目录执行  powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1
# 前置：Node.js（vite build）与 Go >= 1.22
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "[1/3] vite build（生成 dist/）..." -ForegroundColor Cyan
node node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) { throw "vite build 失败" }

Write-Host "[2/3] go build（内嵌 dist，产出单文件 exe；-H=windowsgui 隐藏控制台窗口）..." -ForegroundColor Cyan
$exe = "ComfyUI-XYZ-Web.exe"
# 图标：scripts/appicon.ico → rsrc_windows_amd64.syso（图标改过则重编；syso 变更后 go build 自动链接）
$ico = "scripts/appicon.ico"
$syso = "rsrc_windows_amd64.syso"
if (-not (Test-Path $syso) -or (Get-Item $ico).LastWriteTime -gt (Get-Item $syso).LastWriteTime) {
  Write-Host "  重新编译图标资源（rsrc）..." -ForegroundColor DarkCyan
  $env:GOPROXY = "https://goproxy.cn,direct"
  go run github.com/akavel/rsrc@latest -ico $ico -o $syso
  if ($LASTEXITCODE -ne 0) { throw "rsrc 图标资源编译失败" }
}
go build -trimpath -ldflags "-s -w -H windowsgui" -o $exe .
if ($LASTEXITCODE -ne 0) { throw "go build 失败" }

Write-Host "[3/3] 完成：" -ForegroundColor Green
$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "  $exe ($size MB) —— 双击运行：独立桌面窗口（WebView2）；加 --web 参数则用系统浏览器打开"
