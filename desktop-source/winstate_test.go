package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 窗口尺寸记忆：恢复 / 钳制 / 容错（GUI 部分由实机确认，这里固化纯逻辑）
func TestLoadWindowSize(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "window-state.json")

	// 无文件 → 默认尺寸（且同样要过主屏钳制——小屏上默认值也可能被压）
	sw, sh := primaryScreenSize()
	defW, defH := minInt(winWidth, sw*95/100), minInt(winHeight, sh*92/100)
	w, h := loadWindowSize(file)
	if w != defW || h != defH {
		t.Fatalf("无记忆文件应返回钳制后的默认 %dx%d, got %dx%d", defW, defH, w, h)
	}

	// 合法记忆 → 原样恢复
	if err := os.WriteFile(file, []byte(`{"width":1400,"height":900}`), 0o644); err != nil {
		t.Fatal(err)
	}
	w, h = loadWindowSize(file)
	if w != 1400 || h != 900 {
		t.Fatalf("应恢复记忆的 1400x900, got %dx%d", w, h)
	}

	// 超大值 → 钳制到主屏以内（95% 宽 / 92% 高）
	if err := os.WriteFile(file, []byte(`{"width":99999,"height":99999}`), 0o644); err != nil {
		t.Fatal(err)
	}
	w, h = loadWindowSize(file)
	if w > sw*95/100 || h > sh*92/100 {
		t.Fatalf("应钳制到主屏 %dx%d 以内, got %dx%d", sw, sh, w, h)
	}

	// 损坏文件 → 钳制后的默认尺寸（不崩）
	if err := os.WriteFile(file, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	w, h = loadWindowSize(file)
	if w != defW || h != defH {
		t.Fatalf("损坏文件应回落钳制后的默认, got %dx%d", w, h)
	}

	// 过小值（异常数据）→ 钳制后的默认尺寸
	if err := os.WriteFile(file, []byte(`{"width":10,"height":10}`), 0o644); err != nil {
		t.Fatal(err)
	}
	w, h = loadWindowSize(file)
	if w != defW || h != defH {
		t.Fatalf("过小记忆应回落钳制后的默认, got %dx%d", w, h)
	}
}
