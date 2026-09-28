package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/winchrome"
)

/**
 * LoadPersistedAppearance 是「开窗前着色」的唯一数据来源：main.go 在 newWindow 之前调它，
 * 把上次落盘的外观读出来先施加一遍（窗口在 go-webview2 的 NewWithOptions 内部就已 ShowWindow，
 * 之后再改色会先亮一帧系统默认色）。所以它的读取与兜底行为值得固化。
 */
func TestLoadPersistedAppearance(t *testing.T) {
	cases := []struct {
		name     string
		contents string
		want     string
	}{
		{
			name: "有专门的外观键时以它为准",
			contents: `{"revision":7,"data":{"comfyui_xyz_window_appearance":{
				"dark":true,"captionColor":"#16121f","textColor":"#ece9f5","borderColor":"#3b2f52"}}}`,
			want: "dark=true caption=#16121f text=#ece9f5 border=#3b2f52",
		},
		{
			name:     "只有旧键 dark 时退回明暗（老用户平滑迁移）",
			contents: `{"revision":464,"data":{"comfyui_xyz_theme":"dark"}}`,
			want:     "dark=true caption= text= border=",
		},
		{
			name:     "旧键 light",
			contents: `{"revision":1,"data":{"comfyui_xyz_theme":"light"}}`,
			want:     "dark=false caption= text= border=",
		},
		{
			name:     "外观键把颜色显式留空表示复位为系统默认",
			contents: `{"revision":2,"data":{"comfyui_xyz_window_appearance":{"dark":false,"captionColor":"","textColor":"","borderColor":""}}}`,
			want:     "dark=false caption= text= border=",
		},
		{
			name:     "两个键都没有 → 零值（窗口保持系统默认外观）",
			contents: `{"revision":3,"data":{"comfyui_active_tab":"default"}}`,
			want:     "dark=false caption= text= border=",
		},
		{
			name:     "data 结构损坏 → 零值，不 panic",
			contents: `{"revision":4,"data":"坏数据"}`,
			want:     "dark=false caption= text= border=",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			file := filepath.Join(dir, "ui-state.json")
			if err := os.WriteFile(file, []byte(c.contents), 0o644); err != nil {
				t.Fatal(err)
			}
			got := LoadPersistedAppearance(file)
			summary := "dark=" + boolStr(got.Dark) +
				" caption=" + got.CaptionColor +
				" text=" + got.TextColor +
				" border=" + got.BorderColor
			if summary != c.want {
				t.Errorf("LoadPersistedAppearance = %q，期望 %q", summary, c.want)
			}
		})
	}
}

func TestLoadPersistedAppearanceMissingFile(t *testing.T) {
	got := LoadPersistedAppearance(filepath.Join(t.TempDir(), "nope.json"))
	if got.Dark || got.CaptionColor != "" || got.TextColor != "" || got.BorderColor != "" {
		t.Errorf("文件不存在时应返回零值，实际 %+v", got)
	}
}

// WindowHandler 在 Chrome == nil（web 模式）时必须是 desktop:false，
// 否则前端会把「浏览器模式」误判成桌面模式去显示标题栏设置。
func TestWindowHandlerDesktopFlagWithoutApplier(t *testing.T) {
	h := &WindowHandler{RepoRoot: t.TempDir(), InMemory: true}
	if h.Desktop() {
		t.Error("Chrome 为 nil 时 Desktop() 应为 false")
	}
	if caps := h.caps(); caps.ImmersiveDark || caps.CaptionColor || caps.TextColor || caps.BorderColor {
		t.Errorf("Chrome 为 nil 时不应有任何能力位，实际 %+v", caps)
	}
}

// WindowHandler.persist 在 InMemory（E2E）下不应落盘
func TestWindowHandlerPersistSkippedInMemory(t *testing.T) {
	dir := t.TempDir()
	h := &WindowHandler{RepoRoot: dir, InMemory: true}
	h.persist(winchrome.Appearance{Dark: true, CaptionColor: "#16121f"})
	if _, err := os.Stat(filepath.Join(dir, "data", "ui-state.json")); err == nil {
		t.Error("InMemory 模式下不应写 data/ui-state.json")
	}
}

// persist 只动窗口外观这一个键，不能把 ui-state 里的其它持久化状态冲掉
func TestWindowHandlerPersistKeepsOtherKeys(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "data", "ui-state.json")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(`{"revision":9,"data":{"comfyui_active_tab":"loras","comfyui_xyz_theme":"dark"}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	h := &WindowHandler{RepoRoot: dir, Queue: storage.NewWriteQueue()}
	h.persist(winchrome.Appearance{Dark: true, CaptionColor: "#16121f", TextColor: "#ece9f5", BorderColor: "#3b2f52"})

	got := LoadPersistedAppearance(file)
	if got.CaptionColor != "#16121f" || got.TextColor != "#ece9f5" || got.BorderColor != "#3b2f52" || !got.Dark {
		t.Fatalf("外观没有被正确落盘：%+v", got)
	}
	raw, ok := storage.ReadJSONFile(file)
	if !ok {
		t.Fatal("落盘后应能读回 ui-state.json")
	}
	data, _ := raw["data"].(map[string]any)
	if data["comfyui_active_tab"] != "loras" || data["comfyui_xyz_theme"] != "dark" {
		t.Errorf("persist 不应动其它键，实际 data=%v", data)
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
