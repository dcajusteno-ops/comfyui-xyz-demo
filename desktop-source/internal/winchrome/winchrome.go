// Package winchrome 用 DWM（Desktop Window Manager）让 Windows 原生标题栏与窗口边框
// 跟随应用主题。
//
// 背景：曾经按需求做过「无边框 + 前端自绘标题栏」，验收时被否决并整体回退为系统原生标题栏。
// 所以这里**不动窗口结构**（不加/删 WS_CAPTION，不做 SetWindowSubclass），只用 DWM 属性
// 给系统自带的那套标题栏着色：
//
//	DWMWA_USE_IMMERSIVE_DARK_MODE  深/浅标题栏（含最小化/最大化/关闭按钮的字形配色）
//	DWMWA_BORDER_COLOR             窗口边框色
//	DWMWA_CAPTION_COLOR            标题栏底色
//	DWMWA_TEXT_COLOR               标题栏文字色
//
// 可用性：immersive dark 从 Win10 1809 起可用（旧版属性号是 19，2004+ 是 20，两个都试）；
// 后三个只有 Win11（build 22000+）支持，Win10 上调用返回 E_INVALIDARG。
// 这里**不做版本嗅探**——直接调，按 HRESULT 是否为 S_OK 记录能力位，让不支持的属性静默降级。
//
// 本包只负责「HWND + Appearance → DWM」，不碰持久化；外观从哪来由调用方决定
// （见 internal/api/window.go：外观由前端算好后推过来并落盘）。
package winchrome

import (
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// DWM 属性号（dwmapi.h）
const (
	dwmwaUseImmersiveDarkMode    = 20
	dwmwaUseImmersiveDarkModeOld = 19
	dwmwaBorderColor             = 34
	dwmwaCaptionColor            = 35
	dwmwaTextColor               = 36
)

// 特殊颜色值：DWMWA_COLOR_DEFAULT = 交还给系统默认；DWMWA_COLOR_NONE = 不绘制。
// 用于「关闭『标题栏跟随主题』」时把颜色复位。
const (
	ColorDefault uint32 = 0xFFFFFFFF
	ColorNone    uint32 = 0xFFFFFFFE
)

// Appearance 是窗口外观请求体（同时也是 /xyz/window/appearance 的 JSON 结构）。
// 颜色为 "#rrggbb"；空字符串表示该属性复位为系统默认。
type Appearance struct {
	Dark         bool   `json:"dark"`
	CaptionColor string `json:"captionColor"`
	TextColor    string `json:"textColor"`
	BorderColor  string `json:"borderColor"`
}

// Caps 如实反映各属性在当前系统上是否真的生效（Win10 只有 ImmersiveDark 为 true）。
type Caps struct {
	ImmersiveDark bool `json:"immersiveDark"`
	CaptionColor  bool `json:"captionColor"`
	TextColor     bool `json:"textColor"`
	BorderColor   bool `json:"borderColor"`
}

// Applier 持有窗口句柄并串行地施加外观（HTTP handler 可能并发调用）。
type Applier struct {
	mu   sync.Mutex
	hwnd uintptr
	last *Appearance
	caps Caps
}

func New() *Applier { return &Applier{} }

// Attach 记下窗口句柄（在 newWindow 之后立刻调用；hwnd==0 表示无桌面窗口）。
func (a *Applier) Attach(hwnd uintptr) {
	a.mu.Lock()
	a.hwnd = hwnd
	a.mu.Unlock()
}

// Desktop 报告是否真的挂在桌面窗口上（决定 /xyz/window/appearance 返回 desktop 真假）。
func (a *Applier) Desktop() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.hwnd != 0
}

// Caps 返回累计探测到的能力位。
func (a *Applier) Caps() Caps {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.caps
}

// LastApplied 返回最近一次成功施加的外观。
func (a *Applier) LastApplied() *Appearance {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.last == nil {
		return nil
	}
	out := *a.last
	return &out
}

// Apply 幂等：值没变就什么都不做（前端每次主题变更都会推一次，boot 时还会重复推一次）。
func (a *Applier) Apply(app Appearance) Caps {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.hwnd == 0 {
		return a.caps
	}
	if a.last != nil && *a.last == app {
		return a.caps
	}

	// 深色模式：新属性号（20）先试，老 Win10 再试 19
	dark := uint32(0)
	if app.Dark {
		dark = 1
	}
	if a.setAttr(dwmwaUseImmersiveDarkMode, dark) || a.setAttr(dwmwaUseImmersiveDarkModeOld, dark) {
		a.caps.ImmersiveDark = true
	}

	if a.setAttr(dwmwaCaptionColor, ColorArg(app.CaptionColor)) {
		a.caps.CaptionColor = true
	}
	if a.setAttr(dwmwaTextColor, ColorArg(app.TextColor)) {
		a.caps.TextColor = true
	}
	if a.setAttr(dwmwaBorderColor, ColorArg(app.BorderColor)) {
		a.caps.BorderColor = true
	}

	a.last = &app
	return a.caps
}

func (a *Applier) setAttr(attr, value uint32) bool {
	proc := dwmSetWindowAttribute()
	if proc == nil {
		return false
	}
	r, _, _ := proc.Call(a.hwnd, uintptr(attr), uintptr(unsafe.Pointer(&value)), unsafe.Sizeof(value))
	return int32(r) == 0 // S_OK
}

var (
	dwmOnce sync.Once
	dwmProc *windows.LazyProc
)

func dwmSetWindowAttribute() *windows.LazyProc {
	dwmOnce.Do(func() {
		proc := windows.NewLazySystemDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
		if proc.Find() == nil {
			dwmProc = proc
		}
	})
	return dwmProc
}

/* ------------------------------------------------------------------ *
 * 颜色
 * ------------------------------------------------------------------ */

// ColorRef 把 "#rrggbb" 转成 COLORREF（0x00BBGGRR —— BGR 顺序，不是 RGB）。
// 空串或非法值返回 ColorDefault，即复位为系统默认。
func ColorRef(value string) uint32 {
	r, g, b, ok := ParseHex(value)
	if !ok {
		return ColorDefault
	}
	return uint32(b)<<16 | uint32(g)<<8 | uint32(r)
}

// ColorArg 是 ColorRef 的别名，语义上强调「这是要传给 DWM 的参数」。
func ColorArg(value string) uint32 { return ColorRef(value) }

// ParseHex 解析 "#rgb" / "#rrggbb"（也接受不带 # 的 6 位形式）。
func ParseHex(value string) (r, g, b uint8, ok bool) {
	s := strings.TrimSpace(value)
	if s == "" {
		return 0, 0, 0, false
	}
	if strings.HasPrefix(s, "#") {
		s = s[1:]
	}
	switch len(s) {
	case 3:
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	case 6:
	default:
		return 0, 0, 0, false
	}
	var n uint32
	for i := 0; i < 6; i++ {
		d := hexDigit(s[i])
		if d < 0 {
			return 0, 0, 0, false
		}
		n = n<<4 | uint32(d)
	}
	return uint8(n >> 16), uint8(n >> 8), uint8(n), true
}

func hexDigit(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c-'a') + 10
	case c >= 'A' && c <= 'F':
		return int(c-'A') + 10
	default:
		return -1
	}
}
