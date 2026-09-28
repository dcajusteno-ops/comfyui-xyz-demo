package winchrome

import (
	"os"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

/**
 * DWM 链路的真机往返探测（默认跳过）。
 *
 * 为什么需要它：winchrome 的全部行为都是「把值交给 DWM」，单元测试只能覆盖颜色换算，
 * 覆盖不了「这台机器上 DwmSetWindowAttribute 到底认不认这几个属性」。
 * 这个用例创建一个**离屏**的顶层窗口（系统预定义窗口类 STATIC，不用 WebView2 也不进任务栏），
 * 施加外观后用 DwmGetWindowAttribute 读回，据此判断本机 Windows 版本支持到哪一步
 * （Win11 四项全成；Win10 只有 immersive dark）。
 *
 * 跑法：WINCHROME_PROBE=1 go test ./internal/winchrome/ -run TestDwmRoundTrip -v
 */

const (
	wsOverlappedWindow    = 0x00CF0000
	wsVisible             = 0x10000000
	wsExToolWindow        = 0x00000080
	offScreenCoordinate   = 0xFFFF8300 // -32000，远离任何显示器
	probeWindowWidth      = 400
	probeWindowHeight     = 300
	dwmwaImmersiveDarkGet = 20
)

func TestDwmRoundTrip(t *testing.T) {
	if os.Getenv("WINCHROME_PROBE") != "1" {
		t.Skip("设 WINCHROME_PROBE=1 才跑：会创建一个离屏窗口，仅用于本机人工验证 DWM 链路")
	}

	user32 := windows.NewLazySystemDLL("user32.dll")
	createWindowEx := user32.NewProc("CreateWindowExW")
	destroyWindow := user32.NewProc("DestroyWindow")
	className, _ := windows.UTF16PtrFromString("STATIC")
	windowName, _ := windows.UTF16PtrFromString("winchrome probe")

	hwnd, _, callErr := createWindowEx.Call(
		uintptr(wsExToolWindow),
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowName)),
		uintptr(wsOverlappedWindow|wsVisible),
		uintptr(offScreenCoordinate),
		uintptr(offScreenCoordinate),
		probeWindowWidth,
		probeWindowHeight,
		0, 0, 0, 0,
	)
	if hwnd == 0 {
		t.Fatalf("CreateWindowExW 失败：%v", callErr)
	}
	defer func() { _, _, _ = destroyWindow.Call(hwnd) }()

	applier := New()
	applier.Attach(hwnd)
	if !applier.Desktop() {
		t.Fatal("Attach 之后 Desktop() 应为 true")
	}

	want := Appearance{
		Dark:         true,
		CaptionColor: "#1c1917",
		TextColor:    "#f5f5f4",
		BorderColor:  "#292524",
	}
	caps := applier.Apply(want)
	t.Logf("本机 DWM 能力位：%+v", caps)

	// 给 DWM 一点时间把属性应用到合成帧上
	time.Sleep(500 * time.Millisecond)

	dwmGet := windows.NewLazySystemDLL("dwmapi.dll").NewProc("DwmGetWindowAttribute")
	readBack := func(attr uint32) (uint32, bool) {
		var out uint32
		r, _, _ := dwmGet.Call(hwnd, uintptr(attr), uintptr(unsafe.Pointer(&out)), unsafe.Sizeof(out))
		return out, int32(r) == 0
	}

	if v, ok := readBack(dwmwaImmersiveDarkGet); ok {
		t.Logf("immersive dark 读回 = %d（设置值 1）", v)
		if v != 1 {
			t.Errorf("immersive dark 读回 %d，期望 1", v)
		}
	} else {
		t.Log("immersive dark 读回失败（该属性在本机不可查询）")
	}

	for _, c := range []struct {
		name string
		attr uint32
		hex  string
	}{
		{"caption color", dwmwaCaptionColor, want.CaptionColor},
		{"text color", dwmwaTextColor, want.TextColor},
		{"border color", dwmwaBorderColor, want.BorderColor},
	} {
		got, ok := readBack(c.attr)
		if !ok {
			t.Logf("%s 读回失败（本机不支持该属性，符合 Win10 预期）", c.name)
			continue
		}
		expected := ColorRef(c.hex)
		t.Logf("%s 读回 = 0x%08X（设置值 %s → 0x%08X）", c.name, got, c.hex, expected)
		if got != expected {
			t.Errorf("%s 读回 0x%08X，期望 0x%08X", c.name, got, expected)
		}
	}

	// 复位分支：空颜色应落成 DWMWA_COLOR_DEFAULT
	if caps.CaptionColor {
		resetCaps := applier.Apply(Appearance{Dark: false})
		t.Logf("复位后能力位：%+v", resetCaps)
		time.Sleep(300 * time.Millisecond)
		if got, ok := readBack(dwmwaCaptionColor); ok {
			t.Logf("复位后 caption color = 0x%08X（COLOR_DEFAULT = 0x%08X）", got, ColorDefault)
		}
	}
}
