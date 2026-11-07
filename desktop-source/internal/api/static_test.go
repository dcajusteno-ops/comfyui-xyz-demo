package api

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func staticTestDist() fs.FS {
	return fstest.MapFS{
		"assets/app-abc123.js": &fstest.MapFile{Data: []byte("console.log(1)")},
		"data/x.json":          &fstest.MapFile{Data: []byte(`{"a":1}`)},
		"index.html":           &fstest.MapFile{Data: []byte("<html>app</html>")},
	}
}

func TestStaticHandlerCacheHeaders(t *testing.T) {
	handler := NewStaticHandler(staticTestDist())

	do := func(path string, headers map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	// 1. Vite 带 hash 的产物：一年 immutable
	rec := do("/assets/app-abc123.js", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("assets 应 200, got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("assets 应 immutable, got %q", cc)
	}

	// 2. 词库/缩略图：no-cache + ETag
	rec = do("/data/x.json", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("data 应 200, got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("data Cache-Control = %q, want no-cache", cc)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("data 缺少 ETag")
	}

	// 3. 带 If-None-Match 再请求：必须 304，且不再回 body
	rec = do("/data/x.json", map[string]string{"If-None-Match": etag})
	if rec.Code != http.StatusNotModified {
		t.Fatalf("ETag 命中应 304, got %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 不应有 body, got %q", rec.Body.String())
	}

	// 4. HTML 入口：no-cache（FileServer 会把 /index.html 301 到 ./，这里直接测根路径）
	rec = do("/", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("index 应 200, got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("index Cache-Control = %q, want no-cache", cc)
	}

	// 5. 文件不存在时语义不变：404，且不因包装而 panic
	rec = do("/data/missing.json", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("缺失文件应 404, got %d", rec.Code)
	}
}
