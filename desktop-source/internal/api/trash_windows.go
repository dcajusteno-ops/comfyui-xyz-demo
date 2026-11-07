//go:build windows

// trash_windows.go —— 把图片移入 Windows 回收站（无 cgo）。
//
// 两个必须踩准的点：
//  1. SHFILEOPSTRUCTW 在 amd64 上是 56 字节，字段顺序/对齐错一位就是把垃圾指针当字符串，
//     进程会直接崩（不是返回错误）。布局由 trash_windows_test.go 逐字段断言。
//  2. pFrom 是「每个路径一个 \0，末尾再来一个 \0」，少补最后一个只会删掉第一个文件。
package api

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"
)

const (
	foDelete          = 0x0003
	fofSilent         = 0x0004
	fofNoConfirmation = 0x0010
	fofAllowUndo      = 0x0040
	fofNoErrorUI      = 0x0400

	coinitApartmentThreaded = 0x2
	coinitDisableOLE1DDE    = 0x4
	rpcChangedMode          = 0x80010106

	driveFixed = 3

	// SHFileOperation 的路径列表总长有 64KB 上限，按 30KB 分块留足余量
	imageOpChunkBytes = 30 * 1024
)

// shFileOpStruct 对应 C 的 SHFILEOPSTRUCTW（amd64 = 56 字节）。
type shFileOpStruct struct {
	hwnd      uintptr // 0
	wFunc     uint32  // 8
	pFrom     *uint16 // 16（wFunc 后补 4 字节）
	pTo       *uint16 // 24
	fFlags    uint16  // 32
	aborted   int32   // 36（fFlags 后补 2 字节）
	hNameMaps uintptr // 40
	progress  *uint16 // 48
}

var (
	modshell32           = syscall.NewLazyDLL("shell32.dll")
	procSHFileOperationW = modshell32.NewProc("SHFileOperationW")
	modkernel32          = syscall.NewLazyDLL("kernel32.dll")
	procGetDriveTypeW    = modkernel32.NewProc("GetDriveTypeW")
	modole32             = syscall.NewLazyDLL("ole32.dll")
	procCoInitializeEx   = modole32.NewProc("CoInitializeEx")
	procCoUninitialize   = modole32.NewProc("CoUninitialize")
)

// MoveToRecycleBin 把一批绝对路径移入回收站；返回逐条失败清单。
// 不返回删除成功清单：调用方用「请求里去掉失败项」得到结果，避免两边口径漂移。
func MoveToRecycleBin(paths []string) []FailedFile {
	failed := make([]FailedFile, 0)
	ready := make([]string, 0, len(paths))
	for _, path := range paths {
		if reason := untrashableReason(path); reason != "" {
			failed = append(failed, FailedFile{Path: path, Error: reason})
			continue
		}
		ready = append(ready, path)
	}

	for _, chunk := range chunkImagePaths(ready) {
		if err := shellDelete(chunk); err != nil {
			for _, path := range chunk {
				failed = append(failed, FailedFile{Path: path, Error: err.Error()})
			}
			continue
		}
		// SHFileOperation 只返回「第一个错误码」，不能拿 0 当整批成功：逐条复验。
		for _, path := range chunk {
			if _, err := os.Lstat(path); err == nil {
				failed = append(failed, FailedFile{Path: path, Error: "回收站操作未生效（文件仍存在，可能被占用）"})
			}
		}
	}
	return failed
}

// untrashableReason 拦住「Shell 会静默永久删除」的场景——产品承诺是回收站，不能降级。
func untrashableReason(path string) string {
	if !filepath.IsAbs(path) {
		return "必须是绝对路径"
	}
	if strings.HasPrefix(path, `\\?\`) {
		return `不支持长路径前缀（\\?\）`
	}
	if strings.HasPrefix(path, `\\`) {
		return "不支持网络路径（回收站不可用）"
	}
	if len(path) >= 260 {
		return "路径过长，无法移入回收站"
	}
	volume := filepath.VolumeName(path)
	if volume == "" {
		return "无法确定所在磁盘"
	}
	ptr, err := syscall.UTF16PtrFromString(volume + `\`)
	if err != nil {
		return "路径无效"
	}
	kind, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(ptr)))
	if kind != driveFixed {
		return "该磁盘不支持回收站（仅本地固定磁盘可用）"
	}
	return ""
}

func chunkImagePaths(paths []string) [][]string {
	chunks := make([][]string, 0, 1)
	current := make([]string, 0, len(paths))
	size := 0
	for _, path := range paths {
		// len(path) 是 UTF-8 字节数，按 2 倍估算 UTF-16 字节数只会高估，安全
		cost := len(path)*2 + 2
		if len(current) > 0 && size+cost > imageOpChunkBytes {
			chunks = append(chunks, current)
			current = make([]string, 0, len(paths))
			size = 0
		}
		current = append(current, path)
		size += cost
	}
	if len(current) > 0 {
		chunks = append(chunks, current)
	}
	return chunks
}

func shellDelete(paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	// SHFileOperation 要求 STA；handler 跑在任意 goroutine 上，必须锁线程
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInitializeEx.Call(0, uintptr(coinitApartmentThreaded|coinitDisableOLE1DDE))
	code := uint32(hr)
	initialized := code == 0 || code == 1 // S_OK / S_FALSE
	if !initialized && code != rpcChangedMode {
		return fmt.Errorf("COM 初始化失败（0x%08X）", code)
	}
	if initialized {
		// defer 是 LIFO：CoUninitialize 一定先于 UnlockOSThread
		defer procCoUninitialize.Call()
	}

	buf := make([]uint16, 0, 260)
	for _, path := range paths {
		encoded, err := syscall.UTF16FromString(path)
		if err != nil {
			return err
		}
		buf = append(buf, encoded...) // 每个路径自带一个 NUL
	}
	buf = append(buf, 0) // 列表结束的第二个 NUL

	op := shFileOpStruct{
		wFunc:  foDelete,
		pFrom:  &buf[0],
		fFlags: fofAllowUndo | fofNoConfirmation | fofSilent | fofNoErrorUI,
	}
	ret, _, _ := procSHFileOperationW.Call(uintptr(unsafe.Pointer(&op)))
	if ret != 0 {
		return fmt.Errorf("SHFileOperation 失败（code %d）", ret)
	}
	if op.aborted != 0 {
		return fmt.Errorf("回收站操作被中止")
	}
	return nil
}
