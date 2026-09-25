package media

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---- isPrivateIp（对译 server/exampleImages.test.ts 的私网段用例） ----

func TestIsPrivateIP(t *testing.T) {
	private := []string{
		"127.0.0.1", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
		"192.168.1.1", "0.0.0.0", "169.254.1.1", "100.64.0.1", "100.127.255.255",
		"::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:192.168.1.1", "::ffff:10.0.0.1",
		// 非法 IPv4 fail-closed
		"999.1.1.1", "1.2.3", "1.2.3.4.5", "abc",
	}
	for _, ip := range private {
		if !IsPrivateIP(ip) {
			t.Errorf("%q 应判为私网/非法", ip)
		}
	}
	public := []string{
		"8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "192.169.0.1",
		"100.63.255.255", "100.128.0.1", "::ffff:8.8.8.8", "2606:4700::1111",
	}
	for _, ip := range public {
		if IsPrivateIP(ip) {
			t.Errorf("%q 不应判为私网", ip)
		}
	}
}

func TestIsAllowedMediaURL(t *testing.T) {
	blocked := []string{
		"", "ftp://example.com/a.png", "//example.com/a.png",
		"http://localhost/a.png", "http://sub.localhost/a.png",
		"http://machine.local/a.png", "http://svc.internal/a.png",
		"http://127.0.0.1/a.png", "http://[::1]/a.png", "http://192.168.1.2/a.png",
		"http://10.0.0.5/a.png", "http://172.16.9.9/a.png", "http://169.254.169.254/latest",
		"http://[::ffff:10.0.0.1]/a.png",
	}
	for _, u := range blocked {
		if IsAllowedMediaURL(u) {
			t.Errorf("%q 应被拒绝", u)
		}
	}
	allowed := []string{
		"https://civitai.com/images/x.png", "https://image.civitai.com/x/y,width=450/image.png",
		"http://cdn.example.com/a.jpg", "https://8.8.8.8/a.png",
	}
	for _, u := range allowed {
		if !IsAllowedMediaURL(u) {
			t.Errorf("%q 应被放行", u)
		}
	}
}

// ---- safetensors 路径白名单（对译 server/lora.test.ts 核心断言） ----

func TestIsAllowedSafetensorsPath(t *testing.T) {
	dir := t.TempDir()
	st := filepath.Join(dir, "model.safetensors")
	if err := os.WriteFile(st, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsAllowedSafetensorsPath(st) {
		t.Fatal("合法 safetensors 路径应放行")
	}
	// 缺失文件也放行（校验只看路径，读取时才报错）——对齐 TS
	if !IsAllowedSafetensorsPath(filepath.Join(dir, "nothere.safetensors")) {
		t.Fatal("路径校验不应依赖文件存在")
	}
	denied := []string{
		"", "C:\\anything\\secrets.txt", "/etc/passwd", "model.ckpt", "model.safetensors.bak",
		strings.ReplaceAll(st, ".safetensors", ".bin"),
		"a\x00b.safetensors",
	}
	for _, p := range denied {
		if IsAllowedSafetensorsPath(p) {
			t.Errorf("%q 应被拒绝", p)
		}
	}

	// 白名单根约束
	t.Setenv("XYZ_LORA_ALLOWED_ROOTS", dir+string(os.PathListSeparator)+filepath.Join(dir, "models2"))
	_ = os.MkdirAll(filepath.Join(dir, "models2"), 0o755)
	if !IsAllowedSafetensorsPath(st) {
		t.Fatal("根目录内应放行")
	}
	if !IsAllowedSafetensorsPath(filepath.Join(dir, "models2", "m.safetensors")) {
		t.Fatal("第二个根内应放行")
	}
	if IsAllowedSafetensorsPath(filepath.Join(filepath.Dir(dir), "outside-roots", "m.safetensors")) {
		t.Fatal("根目录外应拒绝")
	}
	// 前缀绕过：roots=dir 时，dir2（dir 的前缀兄弟目录）应拒绝
	sibling := filepath.Dir(dir) + string(filepath.Separator) + filepath.Base(dir) + "x"
	_ = os.MkdirAll(sibling, 0o755)
	t.Cleanup(func() { _ = os.RemoveAll(sibling) })
	if IsAllowedSafetensorsPath(filepath.Join(sibling, "m.safetensors")) {
		t.Fatal("前缀绕过目录应拒绝")
	}
	_ = os.Unsetenv("XYZ_LORA_ALLOWED_ROOTS")
}

// ---- safetensors 头解析 ----

func TestExtractSafetensorsMetadata(t *testing.T) {
	dir := t.TempDir()
	// 构造合法文件：header JSON + __metadata__
	header := []byte(`{"__metadata__":{"ss_network_name":"test-lora"},"weight":{}}`)
	buf := make([]byte, 8+len(header))
	n := uint64(len(header))
	for i := 0; i < 8; i++ {
		buf[i] = byte(n >> (8 * i))
	}
	copy(buf[8:], header)
	p := filepath.Join(dir, "m.safetensors")
	if err := os.WriteFile(p, buf, 0o644); err != nil {
		t.Fatal(err)
	}
	meta, err := extractSafetensorsMetadata(p)
	if err != nil {
		t.Fatal(err)
	}
	if meta["ss_network_name"] != "test-lora" {
		t.Fatalf("metadata 不符: %v", meta)
	}

	// 无 __metadata__ → 空对象
	header2 := []byte(`{"weight":{}}`)
	buf2 := make([]byte, 8+len(header2))
	for i := 0; i < 8; i++ {
		buf2[i] = byte(uint64(len(header2)) >> (8 * i))
	}
	copy(buf2[8:], header2)
	p2 := filepath.Join(dir, "n.safetensors")
	_ = os.WriteFile(p2, buf2, 0o644)
	meta2, err := extractSafetensorsMetadata(p2)
	if err != nil || len(meta2) != 0 {
		t.Fatalf("无 __metadata__ 应返回空对象: %v %v", meta2, err)
	}

	// 超大 header → 报错
	bad := make([]byte, 8)
	for i := 0; i < 8; i++ {
		bad[i] = 0xFF
	}
	p3 := filepath.Join(dir, "bad.safetensors")
	_ = os.WriteFile(p3, bad, 0o644)
	if _, err := extractSafetensorsMetadata(p3); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("超大 header 应报错: %v", err)
	}
}
