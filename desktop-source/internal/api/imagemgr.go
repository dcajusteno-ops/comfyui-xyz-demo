// imagemgr.go —— 图片管理器，移植 server/imageManager.ts（SSOT 是 TS，勿单边改动）。
//
// 四个端点：/xyz/images/{config,browse,file,delete}。
// 读接口（browse/file）允许局域网访问；写接口（config/delete）只允许本机回环地址——
// 本服务监听 0.0.0.0，缺这层校验等于把「局域网任意人删本机图片」暴露出去。
package api

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

const (
	// ImageRoutePrefix 同 TS 的 IMAGE_ROUTE_PREFIX。
	ImageRoutePrefix = "/xyz/images"
	// ImageMaxFileBytes 同 TS 的 IMAGE_MAX_FILE_BYTES。
	ImageMaxFileBytes = 30 << 20
	// ImageScanLimit 单目录扫描上限（同 TS）。
	ImageScanLimit = 5000
	// ImageReturnLimit 单次响应图片数上限（同 TS）。
	ImageReturnLimit = 2000
	// ImageDeleteLimit 单次删除路径数上限（同 TS）。
	ImageDeleteLimit = 500

	imageDetectTimeout = 3 * time.Second
	imageDetectCache   = 60 * time.Second
)

var imageMimeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif":  "image/gif",
	".avif": "image/avif",
	".bmp":  "image/bmp",
}

// ImageEntry 同 TS 的 ImageEntry。
type ImageEntry struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

// FailedFile 同 TS 的 FailedFile。
type FailedFile struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

// ImageHandler 承载图片管理器的路径、ComfyUI 地址与可注入的回收站实现。
type ImageHandler struct {
	RepoRoot  string
	ComfyBase string
	Client    *http.Client
	// TrashFunc 便于测试注入；nil 时用 MoveToRecycleBin。
	TrashFunc func([]string) []FailedFile
	// ServiceURL 外置图片管理页地址（main 注入；nil 或空串 = 未启动）。
	ServiceURL func() string

	mu       sync.Mutex
	writeMu  sync.Mutex
	cacheAt  time.Time
	cacheKey string
	cacheVal imageDetected
}

type imageDetected struct {
	Dir    string
	Source string
}

type imageConfig struct {
	RootDir         string
	RootSource      string
	SavedRootDir    string
	OutputDir       string
	OutputDirSource string
	OutputDirExists bool
	RootExists      bool
	TrashEnabled    bool
}

func imageExtOf(name string) string { return strings.ToLower(filepath.Ext(name)) }

func isImageName(name string) bool {
	_, ok := imageMimeByExt[imageExtOf(name)]
	return ok
}

func imageMimeOf(name string) string {
	if mime, ok := imageMimeByExt[imageExtOf(name)]; ok {
		return mime
	}
	return "application/octet-stream"
}

// ArgValue 同 TS 的 argValue：`--flag value` 与 `--flag=value` 都认。
func ArgValue(args []string, flag string) string {
	for i, item := range args {
		if item == flag {
			if i+1 >= len(args) {
				return ""
			}
			next := args[i+1]
			if strings.HasPrefix(next, "-") {
				return ""
			}
			return next
		}
		if strings.HasPrefix(item, flag+"=") {
			return strings.TrimPrefix(item, flag+"=")
		}
	}
	return ""
}

func resolveImageDir(baseDir, value string) string {
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		abs, err := filepath.Abs(value)
		if err != nil {
			return ""
		}
		return abs
	}
	if baseDir == "" {
		return ""
	}
	abs, err := filepath.Abs(filepath.Join(baseDir, value))
	if err != nil {
		return ""
	}
	return abs
}

// DetectImageOutputDir 同 TS 的 detectOutputDir：只认绝对且可信的来源，宁可 none 也不猜。
func DetectImageOutputDir(argv []string, envValue string) imageDetected {
	if env := strings.TrimSpace(envValue); env != "" {
		if abs, err := filepath.Abs(env); err == nil {
			return imageDetected{Dir: abs, Source: "env"}
		}
	}

	mainArg := ""
	for _, item := range argv {
		if strings.EqualFold(filepath.Base(item), "main.py") {
			mainArg = item
			break
		}
	}
	baseDir := ""
	if mainArg != "" && filepath.IsAbs(mainArg) {
		baseDir = filepath.Dir(mainArg)
	}

	if out := resolveImageDir(baseDir, ArgValue(argv, "--output-directory")); out != "" {
		return imageDetected{Dir: out, Source: "argv-output"}
	}
	if base := resolveImageDir(baseDir, ArgValue(argv, "--base-directory")); base != "" {
		abs, err := filepath.Abs(filepath.Join(base, "output"))
		if err == nil {
			return imageDetected{Dir: abs, Source: "argv-base"}
		}
	}
	if baseDir != "" {
		if abs, err := filepath.Abs(filepath.Join(baseDir, "output")); err == nil {
			return imageDetected{Dir: abs, Source: "argv-main"}
		}
	}
	return imageDetected{Source: "none"}
}

// IsLocalComfyTarget 同 TS 的 isLocalComfyTarget。
func IsLocalComfyTarget(target string) bool {
	u, err := url.Parse(target)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func isDir(target string) bool {
	if target == "" {
		return false
	}
	info, err := os.Stat(target)
	return err == nil && info.IsDir()
}

func imageComparablePath(value string) string {
	abs, err := filepath.Abs(value)
	if err != nil {
		abs = filepath.Clean(value)
	}
	abs = strings.TrimRight(abs, `\/`)
	if runtime.GOOS == "windows" {
		return strings.ToLower(abs)
	}
	return abs
}

// IsInsideImageRoot 必须按分隔符边界判断，否则 output2 会被误判为在 output 内。
func IsInsideImageRoot(root, target string) bool {
	if root == "" || target == "" {
		return false
	}
	base := imageComparablePath(root)
	child := imageComparablePath(target)
	if child == base {
		return true
	}
	return strings.HasPrefix(child, base+string(filepath.Separator))
}

func nearestExistingImageDir(dir string, maxUp int) string {
	current, err := filepath.Abs(dir)
	if err != nil {
		current = filepath.Clean(dir)
	}
	for i := 0; i <= maxUp; i++ {
		if isDir(current) {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

func listImageDir(dir string) (folders []string, images []ImageEntry, total int, truncated bool, err error) {
	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		return []string{}, []ImageEntry{}, 0, false, readErr
	}
	folders = make([]string, 0, len(entries))
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			folders = append(folders, entry.Name())
			continue
		}
		if !isImageName(entry.Name()) {
			continue
		}
		if len(names) >= ImageScanLimit {
			truncated = true
			break
		}
		names = append(names, entry.Name())
	}
	sort.Strings(folders)
	sort.Strings(names)
	total = len(names)
	if total > ImageReturnLimit {
		truncated = true
		names = names[:ImageReturnLimit]
	}
	images = make([]ImageEntry, 0, len(names))
	for _, name := range names {
		info, statErr := os.Stat(filepath.Join(dir, name))
		if statErr != nil {
			continue
		}
		images = append(images, ImageEntry{Name: name, Size: info.Size(), Mtime: info.ModTime().UnixMilli()})
	}
	return folders, images, total, truncated, nil
}

func imageETag(size int64, mtimeMs int64) string {
	return `"` + strconv.FormatInt(size, 10) + "-" + strconv.FormatInt(mtimeMs, 10) + `"`
}

// PlanImageDelete 同 TS 的 planDelete：绝对路径、根内、图片扩展名、常规文件、去重、条数上限。
func PlanImageDelete(rawPaths any, root string) ([]string, []FailedFile) {
	accepted := make([]string, 0)
	failed := make([]FailedFile, 0)
	seen := map[string]bool{}

	items, ok := rawPaths.([]any)
	if !ok {
		return accepted, append(failed, FailedFile{Error: "paths 必须是数组"})
	}
	if root == "" {
		return accepted, append(failed, FailedFile{Error: "未设置根目录"})
	}

	for index, item := range items {
		if index >= ImageDeleteLimit {
			failed = append(failed, FailedFile{Error: "单次最多删除 500 张"})
			break
		}
		target, ok := item.(string)
		target = strings.TrimSpace(target)
		if !ok || target == "" {
			failed = append(failed, FailedFile{Path: target, Error: "路径无效"})
			continue
		}
		if !filepath.IsAbs(target) {
			failed = append(failed, FailedFile{Path: target, Error: "必须是绝对路径"})
			continue
		}
		if !isImageName(target) {
			failed = append(failed, FailedFile{Path: target, Error: "不是支持的图片格式"})
			continue
		}
		if !IsInsideImageRoot(root, target) {
			failed = append(failed, FailedFile{Path: target, Error: "不在默认根目录内"})
			continue
		}
		key := target
		if runtime.GOOS == "windows" {
			key = strings.ToLower(target)
		}
		if seen[key] {
			failed = append(failed, FailedFile{Path: target, Error: "重复路径"})
			continue
		}
		seen[key] = true

		info, statErr := os.Lstat(target)
		if statErr != nil {
			failed = append(failed, FailedFile{Path: target, Error: "文件不存在"})
			continue
		}
		if !info.Mode().IsRegular() {
			failed = append(failed, FailedFile{Path: target, Error: "只允许删除常规文件"})
			continue
		}
		accepted = append(accepted, target)
	}
	return accepted, failed
}

// ---- settings ----

type imageSettings struct {
	RootDir      string
	TrashEnabled bool
}

func (h *ImageHandler) settingsPath() string {
	return filepath.Join(h.RepoRoot, "data", "image-settings.json")
}

func (h *ImageHandler) readSettings() imageSettings {
	// 缺省 trashEnabled = true：老存档没有这个字段时仍然走回收站（更安全）
	settings := imageSettings{TrashEnabled: true}
	data, ok := storage.ReadJSONFile(h.settingsPath())
	if !ok {
		return settings
	}
	if root, ok := data["rootDir"].(string); ok {
		settings.RootDir = root
	}
	if enabled, ok := data["trashEnabled"].(bool); ok {
		settings.TrashEnabled = enabled
	}
	return settings
}

func (h *ImageHandler) writeSettings(next imageSettings) error {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	file := h.settingsPath()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return storage.AtomicWriteJSON(file, map[string]any{
		"rootDir":      next.RootDir,
		"trashEnabled": next.TrashEnabled,
	})
}

// ---- ComfyUI 输出目录探测 ----

func (h *ImageHandler) httpClient() *http.Client {
	if h.Client != nil {
		return h.Client
	}
	return &http.Client{Timeout: imageDetectTimeout}
}

func (h *ImageHandler) fetchComfyArgv() []string {
	if !IsLocalComfyTarget(h.ComfyBase) {
		return nil
	}
	base := strings.TrimRight(h.ComfyBase, "/")
	req, err := http.NewRequest(http.MethodGet, base+"/api/system_stats", nil)
	if err != nil {
		return nil
	}
	resp, err := h.httpClient().Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil
	}
	body, err := storage.ParseJSONObject(raw)
	if err != nil {
		return nil
	}
	system, _ := body["system"].(map[string]any)
	argvRaw, _ := system["argv"].([]any)
	argv := make([]string, 0, len(argvRaw))
	for _, item := range argvRaw {
		if text, ok := item.(string); ok {
			argv = append(argv, text)
		}
	}
	return argv
}

func (h *ImageHandler) detectOutputDir() imageDetected {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cacheKey == h.ComfyBase && !h.cacheAt.IsZero() && time.Since(h.cacheAt) < imageDetectCache {
		return h.cacheVal
	}
	argv := h.fetchComfyArgv()
	value := imageDetected{Source: "none"}
	if argv != nil {
		value = DetectImageOutputDir(argv, os.Getenv("COMFYUI_OUTPUT_DIR"))
	}
	h.cacheKey = h.ComfyBase
	h.cacheAt = time.Now()
	h.cacheVal = value
	return value
}

func (h *ImageHandler) resolveConfig() imageConfig {
	settings := h.readSettings()
	saved := settings.RootDir
	detected := h.detectOutputDir()
	outputExists := isDir(detected.Dir)

	if isDir(saved) {
		return imageConfig{
			RootDir:         saved,
			RootSource:      "saved",
			SavedRootDir:    saved,
			OutputDir:       detected.Dir,
			OutputDirSource: detected.Source,
			OutputDirExists: outputExists,
			RootExists:      true,
			TrashEnabled:    settings.TrashEnabled,
		}
	}
	if outputExists {
		return imageConfig{
			RootDir:         detected.Dir,
			RootSource:      "detected",
			SavedRootDir:    saved,
			OutputDir:       detected.Dir,
			OutputDirSource: detected.Source,
			OutputDirExists: true,
			RootExists:      true,
			TrashEnabled:    settings.TrashEnabled,
		}
	}
	return imageConfig{
		RootDir:         "",
		RootSource:      "none",
		SavedRootDir:    saved,
		OutputDir:       detected.Dir,
		OutputDirSource: detected.Source,
		OutputDirExists: false,
		RootExists:      false,
		TrashEnabled:    settings.TrashEnabled,
	}
}

func listImageDrives() []string {
	drives := make([]string, 0, 26)
	if runtime.GOOS != "windows" {
		return append(drives, "/")
	}
	for letter := 'A'; letter <= 'Z'; letter++ {
		root := string(letter) + `:\`
		if isDir(root) {
			drives = append(drives, root)
		}
	}
	return drives
}

func imageConfigPayload(config imageConfig, drives []string) map[string]any {
	return map[string]any{
		"success":         true,
		"rootDir":         config.RootDir,
		"rootSource":      config.RootSource,
		"savedRootDir":    config.SavedRootDir,
		"outputDir":       config.OutputDir,
		"outputDirSource": config.OutputDirSource,
		"outputDirExists": config.OutputDirExists,
		"rootExists":      config.RootExists,
		"trashEnabled":    config.TrashEnabled,
		"drives":          drives,
	}
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func sameOriginRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := r.Host
	if name, _, splitErr := net.SplitHostPort(host); splitErr == nil {
		host = name
	}
	return strings.EqualFold(parsed.Hostname(), host)
}

// HandleService 返回外置图片管理页地址（主应用专用；页面本身在独立端口）。
func (h *ImageHandler) HandleService(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}
	url := ""
	if h.ServiceURL != nil {
		url = h.ServiceURL()
	}
	if url == "" {
		storage.SendJSON(w, 200, map[string]any{"success": false, "error": "图片管理服务未启动"})
		return
	}
	storage.SendJSON(w, 200, map[string]any{"success": true, "url": url})
}

// HandleConfig 处理 /xyz/images/config。
func (h *ImageHandler) HandleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		storage.SendJSON(w, 200, imageConfigPayload(h.resolveConfig(), listImageDrives()))
	case http.MethodPost:
		h.saveConfig(w, r)
	default:
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
	}
}

func (h *ImageHandler) saveConfig(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "仅允许本机操作"})
		return
	}
	body, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
	if err != nil {
		storage.SendError(w, err, 400)
		return
	}
	settings := h.readSettings()
	changed := false

	if raw, ok := body["rootDir"].(string); ok {
		next := strings.TrimSpace(raw)
		if next != "" {
			if !filepath.IsAbs(next) {
				storage.SendJSON(w, 400, map[string]any{"success": false, "error": "rootDir 必须是绝对路径"})
				return
			}
			if !isDir(next) {
				storage.SendJSON(w, 400, map[string]any{"success": false, "error": "目录不存在"})
				return
			}
		}
		settings.RootDir = next
		changed = true
	}
	if enabled, ok := body["trashEnabled"].(bool); ok {
		settings.TrashEnabled = enabled
		changed = true
	}
	if !changed {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "rootDir 或 trashEnabled 至少提供一个"})
		return
	}

	if err := h.writeSettings(settings); err != nil {
		storage.SendJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
		return
	}
	storage.SendJSON(w, 200, imageConfigPayload(h.resolveConfig(), listImageDrives()))
}

// HandleBrowse 处理 /xyz/images/browse。
func (h *ImageHandler) HandleBrowse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("dir"))
	config := h.resolveConfig()

	target := ""
	if raw != "" {
		if !filepath.IsAbs(raw) {
			h.sendBrowse(w, false, raw, nil, []string{}, []ImageEntry{}, 0, false, "dir 必须是绝对路径", config.RootDir)
			return
		}
		abs, err := filepath.Abs(raw)
		if err != nil {
			h.sendBrowse(w, false, raw, nil, []string{}, []ImageEntry{}, 0, false, err.Error(), config.RootDir)
			return
		}
		target = abs
	} else {
		target = config.RootDir
	}

	if target == "" {
		h.sendBrowse(w, false, "", nil, []string{}, []ImageEntry{}, 0, false, "未设置根目录", "")
		return
	}

	folders, images, total, truncated, err := listImageDir(target)
	if err != nil {
		h.sendBrowse(w, false, target, nil, []string{}, []ImageEntry{}, 0, false, err.Error(), nearestExistingImageDir(target, 8))
		return
	}
	parent := filepath.Dir(target)
	if parent == target {
		h.sendBrowse(w, true, target, nil, folders, images, total, truncated, "", "")
		return
	}
	h.sendBrowse(w, true, target, parent, folders, images, total, truncated, "", "")
}

func (h *ImageHandler) sendBrowse(
	w http.ResponseWriter,
	success bool,
	dir string,
	parent any,
	folders []string,
	images []ImageEntry,
	total int,
	truncated bool,
	errMsg string,
	nearest string,
) {
	storage.SendJSON(w, 200, map[string]any{
		"success":   success,
		"dir":       dir,
		"parent":    parent,
		"folders":   folders,
		"images":    images,
		"total":     total,
		"truncated": truncated,
		"error":     errMsg,
		"nearest":   nearest,
	})
}

// HandleFile 处理 /xyz/images/file（GET/HEAD）。
func (h *ImageHandler) HandleFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("path"))
	if raw == "" || !filepath.IsAbs(raw) {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "path 必须是绝对路径"})
		return
	}
	if !isImageName(raw) {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "不是支持的图片格式"})
		return
	}
	config := h.resolveConfig()
	if config.RootDir == "" {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "未设置根目录"})
		return
	}
	if !IsInsideImageRoot(config.RootDir, raw) {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "path 不在默认根目录内"})
		return
	}
	info, err := os.Lstat(raw)
	if err != nil || !info.Mode().IsRegular() {
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "文件不存在"})
		return
	}
	if info.Size() > ImageMaxFileBytes {
		storage.SendJSON(w, 413, map[string]any{"success": false, "error": "图片超过 30MB"})
		return
	}
	file, err := os.Open(raw)
	if err != nil {
		storage.SendJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer func() { _ = file.Close() }()

	w.Header().Set("Content-Type", imageMimeOf(raw))
	w.Header().Set("ETag", imageETag(info.Size(), info.ModTime().UnixMilli()))
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// ServeContent 自带 Range/HEAD/If-None-Match（ETag 由上面这行提供），是 Go 侧的超集能力。
	http.ServeContent(w, r, "", info.ModTime(), file)
}

// HandleDelete 处理 /xyz/images/delete。
func (h *ImageHandler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}
	if !isLoopbackRequest(r) {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "仅允许本机操作"})
		return
	}
	if !sameOriginRequest(r) {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "跨源请求被拒绝"})
		return
	}
	if !strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		storage.SendJSON(w, 415, map[string]any{"success": false, "error": "需要 application/json"})
		return
	}
	body, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
	if err != nil {
		storage.SendError(w, err, 400)
		return
	}
	paths, ok := body["paths"]
	if !ok {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "paths 必须是数组"})
		return
	}
	config := h.resolveConfig()
	if config.RootDir == "" {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "未设置根目录"})
		return
	}

	accepted, failed := PlanImageDelete(paths, config.RootDir)
	var mode string
	if config.TrashEnabled {
		mode = "trash"
		trash := h.TrashFunc
		if trash == nil {
			trash = MoveToRecycleBin
		}
		if len(accepted) > 0 {
			failed = append(failed, trash(accepted)...)
		}
	} else {
		mode = "delete"
		failed = append(failed, removeImageFiles(accepted)...)
	}
	deleted := make([]string, 0, len(accepted))
	failedSet := make(map[string]bool, len(failed))
	for _, item := range failed {
		if item.Path != "" {
			failedSet[strings.ToLower(item.Path)] = true
		}
	}
	for _, path := range accepted {
		if !failedSet[strings.ToLower(path)] {
			deleted = append(deleted, path)
		}
	}

	storage.SendJSON(w, 200, map[string]any{
		"success": true,
		"deleted": deleted,
		"failed":  failed,
		"mode":    mode,
	})
}

/** 永久删除：只有用户关掉「移到回收站」才会走这里。 */
func removeImageFiles(paths []string) []FailedFile {
	failed := make([]FailedFile, 0)
	for _, path := range paths {
		if err := os.Remove(path); err != nil {
			failed = append(failed, FailedFile{Path: path, Error: err.Error()})
		}
	}
	return failed
}
