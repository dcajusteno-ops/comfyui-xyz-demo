package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"testing"
)

// 与前端 server/theme.test.ts 用同一份构造：壁纸 ref 必须是 sha256 + 扩展名
var testPNG = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8}

func expectedRef(data []byte, ext string) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]) + "." + ext
}

func uploadRequest(t *testing.T, name, filename, contentType string, data []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, name, filename))
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, WallpaperRoutePrefix, &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

// doTheme 发一个请求给 ThemeStore 并收下响应。
// 注意别叫 do —— api_test.go 已有一个同名 helper（同一个 package）。
func doTheme(t *testing.T, store *ThemeStore, req *http.Request) (int, map[string]any, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	store.Handle(rec, req)
	var body map[string]any
	if rec.Body.Len() > 0 && rec.Header().Get("Content-Type") != "image/png" &&
		rec.Header().Get("Content-Type") != "image/webp" {
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
	}
	return rec.Code, body, rec
}

func TestThemeStoreDiskRoundTrip(t *testing.T) {
	root := t.TempDir()
	store := &ThemeStore{RepoRoot: root}

	status, body, _ := doTheme(t, store, uploadRequest(t, "image", "wall.png", "image/png", testPNG))
	if status != 200 || body["success"] != true {
		t.Fatalf("上传失败：status=%d body=%v", status, body)
	}
	ref, _ := body["ref"].(string)
	if ref != expectedRef(testPNG, "png") {
		t.Fatalf("ref = %q，期望 %q", ref, expectedRef(testPNG, "png"))
	}
	if _, err := os.Stat(filepath.Join(root, "data", "theme", "wallpapers", ref)); err != nil {
		t.Fatalf("壁纸没有落到 data/theme/wallpapers/：%v", err)
	}

	// 同一份内容重复上传 → 同一个 ref，列表里只有一条
	_, body2, _ := doTheme(t, store, uploadRequest(t, "image", "again.png", "image/png", testPNG))
	if body2["ref"] != ref {
		t.Fatalf("重复上传应复用同一 ref，实际 %v", body2["ref"])
	}
	_, list, _ := doTheme(t, store, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix, nil))
	files, _ := list["files"].([]any)
	if len(files) != 1 || files[0] != ref {
		t.Fatalf("列表应为 [%s]，实际 %v", ref, files)
	}

	// 服务图片本体
	status, _, rec := doTheme(t, store, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix+"/"+ref, nil))
	if status != 200 {
		t.Fatalf("GET 壁纸 status=%d", status)
	}
	if rec.Body.String() != string(testPNG) {
		t.Fatalf("返回的字节与上传的不一致")
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q，期望 image/png", got)
	}
	if got := rec.Header().Get("Cache-Control"); got == "" {
		t.Fatalf("内容哈希命名应带长缓存头")
	}

	// 删除
	if status, _, _ := doTheme(t, store, httptest.NewRequest(http.MethodDelete, WallpaperRoutePrefix+"/"+ref, nil)); status != 200 {
		t.Fatalf("DELETE status=%d", status)
	}
	_, list2, _ := doTheme(t, store, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix, nil))
	if files2, _ := list2["files"].([]any); len(files2) != 0 {
		t.Fatalf("删除后列表应为空，实际 %v", files2)
	}
}

func TestThemeStoreRejects(t *testing.T) {
	store := &ThemeStore{RepoRoot: t.TempDir()}

	cases := []struct {
		name   string
		req    *http.Request
		status int
	}{
		{
			name:   "扩展名只认 MIME 白名单（image/svg+xml 被拒）",
			req:    uploadRequest(t, "image", "evil.svg", "image/svg+xml", testPNG),
			status: 415,
		},
		{
			name:   "非 multipart",
			req:    httptest.NewRequest(http.MethodPost, WallpaperRoutePrefix, bytes.NewReader([]byte("{}"))),
			status: 400,
		},
		{
			name:   "缺图片字段",
			req:    uploadRequest(t, "other", "x.txt", "text/plain", []byte("hi")),
			status: 400,
		},
		{
			name:   "ref 格式非法（防路径穿越）",
			req:    httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix+"/..%2F..%2Fetc%2Fpasswd", nil),
			status: 400,
		},
		{
			name:   "格式合法但不存在",
			req:    httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix+"/"+expectedRef([]byte("nope"), "png"), nil),
			status: 404,
		},
		{
			name:   "不支持的方法",
			req:    httptest.NewRequest(http.MethodPatch, WallpaperRoutePrefix, nil),
			status: 405,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, _, _ := doTheme(t, store, c.req)
			if status != c.status {
				t.Fatalf("status = %d，期望 %d", status, c.status)
			}
		})
	}
}

func TestThemeStoreEmptyListIsArray(t *testing.T) {
	store := &ThemeStore{RepoRoot: t.TempDir()}
	rec := httptest.NewRecorder()
	store.Handle(rec, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix, nil))
	// 必须是 []，不能是 null —— 前端与 parity 都按数组判
	if got := rec.Body.String(); got != "{\"files\":[],\"success\":true}\n" {
		t.Fatalf("空列表响应 = %q", got)
	}
}

// 内存态（DSH_E2E）不落盘，但服务/删除行为与磁盘态一致
func TestThemeStoreMemoryMode(t *testing.T) {
	root := t.TempDir()
	store := &ThemeStore{RepoRoot: root, InMemory: true}

	_, body, _ := doTheme(t, store, uploadRequest(t, "image", "wall.png", "image/png", testPNG))
	ref, _ := body["ref"].(string)
	if ref == "" {
		t.Fatal("内存态上传应返回 ref")
	}
	if _, err := os.Stat(filepath.Join(root, "data")); err == nil {
		t.Fatal("内存态不应写磁盘")
	}

	status, _, rec := doTheme(t, store, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix+"/"+ref, nil))
	if status != 200 || rec.Body.String() != string(testPNG) {
		t.Fatalf("内存态服务失败：status=%d len=%d", status, rec.Body.Len())
	}

	if status, _, _ := doTheme(t, store, httptest.NewRequest(http.MethodDelete, WallpaperRoutePrefix+"/"+ref, nil)); status != 200 {
		t.Fatalf("内存态删除失败：status=%d", status)
	}
	_, list, _ := doTheme(t, store, httptest.NewRequest(http.MethodGet, WallpaperRoutePrefix, nil))
	if files, _ := list["files"].([]any); len(files) != 0 {
		t.Fatalf("删除后应为空，实际 %v", files)
	}
}
