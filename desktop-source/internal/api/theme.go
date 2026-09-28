// theme.go —— 主题壁纸存储（/xyz/theme/wallpaper），移植 server/theme.ts。
// SSOT 是 server/theme.ts；路由形状、状态码、错误文案、ref 规则逐条对齐，勿单边改动。
//
// 契约：
//
//	GET    /xyz/theme/wallpaper         → { success, files: string[] }
//	POST   /xyz/theme/wallpaper         → multipart 字段 image → { success, ref }
//	GET    /xyz/theme/wallpaper/<ref>   → 图片本体（Range / HEAD）
//	DELETE /xyz/theme/wallpaper/<ref>   → { success }
//
// 文件名 = 内容 sha256 + MIME 白名单推导的扩展名：天然去重、防路径穿越、不信任客户端文件名。
package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// ThemeMaxWallpaperBytes 对齐 TS 的 THEME_MAX_WALLPAPER_BYTES。
const ThemeMaxWallpaperBytes = 20 * 1024 * 1024

// WallpaperRoutePrefix 与 TS 的 WALLPAPER_ROUTE_PREFIX 一致。
const WallpaperRoutePrefix = "/xyz/theme/wallpaper"

var wallpaperRefRe = regexp.MustCompile(`^[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif|avif)$`)

var themeExtByMime = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/jpg":  "jpg",
	"image/webp": "webp",
	"image/gif":  "gif",
	"image/avif": "avif",
}

var themeMimeByExt = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"jpeg": "image/jpeg",
	"webp": "image/webp",
	"gif":  "image/gif",
	"avif": "image/avif",
}

// ThemeStore 承载壁纸目录与 E2E 内存态（对齐 uiState 的 DSH_E2E 做法）。
type ThemeStore struct {
	RepoRoot string
	InMemory bool

	mu       sync.Mutex
	memFiles map[string]memoryWallpaper
}

type memoryWallpaper struct {
	mime string
	data []byte
}

func (s *ThemeStore) dir() string {
	return filepath.Join(s.RepoRoot, "data", "theme", "wallpapers")
}

// Handle 按路径与方法分派（与 TS 侧 handleThemeRequest 一一对应）。
func (s *ThemeStore) Handle(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, WallpaperRoutePrefix)
	method := strings.ToUpper(r.Method)

	if rest == "" || rest == "/" {
		switch method {
		case http.MethodGet:
			storage.SendJSON(w, 200, map[string]any{"success": true, "files": s.list()})
		case http.MethodPost:
			s.upload(w, r)
		default:
			storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		}
		return
	}

	ref := strings.TrimPrefix(rest, "/")
	if !wallpaperRefRe.MatchString(ref) {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "invalid wallpaper ref"})
		return
	}

	switch method {
	case http.MethodGet, http.MethodHead:
		s.serve(w, r, ref)
	case http.MethodDelete:
		s.remove(ref)
		storage.SendJSON(w, 200, map[string]any{"success": true})
	default:
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
	}
}

func (s *ThemeStore) list() []string {
	if s.InMemory {
		s.mu.Lock()
		defer s.mu.Unlock()
		out := make([]string, 0, len(s.memFiles))
		for ref := range s.memFiles {
			out = append(out, ref)
		}
		sort.Strings(out)
		return out
	}
	entries, err := os.ReadDir(s.dir())
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if wallpaperRefRe.MatchString(e.Name()) {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func (s *ThemeStore) upload(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "请求必须为 multipart/form-data"})
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "请求必须为 multipart/form-data"})
		return
	}

	// 先找 Content-Type 以 image/ 开头的段；退而求其次找 name=image（对齐 TS 的挑选顺序）
	var picked *multipart.Part
	var fallback *multipart.Part
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "multipart 解析失败"})
			return
		}
		partType := partMime(part.Header.Get("Content-Type"))
		if strings.HasPrefix(partType, "image/") {
			picked = part
			break
		}
		if fallback == nil && part.FormName() == "image" {
			fallback = part
		}
	}
	if picked == nil {
		picked = fallback
	}
	if picked == nil {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "缺少图片字段（image）"})
		return
	}

	// 扩展名只认 MIME 白名单，不信任客户端文件名
	mime := partMime(picked.Header.Get("Content-Type"))
	ext, ok := themeExtByMime[mime]
	if !ok {
		storage.SendJSON(w, 415, map[string]any{"success": false, "error": "不支持的图片类型：" + mime})
		return
	}

	// 多读 1 字节用于判定超限，避免把超大文件整个读进内存
	data, err := io.ReadAll(io.LimitReader(picked, int64(ThemeMaxWallpaperBytes)+1))
	if err != nil {
		storage.SendJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if len(data) == 0 || len(data) > ThemeMaxWallpaperBytes {
		storage.SendJSON(w, 413, map[string]any{
			"success": false,
			"error":   "图片大小需在 1B ~ 20MB 之间",
		})
		return
	}

	sum := sha256.Sum256(data)
	ref := hex.EncodeToString(sum[:]) + "." + ext

	if s.InMemory {
		s.mu.Lock()
		if s.memFiles == nil {
			s.memFiles = map[string]memoryWallpaper{}
		}
		s.memFiles[ref] = memoryWallpaper{mime: mime, data: data}
		s.mu.Unlock()
	} else {
		dir := s.dir()
		if err := os.MkdirAll(dir, 0o755); err != nil {
			storage.SendJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		// 同一份内容重复上传 → 同一个 ref，直接复用（内容哈希命名天然幂等）
		if err := os.WriteFile(filepath.Join(dir, ref), data, 0o644); err != nil {
			storage.SendJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
	}

	storage.SendJSON(w, 200, map[string]any{"success": true, "ref": ref})
}

func (s *ThemeStore) serve(w http.ResponseWriter, r *http.Request, ref string) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(ref), "."))
	mime := themeMimeByExt[ext]
	if mime == "" {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	// 内容哈希命名 → 内容不可变，可以长缓存
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")

	if s.InMemory {
		s.mu.Lock()
		hit, ok := s.memFiles[ref]
		s.mu.Unlock()
		if !ok {
			storage.SendJSON(w, 404, map[string]any{"success": false, "error": "wallpaper not found"})
			return
		}
		// 内存态也走 ServeContent，复用它的 Range / HEAD 实现
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(hit.data))
		return
	}

	file, err := os.Open(filepath.Join(s.dir(), ref))
	if err != nil {
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "wallpaper not found"})
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "wallpaper not found"})
		return
	}
	http.ServeContent(w, r, "", info.ModTime(), file)
}

func (s *ThemeStore) remove(ref string) {
	if s.InMemory {
		s.mu.Lock()
		delete(s.memFiles, ref)
		s.mu.Unlock()
		return
	}
	_ = os.Remove(filepath.Join(s.dir(), ref))
}

// partMime 去掉 "image/png; charset=x" 这类参数并统一小写
func partMime(raw string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(raw, ";")[0]))
}
