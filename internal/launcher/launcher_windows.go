//go:build windows

package launcher

import (
	"syscall"
)

// hideWindow 对齐 Node spawn 的 windowsHide: true——Node 的实现是 CREATE_NO_WINDOW
// （只抑制子进程的**控制台**窗口），不会给 GUI 程序的第一个窗口传 SW_HIDE。
// 注意：不能用 SysProcAttr.HideWindow——那会设 STARTF_USESHOWWINDOW+SW_HIDE，
// 把被启动 GUI 程序的主窗口一起隐藏（进程活着但窗口不出来，实机踩过）。
const (
	createNoWindow   = 0x08000000
	detachedProcess  = 0x00000008
)

func hideWindow() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: createNoWindow | detachedProcess}
}
