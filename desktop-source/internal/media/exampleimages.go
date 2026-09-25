package media

// exampleimages.go 移植 server/exampleImages.ts：
// LoRA/Embedding 示例图下载队列（status/check/download/force-download/pause/resume/stop/open-folder）
// 与本地文件列表/Range 文件服务。SSOT 是 TS 源；行为存疑时以它为准。

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

var (
	supportedImageExts = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true, ".bmp": true, ".avif": true}
	supportedVideoExts = map[string]bool{".mp4": true, ".webm": true, ".mov": true, ".m4v": true}
	supportedExts      = func() map[string]bool {
		m := map[string]bool{}
		for k := range supportedImageExts {
			m[k] = true
		}
		for k := range supportedVideoExts {
			m[k] = true
		}
		return m
	}()
	mimeByExt = map[string]string{
		".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
		".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif",
		".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
	}
	extByContentType = map[string]string{
		"image/jpeg": ".jpeg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp",
		"image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif",
		"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-m4v": ".m4v",
	}
	hashRe    = regexp.MustCompile(`^[a-f0-9]{64}$`)
	nowMsFunc = func() float64 { return float64(time.Now().UnixMilli()) / 1000 }
)

// ExampleProgress 对齐 ExampleProgress。
type ExampleProgress struct {
	Total             int      `json:"total"`
	Completed         int      `json:"completed"`
	CurrentModel      string   `json:"current_model"`
	Status            string   `json:"status"`
	Errors            []string `json:"errors"`
	LastError         *string  `json:"last_error"`
	StartTime         *float64 `json:"start_time"`
	EndTime           *float64 `json:"end_time"`
	ProcessedModels   []string `json:"processed_models"`
	RefreshedModels   []string `json:"refreshed_models"`
	FailedModels      []string `json:"failed_models"`
	ReprocessedModels []string `json:"reprocessed_models"`
}

// LocalExampleFile 对齐 LocalExampleFile。
type LocalExampleFile struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Extension string `json:"extension"`
	IsVideo   bool   `json:"is_video"`
	Type      string `json:"type"`
	Source    string `json:"source"`
}

// DownloadMedia 对齐 DownloadMedia。
type DownloadMedia struct {
	URL    string `json:"url"`
	Index  int    `json:"index"`
	ID     any    `json:"id,omitempty"`
	Source string `json:"source"`
	Type   string `json:"type,omitempty"`
}

// DownloadResult 对齐 DownloadResult。
type DownloadResult struct {
	Hash       string             `json:"hash"`
	OK         bool               `json:"ok"`
	Files      []LocalExampleFile `json:"files"`
	Downloaded int                `json:"downloaded"`
	Skipped    int                `json:"skipped"`
	Errors     []string           `json:"errors"`
	NoMedia    bool               `json:"no_media"`
}

// LoraItem 对齐 LoraItem（宽松对象）。
type LoraItem struct {
	ModelType string         `json:"model_type,omitempty"`
	SHA256    string         `json:"sha256,omitempty"`
	FilePath  string         `json:"file_path,omitempty"`
	FileName  string         `json:"file_name,omitempty"`
	ModelName string         `json:"model_name,omitempty"`
	Civitai   map[string]any `json:"civitai,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	raw       map[string]any
}

type exampleJob struct {
	mu            sync.Mutex
	running       bool
	paused        bool
	stopRequested bool
	progress      ExampleProgress
	results       map[string]DownloadResult
}

// Manager 持有示例图模块的全局状态（activeJob / lastProgress / cachedRoot）。
type Manager struct {
	mu         sync.Mutex
	active     *exampleJob
	lastProg   ExampleProgress
	cachedRoot string
	ComfyBase  string
	client     *http.Client
}

func NewManager(comfyBase string) *Manager {
	return &Manager{
		ComfyBase: comfyBase,
		lastProg:  makeProgress(0, "idle"),
		client:    &http.Client{Timeout: 120 * time.Second},
	}
}

func makeProgress(total int, status string) ExampleProgress {
	p := ExampleProgress{
		Total: total, Completed: 0, CurrentModel: "", Status: status,
		Errors: []string{}, LastError: nil,
		ProcessedModels: []string{}, RefreshedModels: []string{},
		FailedModels: []string{}, ReprocessedModels: []string{},
	}
	if status != "idle" {
		t := nowMsFunc()
		p.StartTime = &t
	}
	return p
}

// ---- 对外入口：/xyz/example* 全部端点 ----

func (m *Manager) Handle(w http.ResponseWriter, r *http.Request) {
	pathName := r.URL.Path
	method := r.Method
	if method == "" {
		method = "GET"
	}

	switch {
	case method == "GET" && pathName == "/xyz/example-images/status":
		storage.SendJSON(w, 200, m.currentStatusPayload())

	case method == "POST" && pathName == "/xyz/example-images/check":
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		modelTypes := normalizeModelTypes(payload["model_types"], payload["modelTypes"])
		result, err := m.checkExampleImagesNeeded(modelTypes)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		storage.SendJSON(w, 200, result)

	case method == "POST" && pathName == "/xyz/example-images/download":
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		started, err := m.tryStart(payload)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		if !started {
			storage.SendJSON(w, 409, map[string]any{"success": false, "error": "Example image download is already running", "status": m.statusSnapshot()})
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "message": "Example image download started", "status": m.statusSnapshot()})

	case method == "POST" && pathName == "/xyz/example-images/force-download":
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		started, err := m.tryStart(payload)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		if !started {
			storage.SendJSON(w, 409, map[string]any{"success": false, "error": "Example image download is already running", "status": m.statusSnapshot()})
			return
		}
		// 同步等待完成（对齐 TS：force-download 在请求内跑完）
		result := m.waitActive()
		success := result.status.Status != "error" && result.status.Status != "stopped"
		msg := "Example images downloaded"
		if !success {
			if result.status.LastError != nil {
				msg = *result.status.LastError
			} else {
				msg = "Example image download failed"
			}
		}
		resp := map[string]any{"success": success, "message": msg, "status": result.status, "result": result.results}
		if !success {
			resp["error"] = result.status.LastError
		}
		code := 200
		if !success {
			code = 500
		}
		storage.SendJSON(w, code, resp)

	case method == "POST" && pathName == "/xyz/example-images/pause":
		m.controlJob(func(j *exampleJob) { j.paused = true; j.progress.Status = "paused" })
		storage.SendJSON(w, 200, map[string]any{"success": true, "status": m.statusSnapshot()})

	case method == "POST" && pathName == "/xyz/example-images/resume":
		m.controlJob(func(j *exampleJob) { j.paused = false; j.progress.Status = "running" })
		storage.SendJSON(w, 200, map[string]any{"success": true, "status": m.statusSnapshot()})

	case method == "POST" && pathName == "/xyz/example-images/stop":
		m.controlJob(func(j *exampleJob) { j.stopRequested = true; j.paused = false; j.progress.Status = "stopping" })
		storage.SendJSON(w, 200, map[string]any{"success": true, "status": m.statusSnapshot()})

	case method == "POST" && pathName == "/xyz/example-images/open-folder":
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		hash := normalizeHash(payload["model_hash"], payload["modelHash"])
		if hash == "" {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Missing model_hash parameter"})
			return
		}
		root, err := m.exampleImagesRoot()
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		folder, err := safeResolve(root, hash)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		_ = os.MkdirAll(folder, 0o755)
		openFolder(folder)
		storage.SendJSON(w, 200, map[string]any{"success": true, "path": folder, "mode": "system"})

	case method == "GET" && pathName == "/xyz/example-image-files":
		hash := normalizeHash(r.URL.Query().Get("model_hash"))
		if hash == "" {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Missing model_hash parameter", "files": []any{}})
			return
		}
		root, err := m.exampleImagesRoot()
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		files, err := listLocalExampleFiles(root, hash)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "files": files})

	case (method == "GET" || method == "HEAD") && strings.HasPrefix(pathName, "/xyz/example-images/file/"):
		m.serveExampleFile(w, r)

	default:
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown xyz example images endpoint"})
	}
}

// ---- 状态与任务控制 ----

func (m *Manager) currentStatusPayload() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	progress := m.lastProg
	isDownloading := false
	if m.active != nil {
		isDownloading = m.active.running
		m.active.mu.Lock()
		progress = m.active.progress
		m.active.mu.Unlock()
	}
	return map[string]any{
		"success":        true,
		"is_downloading": isDownloading,
		"is_migrating":   false,
		"status":         progress,
	}
}

func (m *Manager) statusSnapshot() ExampleProgress {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		m.active.mu.Lock()
		defer m.active.mu.Unlock()
		return m.active.progress
	}
	return m.lastProg
}

func (m *Manager) controlJob(fn func(j *exampleJob)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		m.active.mu.Lock()
		fn(m.active)
		m.active.mu.Unlock()
	}
}

// tryStart 对齐 download/force-download 的公共前半段：running 时返回 (false, nil)（调用方回 409）；
// 解析 items 失败返回错误（调用方回 500）；成功则开启任务（后台跑）并返回 (true, nil)。
func (m *Manager) tryStart(payload map[string]any) (bool, error) {
	m.mu.Lock()
	if m.active != nil && m.active.running {
		m.mu.Unlock()
		return false, nil
	}
	m.mu.Unlock()

	items, err := m.resolveDownloadItems(payload)
	if err != nil {
		return false, err
	}
	force := true
	if f, ok := payload["force"].(bool); ok {
		force = f
	}
	job := &exampleJob{
		running:  true,
		progress: makeProgress(len(items), "running"),
		results:  map[string]DownloadResult{},
	}
	m.mu.Lock()
	if m.active != nil && m.active.running {
		m.mu.Unlock()
		return false, nil // 竞态复核
	}
	m.active = job
	m.mu.Unlock()
	go func() {
		if err := m.runDownloadJob(job, items, force); err != nil {
			m.failJob(job, err.Error())
		}
	}()
	return true, nil
}

type jobOutcome struct {
	status  ExampleProgress
	results map[string]DownloadResult
}

// waitActive 等待当前 active 任务结束并返回结果（force-download 用）。
func (m *Manager) waitActive() jobOutcome {
	for {
		m.mu.Lock()
		job := m.active
		m.mu.Unlock()
		if job == nil {
			m.mu.Lock()
			defer m.mu.Unlock()
			return jobOutcome{status: m.lastProg, results: map[string]DownloadResult{}}
		}
		job.mu.Lock()
		running := job.running
		progress := job.progress
		results := job.results
		job.mu.Unlock()
		if !running {
			return jobOutcome{status: progress, results: results}
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func (m *Manager) failJob(job *exampleJob, message string) {
	job.mu.Lock()
	job.running = false
	job.progress.Status = "error"
	msg := message
	job.progress.LastError = &msg
	job.progress.Errors = append(job.progress.Errors, message)
	t := nowMsFunc()
	job.progress.EndTime = &t
	job.mu.Unlock()
	m.mu.Lock()
	if m.active == job {
		m.lastProg = job.progress
		m.active = nil
	}
	m.mu.Unlock()
}

func (m *Manager) runDownloadJob(job *exampleJob, items []LoraItem, force bool) error {
	root, err := m.exampleImagesRoot()
	if err != nil {
		return err
	}
	for _, item := range items {
		m.waitForJob(job)
		job.mu.Lock()
		stop := job.stopRequested
		job.mu.Unlock()
		if stop {
			break
		}

		hash := normalizeHash(item.SHA256)
		job.mu.Lock()
		job.progress.CurrentModel = item.ModelName
		if job.progress.CurrentModel == "" {
			job.progress.CurrentModel = item.FileName
		}
		if job.progress.CurrentModel == "" {
			job.progress.CurrentModel = hash
		}
		job.progress.Status = "running"
		job.mu.Unlock()

		result := m.downloadExamplesForItem(root, item, force)
		job.mu.Lock()
		job.results[result.Hash] = result
		job.progress.Completed++
		if result.OK {
			job.progress.ProcessedModels = append(job.progress.ProcessedModels, result.Hash)
			if force && result.Downloaded > 0 {
				job.progress.ReprocessedModels = append(job.progress.ReprocessedModels, result.Hash)
			}
		} else {
			job.progress.FailedModels = append(job.progress.FailedModels, result.Hash)
			job.progress.Errors = append(job.progress.Errors, result.Errors...)
			if len(result.Errors) > 0 {
				last := result.Errors[len(result.Errors)-1]
				job.progress.LastError = &last
			} else {
				def := "Example image download failed"
				job.progress.LastError = &def
			}
		}
		job.mu.Unlock()
	}

	job.mu.Lock()
	if job.stopRequested {
		job.progress.Status = "stopped"
		msg := "Example image download stopped"
		job.progress.LastError = &msg
	} else if len(job.progress.FailedModels) > 0 {
		job.progress.Status = "error"
		if job.progress.LastError == nil {
			msg := fmt.Sprintf("%d model(s) failed", len(job.progress.FailedModels))
			job.progress.LastError = &msg
		}
	} else {
		job.progress.Status = "completed"
	}
	t := nowMsFunc()
	job.progress.EndTime = &t
	job.running = false
	progress := job.progress
	job.mu.Unlock()

	m.mu.Lock()
	if m.active == job {
		m.lastProg = progress
		m.active = nil
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) waitForJob(job *exampleJob) {
	for {
		job.mu.Lock()
		wait := job.running && job.paused && !job.stopRequested
		job.mu.Unlock()
		if !wait {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ---- ComfyUI LoRA Manager API ----

func (m *Manager) comfyGetJSON(endpoint string) (map[string]any, error) {
	base, err := url.Parse(m.ComfyBase)
	if err != nil {
		return nil, err
	}
	ref, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	resp, err := m.client.Get(base.ResolveReference(ref).String())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s %d: %s", endpoint, resp.StatusCode, truncate(string(body), 200))
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (m *Manager) listAllModels(modelTypes []string) ([]LoraItem, error) {
	var all []LoraItem
	for _, modelType := range modelTypes {
		page := 1
		for {
			q := fmt.Sprintf("/api/lm/%s/list?page=%d&page_size=100&sort_by=name", modelType, page)
			data, err := m.comfyGetJSON(q)
			if err != nil {
				return nil, err
			}
			rawItems, _ := data["items"].([]any)
			for _, raw := range rawItems {
				obj, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				all = append(all, normalizeDownloadItem(obj, modelType))
			}
			totalPages := 1.0
			if tp, ok := data["total_pages"].(float64); ok && tp >= 1 {
				totalPages = tp
			}
			page++
			if len(rawItems) == 0 || float64(page) > totalPages {
				break
			}
		}
	}
	return dedupeDownloadItems(all), nil
}

func normalizeDownloadItem(obj map[string]any, fallbackModelType string) LoraItem {
	mt := normalizeModelType(firstString(obj, "model_type", "modelType", "type"))
	if mt == "" {
		mt = fallbackModelType
	}
	item := LoraItem{
		ModelType: mt,
		SHA256:    normalizeHash(firstString(obj, "sha256", "hash", "model_hash")),
		FilePath:  firstString(obj, "file_path", "filePath"),
		FileName:  firstString(obj, "file_name", "fileName"),
		ModelName: firstString(obj, "model_name", "modelName"),
		raw:       obj,
	}
	if civ, ok := obj["civitai"].(map[string]any); ok {
		item.Civitai = civ
	}
	if md, ok := obj["metadata"].(map[string]any); ok {
		item.Metadata = md
	}
	return item
}

func firstString(obj map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := obj[k]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func dedupeDownloadItems(items []LoraItem) []LoraItem {
	seen := map[string]bool{}
	var out []LoraItem
	for _, item := range items {
		hash := normalizeHash(item.SHA256)
		if hash == "" {
			continue
		}
		mt := item.ModelType
		if mt == "" {
			mt = "loras"
		}
		key := mt + ":" + hash
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func (m *Manager) resolveDownloadItems(payload map[string]any) ([]LoraItem, error) {
	modelTypes := normalizeModelTypes(payload["model_types"], payload["modelTypes"])

	var rawItems []any
	if arr, ok := payload["items"].([]any); ok {
		rawItems = arr
	}
	var itemsFromPayload []LoraItem
	for _, raw := range rawItems {
		obj, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		item := normalizeDownloadItem(obj, modelTypes[0])
		if normalizeHash(item.SHA256) != "" {
			itemsFromPayload = append(itemsFromPayload, item)
		}
	}
	hashes := map[string]bool{}
	if arr, ok := payload["model_hashes"].([]any); ok {
		for _, h := range arr {
			if s, ok := h.(string); ok {
				if hash := normalizeHash(s); hash != "" {
					hashes[hash] = true
				}
			}
		}
	}

	if len(itemsFromPayload) > 0 {
		if len(hashes) == 0 {
			return dedupeDownloadItems(itemsFromPayload), nil
		}
		var filtered []LoraItem
		for _, item := range itemsFromPayload {
			if hashes[normalizeHash(item.SHA256)] {
				filtered = append(filtered, item)
			}
		}
		return dedupeDownloadItems(filtered), nil
	}

	listed, err := m.listAllModels(modelTypes)
	if err != nil {
		return nil, err
	}
	if len(hashes) > 0 {
		var filtered []LoraItem
		for _, item := range listed {
			if hashes[normalizeHash(item.SHA256)] {
				filtered = append(filtered, item)
			}
		}
		return dedupeDownloadItems(filtered), nil
	}
	return dedupeDownloadItems(listed), nil
}

func (m *Manager) checkExampleImagesNeeded(modelTypes []string) (map[string]any, error) {
	items, err := m.listAllModels(modelTypes)
	if err != nil {
		return nil, err
	}
	root, err := m.exampleImagesRoot()
	if err != nil {
		return nil, err
	}
	var pending, processed, failed int
	for _, item := range items {
		hash := normalizeHash(item.SHA256)
		if hash == "" {
			failed++
			continue
		}
		localFiles, err := listLocalExampleFiles(root, hash)
		if err != nil {
			return nil, err
		}
		if len(localFiles) > 0 {
			processed++
			continue
		}
		metadata, err := m.getModelMetadata(item)
		var media []DownloadMedia
		if err == nil {
			media = extractRemoteMedia(metadata, item)
		}
		if len(media) > 0 {
			pending++
		} else {
			processed++
		}
	}
	m.mu.Lock()
	isDownloading := m.active != nil && m.active.running
	m.mu.Unlock()
	return map[string]any{
		"success":         true,
		"is_downloading":  isDownloading,
		"total_models":    len(items),
		"pending_count":   pending,
		"processed_count": processed,
		"failed_count":    failed,
		"needs_download":  pending > 0,
	}, nil
}

func (m *Manager) getModelMetadata(item LoraItem) (map[string]any, error) {
	if item.FilePath == "" {
		return nil, errors.New("no file_path")
	}
	modelType := item.ModelType
	if modelType == "" {
		modelType = "loras"
	}
	q := fmt.Sprintf("/api/lm/%s/metadata?file_path=%s", modelType, url.QueryEscape(item.FilePath))
	data, err := m.comfyGetJSON(q)
	if err != nil {
		return nil, err
	}
	md, _ := data["metadata"].(map[string]any)
	return md, nil
}

func extractRemoteMedia(metadata map[string]any, item LoraItem) []DownloadMedia {
	sources := []map[string]any{}
	if metadata != nil {
		sources = append(sources, metadata)
	}
	if item.Metadata != nil {
		sources = append(sources, item.Metadata)
	}
	if item.Civitai != nil {
		sources = append(sources, item.Civitai)
	}
	for _, source := range sources {
		media := mediaFromSource(source)
		if len(media) > 0 {
			return dedupeRemoteMedia(media)
		}
	}
	return nil
}

func mediaFromSource(source map[string]any) []DownloadMedia {
	var media []DownloadMedia
	for _, key := range []string{"images", "customImages"} {
		arr, _ := source[key].([]any)
		for _, raw := range arr {
			obj, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			src := "image"
			if key == "customImages" {
				src = "custom"
			}
			if parsed := parseRemoteMedia(obj, len(media), src); parsed != nil {
				media = append(media, *parsed)
			}
		}
	}
	return media
}

func parseRemoteMedia(obj map[string]any, index int, source string) *DownloadMedia {
	candidates := firstString(obj, "url", "path", "image_url", "imageUrl", "video_url", "videoUrl")
	if !isHTTPURL(candidates) {
		return nil
	}
	// SSRF：payload 里的 metadata/civitai 可自带任意 URL，拒绝私网/回环目标
	if !IsAllowedMediaURL(candidates) {
		return nil
	}
	m := &DownloadMedia{URL: candidates, Index: index, Source: source}
	if id, ok := obj["id"]; ok {
		switch id.(type) {
		case string, float64:
			m.ID = id
		}
	}
	if t, ok := obj["type"].(string); ok {
		m.Type = t
	}
	return m
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(strings.ToLower(s), "http://") || strings.HasPrefix(strings.ToLower(s), "https://")
}

func dedupeRemoteMedia(items []DownloadMedia) []DownloadMedia {
	seen := map[string]bool{}
	var out []DownloadMedia
	for _, item := range items {
		if seen[item.URL] {
			continue
		}
		seen[item.URL] = true
		out = append(out, item)
	}
	return out
}

// ---- 下载单个模型的示例图 ----

func (m *Manager) downloadExamplesForItem(root string, item LoraItem, force bool) DownloadResult {
	hash := normalizeHash(item.SHA256)
	if hash == "" {
		return DownloadResult{Hash: "unknown", OK: false, Files: []LocalExampleFile{}, Errors: []string{"Missing SHA256 for model"}}
	}
	folder, err := safeResolve(root, hash)
	if err != nil {
		return DownloadResult{Hash: hash, OK: false, Files: []LocalExampleFile{}, Errors: []string{err.Error()}}
	}
	_ = os.MkdirAll(folder, 0o755)

	existingFiles, _ := listLocalExampleFiles(root, hash)
	metadata, mdErr := m.getModelMetadata(item)
	var mediaItems []DownloadMedia
	if mdErr == nil {
		mediaItems = extractRemoteMedia(metadata, item)
	}
	var errs []string
	downloaded, skipped := 0, 0

	if len(mediaItems) == 0 {
		return DownloadResult{Hash: hash, OK: true, Files: existingFiles, Skipped: len(existingFiles), Errors: errs, NoMedia: true}
	}

	for _, media := range mediaItems {
		stems := mediaStemCandidates(media)
		currentFiles, _ := listLocalExampleFiles(root, hash)
		if !force && anyStem(currentFiles, stems) {
			skipped++
			continue
		}
		if err := m.downloadMediaFile(media, folder, stems[0]); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %s", displayName(item, hash), err.Error()))
		} else {
			downloaded++
		}
	}

	files, _ := listLocalExampleFiles(root, hash)
	var missing []DownloadMedia
	for _, media := range mediaItems {
		if !anyStem(files, mediaStemCandidates(media)) {
			missing = append(missing, media)
		}
	}
	if len(missing) > 0 {
		errs = append(errs, fmt.Sprintf("%s: %d media file(s) were not written locally", displayName(item, hash), len(missing)))
	}

	return DownloadResult{Hash: hash, OK: len(errs) == 0, Files: files, Downloaded: downloaded, Skipped: skipped, Errors: errs}
}

func anyStem(files []LocalExampleFile, stems []string) bool {
	for _, f := range files {
		for _, s := range stems {
			if fileStem(f.Name) == s {
				return true
			}
		}
	}
	return false
}

func (m *Manager) downloadMediaFile(media DownloadMedia, folder, stem string) error {
	if err := AssertPublicMediaHost(media.URL); err != nil {
		return err
	}
	req, err := http.NewRequest("GET", media.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari")
	req.Header.Set("Referer", "https://civitai.com/")
	resp, err := MediaFetchClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s %d %s", media.URL, resp.StatusCode, http.StatusText(resp.StatusCode))
	}
	contentType := normalizeContentType(resp.Header.Get("Content-Type"))
	urlExt := extensionFromURL(media.URL)
	contentExt := extByContentType[contentType]
	ext := contentExt
	if ext == "" {
		ext = urlExt
	}
	if ext == "" {
		if isVideoMedia(media) {
			ext = ".mp4"
		} else {
			ext = ".jpeg"
		}
	}
	validBinaryType := strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "video/") ||
		contentType == "application/octet-stream" || contentType == "binary/octet-stream" || contentType == ""

	if !supportedExts[ext] || (!validBinaryType && !supportedExts[urlExt]) {
		unknown := contentType
		if unknown == "" {
			unknown = "unknown"
		}
		return fmt.Errorf("Unsupported media response type %s for %s", unknown, media.URL)
	}

	targetFile, err := safeResolve(folder, stem+ext)
	if err != nil {
		return errors.New("Resolved media path is outside the example image folder")
	}
	tempFile := fmt.Sprintf("%s.download-%d.tmp", targetFile, time.Now().UnixMilli())
	cleanup := func() { _ = os.Remove(tempFile) }

	if err := writeBodyToFile(resp.Body, tempFile); err != nil {
		cleanup()
		return err
	}
	_ = os.Remove(targetFile) // Windows 上先删旧文件避免 rename EPERM
	if err := os.Rename(tempFile, targetFile); err != nil {
		time.Sleep(500 * time.Millisecond)
		_ = os.Remove(targetFile)
		if err2 := os.Rename(tempFile, targetFile); err2 != nil {
			cleanup()
			return err2
		}
	}
	return nil
}

func writeBodyToFile(body io.Reader, target string) error {
	f, err := os.Create(target)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, body)
	return err
}

// ---- 本地文件列表与文件服务 ----

func listLocalExampleFiles(root, hash string) ([]LocalExampleFile, error) {
	folder, err := safeResolve(root, hash)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		if os.IsNotExist(err) {
			return []LocalExampleFile{}, nil
		}
		return nil, err
	}
	var files []LocalExampleFile
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !supportedExts[ext] {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.Size() <= 0 {
			continue
		}
		isVideo := supportedVideoExts[ext]
		files = append(files, LocalExampleFile{
			Name:      name,
			Path:      fmt.Sprintf("/xyz/example-images/file/%s/%s?v=%d", hash, url.PathEscape(name), info.ModTime().UnixMilli()),
			Extension: ext,
			IsVideo:   isVideo,
			Type:      map[bool]string{true: "video", false: "image"}[isVideo],
			Source:    "local",
		})
	}
	sort.Slice(files, func(i, j int) bool {
		a, b := mediaSortValue(files[i].Name), mediaSortValue(files[j].Name)
		if a != b {
			return a < b
		}
		return files[i].Name < files[j].Name
	})
	return files, nil
}

func (m *Manager) serveExampleFile(w http.ResponseWriter, r *http.Request) {
	re := regexp.MustCompile(`^/xyz/example-images/file/([^/]+)/(.+)$`)
	match := re.FindStringSubmatch(r.URL.Path)
	if match == nil {
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Example image file not found"})
		return
	}
	hash := normalizeHash(mustUnescape(match[1]))
	decodedName := mustUnescape(match[2])
	fileName := filepath.Base(decodedName)
	normalizedName := decodedName
	if hash == "" || fileName == "" || fileName != lastPathSegment(normalizedName) {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Invalid example image path"})
		return
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if !supportedExts[ext] {
		storage.SendJSON(w, 415, map[string]any{"success": false, "error": "Unsupported example media type"})
		return
	}
	root, err := m.exampleImagesRoot()
	if err != nil {
		storage.SendError(w, err, 500)
		return
	}
	folder, err := safeResolve(root, hash)
	if err != nil {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Invalid example image path"})
		return
	}
	filePath, err := safeResolve(folder, fileName)
	if err != nil {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Invalid example image path"})
		return
	}
	info, err := os.Stat(filePath)
	if err != nil {
		storage.SendError(w, err, 500)
		return
	}
	ct := mimeByExt[ext]
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, max-age=60")

	rng := parseRange(r.Header.Get("Range"), info.Size())
	if rng != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", rng.start, rng.end, info.Size()))
		w.Header().Set("Content-Length", strconv.FormatInt(rng.end-rng.start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		if r.Method == "HEAD" {
			return
		}
		http.ServeContent(w, r, "", info.ModTime(), newBytesRangeReader(filePath, rng.start, rng.end))
		return
	}
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(http.StatusOK)
	if r.Method == "HEAD" {
		return
	}
	http.ServeFile(w, r, filePath)
}

// bytesRangeReader 提供 [start,end] 区间读取（ServeContent 需 ReadSeeker）。
type bytesRangeReader struct {
	f     *os.File
	off   int64
	start int64
	end   int64
}

func newBytesRangeReader(path string, start, end int64) *bytesRangeReader {
	f, err := os.Open(path)
	if err != nil {
		log.Printf("media: open range reader: %v", err)
		return &bytesRangeReader{off: -1}
	}
	return &bytesRangeReader{f: f, start: start, end: end, off: start}
}

func (b *bytesRangeReader) Read(p []byte) (int, error) {
	if b.off < 0 || b.off > b.end {
		return 0, io.EOF
	}
	if b.off+int64(len(p)) > b.end+1 {
		p = p[:b.end-b.off+1]
	}
	n, err := b.f.ReadAt(p, b.off)
	b.off += int64(n)
	return n, err
}

func (b *bytesRangeReader) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekStart:
		b.off = b.start + offset
	case io.SeekCurrent:
		b.off += offset
	}
	return b.off, nil
}

func lastPathSegment(s string) string {
	s = strings.ReplaceAll(s, "\\", "/")
	parts := strings.Split(s, "/")
	return parts[len(parts)-1]
}

func mustUnescape(s string) string {
	if v, err := url.PathUnescape(s); err == nil {
		return v
	}
	return s
}

// ---- 根目录与工具 ----

func (m *Manager) exampleImagesRoot() (string, error) {
	data, err := m.comfyGetJSON("/api/lm/settings")
	if err == nil {
		settings, ok := data["settings"].(map[string]any)
		if !ok {
			settings = data
		}
		root := ""
		if v, ok := settings["example_images_path"].(string); ok {
			root = strings.TrimSpace(v)
		}
		if root != "" {
			resolved, aerr := filepath.Abs(root)
			if aerr == nil {
				_ = os.MkdirAll(resolved, 0o755)
				m.mu.Lock()
				m.cachedRoot = resolved
				m.mu.Unlock()
				return resolved, nil
			}
		} else {
			err = errors.New("No example_images_path configured in LoRA Manager settings")
		}
	}
	m.mu.Lock()
	cached := m.cachedRoot
	m.mu.Unlock()
	if cached != "" {
		return cached, nil
	}
	if err != nil {
		return "", err
	}
	return "", errors.New("No example_images_path configured in LoRA Manager settings")
}

func normalizeModelTypes(values ...any) []string {
	var raw []any
	for _, v := range values {
		if v == nil {
			continue
		}
		if arr, ok := v.([]any); ok {
			raw = append(raw, arr...)
		} else {
			raw = append(raw, v)
		}
	}
	if len(raw) == 0 {
		raw = []any{"lora"}
	}
	var out []string
	for _, v := range raw {
		if mt := normalizeModelType(stringify(v)); mt != "" {
			out = append(out, mt)
		}
	}
	if len(out) == 0 {
		out = []string{"loras"}
	}
	return out
}

func normalizeModelType(v string) string {
	n := strings.ToLower(strings.TrimSpace(v))
	switch n {
	case "embedding", "embeddings":
		return "embeddings"
	case "lora", "loras":
		return "loras"
	}
	return ""
}

func stringify(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func normalizeHash(values ...any) string {
	for _, v := range values {
		s, ok := v.(string)
		if !ok {
			continue
		}
		s = strings.ToLower(strings.TrimSpace(s))
		if hashRe.MatchString(s) {
			return s
		}
	}
	return ""
}

func normalizeContentType(v string) string {
	if i := strings.Index(v, ";"); i >= 0 {
		v = v[:i]
	}
	return strings.ToLower(strings.TrimSpace(v))
}

func extensionFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(u.Path))
	if supportedExts[ext] {
		return ext
	}
	return ""
}

func isVideoMedia(media DownloadMedia) bool {
	if strings.EqualFold(media.Type, "video") {
		return true
	}
	return supportedVideoExts[extensionFromURL(media.URL)]
}

func fileStem(fileName string) string {
	ext := filepath.Ext(fileName)
	return strings.ToLower(strings.TrimSuffix(fileName, ext))
}

func mediaStemCandidates(media DownloadMedia) []string {
	imageStem := fmt.Sprintf("image_%d", media.Index)
	if media.Source == "custom" && media.ID != nil {
		return []string{safeNamePart(fmt.Sprintf("%v", media.ID)), imageStem}
	}
	return []string{imageStem}
}

func safeNamePart(v string) string {
	var b strings.Builder
	for _, c := range v {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			b.WriteRune(c)
		} else {
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "item"
	}
	return out
}

func mediaSortValue(name string) int {
	stem := fileStem(name)
	if m := regexp.MustCompile(`(?i)^image_(\d+)$`).FindStringSubmatch(stem); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	if regexp.MustCompile(`(?i)^custom_(.+)$`).MatchString(stem) {
		return 100000
	}
	return 200000
}

func safeResolve(root string, parts ...string) (string, error) {
	resolved := filepath.Clean(filepath.Join(append([]string{root}, parts...)...))
	if !isInside(resolved, root) {
		return "", errors.New("Resolved path is outside the example images root")
	}
	return resolved, nil
}

func isInside(candidate, root string) bool {
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absCandidate)
	if err != nil {
		return false
	}
	return rel == "" || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

func openFolder(folder string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", folder)
	case "darwin":
		cmd = exec.Command("open", folder)
	default:
		cmd = exec.Command("xdg-open", folder)
	}
	go func() { _ = cmd.Run() }()
}

func displayName(item LoraItem, hash string) string {
	if item.ModelName != "" {
		return item.ModelName
	}
	if item.FileName != "" {
		return item.FileName
	}
	return hash
}

type httpRange struct{ start, end int64 }

// parseRange 对齐 TS parseRange（仅 bytes= 单区间）。
func parseRange(value string, size int64) *httpRange {
	if value == "" || !strings.HasPrefix(value, "bytes=") {
		return nil
	}
	parts := strings.SplitN(value[len("bytes="):], "-", 2)
	startText, endText := parts[0], ""
	if len(parts) > 1 {
		endText = parts[1]
	}
	var start, end int64
	hasStart, hasEnd := false, false
	if startText != "" {
		if v, err := strconv.ParseInt(startText, 10, 64); err == nil {
			start, hasStart = v, true
		}
	}
	if endText != "" {
		if v, err := strconv.ParseInt(endText, 10, 64); err == nil {
			end, hasEnd = v, true
		}
	}
	if !hasStart && hasEnd {
		start = size - end
		if start < 0 {
			start = 0
		}
		end = size - 1
	} else if hasStart && !hasEnd {
		end = size - 1
	} else if !hasStart || !hasEnd {
		return nil
	}
	if start < 0 {
		start = 0
	}
	if end > size-1 {
		end = size - 1
	}
	if start > end || start >= size {
		return nil
	}
	return &httpRange{start: start, end: end}
}
