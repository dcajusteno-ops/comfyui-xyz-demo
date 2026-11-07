//go:build windows

package api

import (
	"os"
	"path/filepath"
	"testing"
	"unsafe"
)

// 结构体一旦错位，SHFileOperation 会把垃圾指针当路径，进程直接崩（不是返回错误）。
// 这条断言不改业务逻辑，但能挡住「改字段顺序/类型」这种致命手滑。
func TestTrashStructLayout(t *testing.T) {
	var op shFileOpStruct
	if got := unsafe.Sizeof(op); got != 56 {
		t.Fatalf("SHFILEOPSTRUCTW 应为 56 字节，实际 %d", got)
	}
	checks := []struct {
		name string
		got  uintptr
		want uintptr
	}{
		{"hwnd", unsafe.Offsetof(op.hwnd), 0},
		{"wFunc", unsafe.Offsetof(op.wFunc), 8},
		{"pFrom", unsafe.Offsetof(op.pFrom), 16},
		{"pTo", unsafe.Offsetof(op.pTo), 24},
		{"fFlags", unsafe.Offsetof(op.fFlags), 32},
		{"aborted", unsafe.Offsetof(op.aborted), 36},
		{"hNameMaps", unsafe.Offsetof(op.hNameMaps), 40},
		{"progress", unsafe.Offsetof(op.progress), 48},
	}
	for _, check := range checks {
		if check.got != check.want {
			t.Fatalf("%s 偏移应为 %d，实际 %d", check.name, check.want, check.got)
		}
	}
}

// 真机会把测试文件丢进用户回收站，默认跳过；手工验收用 XYZ_TRASH_TEST=1 go test -run TestTrashWindows。
func TestTrashWindows_MovesToRecycleBin(t *testing.T) {
	if os.Getenv("XYZ_TRASH_TEST") != "1" {
		t.Skip("设置 XYZ_TRASH_TEST=1 才跑（会往用户回收站放一个临时文件）")
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "xyz-trash-test.png")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if failed := MoveToRecycleBin([]string{file}); len(failed) != 0 {
		t.Fatalf("应进回收站: %v", failed)
	}
	if _, err := os.Stat(file); err == nil {
		t.Fatalf("文件仍存在，回收站调用未生效")
	}
}

func TestTrashRejectsUnsafePaths(t *testing.T) {
	failed := MoveToRecycleBin([]string{
		`relative\a.png`,
		`\\server\share\a.png`,
		`\\?\F:\very\long\a.png`,
	})
	if len(failed) != 3 {
		t.Fatalf("三条都应被拒: %v", failed)
	}
	for _, item := range failed {
		if item.Error == "" {
			t.Fatalf("应带拒绝原因: %v", item)
		}
	}
}
