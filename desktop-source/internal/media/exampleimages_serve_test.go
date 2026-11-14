package media

import (
	"bytes"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// serveExampleFile 必须对视频（浏览器总会带 Range）返回真实的字节区间。
// 回归：旧实现把裁剪过的自定义 Reader 交给 http.ServeContent，size 被算成 0，
// 206 里写进 416 错误文本，所有视频都解不出来。
func TestServeExampleFileRange(t *testing.T) {
	root := t.TempDir()
	hash := strings.Repeat("a", 64)
	dir := filepath.Join(root, hash)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("0123456789"), 1000) // 10000 字节
	if err := os.WriteFile(filepath.Join(dir, "image_0.mp4"), payload, 0o644); err != nil {
		t.Fatal(err)
	}

	m := NewManager("http://127.0.0.1:1") // settings 接口必然失败，回落到 cachedRoot
	m.cachedRoot = root

	cases := []struct {
		rangeHeader string
		wantStart   int
		wantEnd     int
	}{
		{"bytes=0-", 0, len(payload) - 1},
		{"bytes=100-199", 100, 199},
		{"bytes=-500", len(payload) - 500, len(payload) - 1},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("GET", "/xyz/example-images/file/"+hash+"/image_0.mp4?v=1", nil)
		req.Header.Set("Range", tc.rangeHeader)
		rec := httptest.NewRecorder()
		m.serveExampleFile(rec, req)

		if rec.Code != 206 {
			t.Fatalf("%s: status=%d, want 206", tc.rangeHeader, rec.Code)
		}
		wantRange := fmt.Sprintf("bytes %d-%d/%d", tc.wantStart, tc.wantEnd, len(payload))
		if got := rec.Header().Get("Content-Range"); got != wantRange {
			t.Fatalf("%s: Content-Range=%q, want %q", tc.rangeHeader, got, wantRange)
		}
		want := payload[tc.wantStart : tc.wantEnd+1]
		if !bytes.Equal(rec.Body.Bytes(), want) {
			t.Fatalf("%s: body %d bytes, want %d", tc.rangeHeader, rec.Body.Len(), len(want))
		}
	}
}
