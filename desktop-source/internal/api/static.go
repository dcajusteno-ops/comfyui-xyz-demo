package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"
)

// staticHandler 给内嵌 dist 的静态资源补缓存语义。
//
// 背景：embed.FS 的 FileInfo.ModTime 恒为零，http.FileServerFS 因此不会发
// Last-Modified，也没有 ETag —— WebView2 每次冷启动都可能把 6MB 词库 JSON
// 与 22MB 缩略图重新下载一遍。
//
// 规则：
//   - /assets/*（Vite 产物文件名自带内容 hash）→ 一年 immutable
//   - /data/*（词库 / 缩略图）→ no-cache + 内容 SHA256 派生的 ETag（命中返回 304）
//   - 其余（index.html / favicon / standalone.html）→ no-cache
//
// 不压缩、不改 MIME，实际发文件仍交给标准库。
type staticHandler struct {
	dist  fs.FS
	files http.Handler
	mu    sync.Mutex
	etags map[string]string
}

// NewStaticHandler 包一层缓存头；dist 必须非 nil（调用方负责缺失时的降级）。
func NewStaticHandler(dist fs.FS) http.Handler {
	return &staticHandler{
		dist:  dist,
		files: http.FileServerFS(dist),
		etags: map[string]string{},
	}
}

func (h *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean("/" + r.URL.Path)
	switch {
	case strings.HasPrefix(clean, "/assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasPrefix(clean, "/data/"):
		w.Header().Set("Cache-Control", "no-cache")
		if etag := h.etag(clean); etag != "" {
			w.Header().Set("ETag", etag)
		}
	default:
		w.Header().Set("Cache-Control", "no-cache")
	}
	h.files.ServeHTTP(w, r)
}

// etag 返回 "sha256 前 16 位" 的强 ETag；文件读取失败时返回空串，
// 让 FileServer 按原逻辑返回 404，不改变错误语义。
func (h *staticHandler) etag(cleanedPath string) string {
	name := strings.TrimPrefix(cleanedPath, "/")
	if name == "" || strings.HasSuffix(name, "/") {
		return ""
	}

	h.mu.Lock()
	cached, ok := h.etags[name]
	h.mu.Unlock()
	if ok {
		return cached
	}

	data, err := fs.ReadFile(h.dist, name)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	tag := `"` + hex.EncodeToString(sum[:8]) + `"`

	h.mu.Lock()
	h.etags[name] = tag
	h.mu.Unlock()
	return tag
}
