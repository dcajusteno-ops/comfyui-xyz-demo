@echo off
rem 启动 Go 版单文件 exe（构建方式见 scripts\build-exe.ps1 或 README）
rem 桌面窗口模式固定用 9123 端口（与 dev 的 9999 互不干扰，界面状态不会丢）。
rem 可选参数 [端口] 仅对 --web 浏览器模式生效：run-exe.bat 10000 --web
rem 旧的开发模式菜单仍可用：运行 run-dev.bat（即原 run.bat）
cd /d "%~dp0"
if not exist "ComfyUI-XYZ-Web.exe" (
  echo [提示] 未找到 ComfyUI-XYZ-Web.exe，请先执行：
  echo   powershell -ExecutionPolicy Bypass -File desktop-source\scripts\build-exe.ps1
  echo （需要 Node.js 与 Go ^>= 1.22）
  pause
  exit /b 1
)
if not "%~1"=="" set "PORT=%~1"
echo 正在启动 ComfyUI-XYZ-Web（独立桌面窗口，关窗即退出）...
ComfyUI-XYZ-Web.exe
