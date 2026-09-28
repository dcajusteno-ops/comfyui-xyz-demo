package winchrome

import "testing"

// 这里的期望值与 TS 侧 src/lib/theme.test.ts 的同名用例保持一致：
// COLORREF 是 0x00BBGGRR（BGR），两边换算必须一样，否则标题栏颜色会整体偏掉。
func TestParseHex(t *testing.T) {
	cases := []struct {
		in      string
		r, g, b uint8
		ok      bool
	}{
		{"#d97706", 0xd9, 0x77, 0x06, true},
		{"#D97706", 0xd9, 0x77, 0x06, true},
		{"d97706", 0xd9, 0x77, 0x06, true},
		{"#fff", 0xff, 0xff, 0xff, true},
		{"#0000ff", 0x00, 0x00, 0xff, true},
		{"  #123456  ", 0x12, 0x34, 0x56, true},
		{"", 0, 0, 0, false},
		{"#12345", 0, 0, 0, false},
		{"#gggggg", 0, 0, 0, false},
		{"rgba(1,2,3,0.5)", 0, 0, 0, false},
	}
	for _, c := range cases {
		r, g, b, ok := ParseHex(c.in)
		if ok != c.ok || (ok && (r != c.r || g != c.g || b != c.b)) {
			t.Errorf("ParseHex(%q) = (%d,%d,%d,%v)，期望 (%d,%d,%d,%v)", c.in, r, g, b, ok, c.r, c.g, c.b, c.ok)
		}
	}
}

func TestColorRefIsBGR(t *testing.T) {
	cases := []struct {
		in   string
		want uint32
	}{
		// #d97706 → r=0xD9 g=0x77 b=0x06 → COLORREF 0x000677D9
		{"#d97706", 0x000677d9},
		{"#ffffff", 0x00ffffff},
		// 纯蓝在 COLORREF 里落在高位
		{"#0000ff", 0x00ff0000},
		{"#ff0000", 0x000000ff},
		{"#1c1917", 0x0017191c},
		// 空串 / 非法值 → 复位为系统默认
		{"", ColorDefault},
		{"nope", ColorDefault},
	}
	for _, c := range cases {
		if got := ColorRef(c.in); got != c.want {
			t.Errorf("ColorRef(%q) = 0x%08X，期望 0x%08X", c.in, got, c.want)
		}
	}
}

func TestSpecialColorConstants(t *testing.T) {
	// 这两个是 DWM 约定的哨兵值，写错会把颜色变成奇怪的结果
	if ColorDefault != 0xFFFFFFFF {
		t.Errorf("DWMWA_COLOR_DEFAULT 应为 0xFFFFFFFF，实际 0x%08X", ColorDefault)
	}
	if ColorNone != 0xFFFFFFFE {
		t.Errorf("DWMWA_COLOR_NONE 应为 0xFFFFFFFE，实际 0x%08X", ColorNone)
	}
}

// 未挂窗口（web 模式 / runWebMode）时 Applier 必须是彻底的 no-op，
// 否则 /xyz/window/appearance 的 desktop:false 就名不副实。
func TestApplierWithoutWindowIsNoop(t *testing.T) {
	a := New()
	if a.Desktop() {
		t.Fatal("未 Attach 时 Desktop() 应为 false")
	}
	if last := a.LastApplied(); last != nil {
		t.Fatalf("未 Attach 时 LastApplied() 应为 nil，实际 %+v", last)
	}

	caps := a.Apply(Appearance{Dark: true, CaptionColor: "#123456"})
	if caps != (Caps{}) {
		t.Fatalf("未 Attach 时不应产生任何能力位，实际 %+v", caps)
	}
	if a.Caps() != (Caps{}) {
		t.Fatalf("未 Attach 时 Caps() 应为零值，实际 %+v", a.Caps())
	}
	if last := a.LastApplied(); last != nil {
		t.Fatalf("未 Attach 时不应记住外观，实际 %+v", last)
	}
}

func TestAttachAndDetachDetection(t *testing.T) {
	a := New()
	a.Attach(0x1234)
	if !a.Desktop() {
		t.Fatal("Attach 之后 Desktop() 应为 true")
	}
	a.Attach(0)
	if a.Desktop() {
		t.Fatal("Attach(0) 之后 Desktop() 应为 false")
	}
}
