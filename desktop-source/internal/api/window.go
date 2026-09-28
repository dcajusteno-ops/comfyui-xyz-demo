// window.go —— /xyz/window/appearance：桌面（exe）窗口的原生标题栏 / 边框外观。
//
// 契约（TS 侧 server/window.ts 提供同名端点，供 parity 对拍）：
//
//	GET  → { success, desktop, appearance, caps }
//	POST { dark, captionColor, textColor, borderColor } → { success, desktop, caps }
//
// 因由：窗口由 jchv/go-webview2 创建，源码已核实 CreateWindowExW 之后**紧接着**
// ShowWindow —— 窗口在 NewWithOptions 内部就已可见，所以「开窗前着色」做不到严格零闪烁。
// 折中做法是把外观落盘，启动时先施加（把闪烁压到 1~2 帧），之后前端每次主题变更再推。
//
// 有意为之的差异：TS 侧（vite dev / 浏览器模式）根本没有桌面窗口，是纯 no-op stub，
// 只保证端点存在、字段类型一致。真正的窗口只有 Go 侧有。
//
// 外观的**推导**不在这个包里做：前端算好（src/lib/theme.ts 的 deriveWindowAppearance）推过来，
// 这里只负责施加 + 落盘。这样 Go 侧不需要复制一遍主题调色板与会话逻辑，也就不存在两份推导漂移。
package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/winchrome"
)

const (
	// WindowAppearanceKey 是 ui-state 里的键名（comfyui_ 前缀才能被 ErrorBoundary 的
	// "重置本地配置" 一并清掉）。
	WindowAppearanceKey = "comfyui_xyz_window_appearance"
	// windowLegacyThemeKey 是改造前的旧键（值只有 "light"/"dark"），仅用于首启兜底。
	windowLegacyThemeKey = "comfyui_xyz_theme"
)

// WindowHandler 承载 /xyz/window/appearance。
type WindowHandler struct {
	// Chrome 为 nil 表示当前不是桌面窗口形态（runWebMode / --web / DSH_E2E）→ desktop:false
	Chrome   *winchrome.Applier
	RepoRoot string
	Queue    *storage.WriteQueue
	// InMemory 对齐 UI_STATE 的 DSH_E2E=1：不落盘，防测试污染真实数据
	InMemory bool
}

func (h *WindowHandler) uiStateFile() string {
	return filepath.Join(h.RepoRoot, "data", "ui-state.json")
}

// Handle 按方法分派（GET/POST；其它 405，与 TS 侧保持一致）。
func (h *WindowHandler) Handle(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		app := winchrome.Appearance{}
		if h.Chrome != nil {
			if last := h.Chrome.LastApplied(); last != nil {
				app = *last
			} else {
				app = LoadPersistedAppearance(h.uiStateFile())
			}
		}
		storage.SendJSON(w, 200, map[string]any{
			"success":    true,
			"desktop":    h.Desktop(),
			"appearance": app,
			"caps":       h.caps(),
		})

	case http.MethodPost:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		dark, _ := payload["dark"].(bool)
		app := winchrome.Appearance{
			Dark:         dark,
			CaptionColor: windowStringOr(payload["captionColor"]),
			TextColor:    windowStringOr(payload["textColor"]),
			BorderColor:  windowStringOr(payload["borderColor"]),
		}
		if h.Chrome != nil {
			h.Chrome.Apply(app)
			// 落盘：下次冷启动时 main.go 能在窗口显示前就把标题栏染对
			h.persist(app)
		}
		storage.SendJSON(w, 200, map[string]any{
			"success": true,
			"desktop": h.Desktop(),
			"caps":    h.caps(),
		})

	default:
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
	}
}

func (h *WindowHandler) Desktop() bool {
	return h.Chrome != nil && h.Chrome.Desktop()
}

func (h *WindowHandler) caps() winchrome.Caps {
	if h.Chrome == nil {
		return winchrome.Caps{}
	}
	return h.Chrome.Caps()
}

// persist 把外观写进 data/ui-state.json（与 UiStateStore 共用同一个文件与写队列契约：
// 读-改-合并-原子写，revision + 1）。只动 WindowAppearanceKey 一个键，不影响其它持久化状态。
func (h *WindowHandler) persist(app winchrome.Appearance) {
	if h.InMemory || h.Queue == nil {
		return
	}
	file := h.uiStateFile()
	_ = h.Queue.Do(file, func() error {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			return err
		}
		baseRevision := int64(0)
		var baseData map[string]any
		if existing, ok := storage.ReadJSONFile(file); ok {
			if d, has := existing["data"].(map[string]any); has {
				baseData = d
			}
			baseRevision, _ = numOr(existing, "revision")
		}
		entries := map[string]any{
			WindowAppearanceKey: map[string]any{
				"dark":         app.Dark,
				"captionColor": app.CaptionColor,
				"textColor":    app.TextColor,
				"borderColor":  app.BorderColor,
			},
		}
		next := map[string]any{"revision": baseRevision + 1, "data": mergeUiStateEntries(baseData, entries)}
		return storage.AtomicWriteJSONWithBackup(file, next)
	})
}

// LoadPersistedAppearance 读上次落盘的外观，供 main.go 在**创建窗口之前**调用。
// 没有任何记录时退回旧键 comfyui_xyz_theme 的明暗值，让从旧版本升上来的用户也能一开窗就对色。
func LoadPersistedAppearance(uiStateFile string) winchrome.Appearance {
	existing, ok := storage.ReadJSONFile(uiStateFile)
	if !ok {
		return winchrome.Appearance{}
	}
	data, hasData := existing["data"].(map[string]any)
	if !hasData {
		return winchrome.Appearance{}
	}
	if raw, has := data[WindowAppearanceKey].(map[string]any); has {
		dark, _ := raw["dark"].(bool)
		return winchrome.Appearance{
			Dark:         dark,
			CaptionColor: windowStringOr(raw["captionColor"]),
			TextColor:    windowStringOr(raw["textColor"]),
			BorderColor:  windowStringOr(raw["borderColor"]),
		}
	}
	if legacy, has := data[windowLegacyThemeKey].(string); has {
		return winchrome.Appearance{Dark: legacy == "dark"}
	}
	return winchrome.Appearance{}
}

func windowStringOr(v any) string {
	s, _ := v.(string)
	return s
}
