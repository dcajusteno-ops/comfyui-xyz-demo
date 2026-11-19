package noobai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	randv2 "math/rand/v2"

	"golang.org/x/sys/windows"
)

const (
	maxGenLoras   = 8
	genHistoryMax = 60
)

var errGenStopped = errors.New("生成已停止")

// LoraRef 是启用中的 LoRA 及其强度、触发词。
type LoraRef struct {
	Name         string  `json:"name"`
	Strength     float64 `json:"strength"`
	ClipStrength float64 `json:"clip_strength"`
	TriggerWords string  `json:"trigger_words"`
	AutoTrigger  bool    `json:"auto_trigger"`
	// Disabled 表示卡片被停用：仍保留在列表里，但不进工作流、不补触发词。
	Disabled bool `json:"disabled,omitempty"`
}

// GenerationSettings 是 NoobAI 面板的生图参数，独立于抽词设置。
type GenerationSettings struct {
	Checkpoint    string    `json:"checkpoint"`
	Width         int       `json:"width"`
	Height        int       `json:"height"`
	Steps         int       `json:"steps"`
	CFG           float64   `json:"cfg"`
	Sampler       string    `json:"sampler"`
	Scheduler     string    `json:"scheduler"`
	Seed          int       `json:"seed"`
	HiresEnabled  bool      `json:"hires_enabled"`
	HiresScale    float64   `json:"hires_scale"`
	HiresSteps    int       `json:"hires_steps"`
	HiresDenoise  float64   `json:"hires_denoise"`
	HiresSampler  string    `json:"hires_sampler"`
	NegativeExtra string    `json:"negative_extra"`
	Repeat        int       `json:"repeat"`
	Loras         []LoraRef `json:"loras"`
}

// GenImage 是生成结果（文件仍在 ComfyUI output，通过 /api/gen/image 代理）。
type GenImage struct {
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Seed      int    `json:"seed"`
	Prompt    string `json:"prompt"`
	Negative  string `json:"negative"`
	PromptID  string `json:"prompt_id"`
}

type genJob struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Total   int    `json:"total"`
	Done    int    `json:"done"`
	// Index 是当前正在生成的那一张（1 起）；Prompt / Negative 是它实际使用的词。
	Index    int        `json:"index"`
	Prompt   string     `json:"prompt"`
	Negative string     `json:"negative"`
	Seed     int        `json:"seed"`
	Images   []GenImage `json:"images"`
	Error    string     `json:"error"`
	// PromptID 用于把 ComfyUI 的采样进度对到当前这张图上。
	PromptID string `json:"prompt_id"`
	// ProgressValue / ProgressTotal 是采样步数进度；Total 先按设置估好，避免第二段采样时进度倒退。
	ProgressValue int    `json:"progress_value"`
	ProgressTotal int    `json:"progress_total"`
	ProgressNode  string `json:"progress_node"`
	StartedAt     string `json:"started_at"`
}

func (j genJob) clone() genJob {
	out := j
	out.Images = append([]GenImage{}, j.Images...)
	return out
}

func (j genJob) payload() map[string]interface{} {
	images := j.Images
	if images == nil {
		images = []GenImage{}
	}
	return map[string]interface{}{
		"id":             j.ID,
		"status":         j.Status,
		"message":        j.Message,
		"total":          j.Total,
		"done":           j.Done,
		"index":          j.Index,
		"prompt":         j.Prompt,
		"negative":       j.Negative,
		"seed":           j.Seed,
		"images":         images,
		"error":          j.Error,
		"prompt_id":      j.PromptID,
		"progress_value": j.ProgressValue,
		"progress_total": j.ProgressTotal,
		"progress_node":  j.ProgressNode,
		"started_at":     j.StartedAt,
	}
}

func DefaultGenerationSettings() GenerationSettings {
	return GenerationSettings{
		Width:        832,
		Height:       1216,
		Steps:        28,
		CFG:          5.5,
		Sampler:      "euler_ancestral",
		Scheduler:    "normal",
		Seed:         -1,
		HiresScale:   1.5,
		HiresSteps:   12,
		HiresDenoise: 0.5,
		Repeat:       1,
		Loras:        []LoraRef{},
	}
}

func normalizeGenerationSettings(settings GenerationSettings) GenerationSettings {
	defaults := DefaultGenerationSettings()

	settings.Checkpoint = strings.TrimSpace(settings.Checkpoint)

	if settings.Width <= 0 {
		settings.Width = defaults.Width
	}
	settings.Width = clampInt(settings.Width, 256, 2048) / 8 * 8
	if settings.Width < 256 {
		settings.Width = 256
	}
	if settings.Height <= 0 {
		settings.Height = defaults.Height
	}
	settings.Height = clampInt(settings.Height, 256, 2048) / 8 * 8
	if settings.Height < 256 {
		settings.Height = 256
	}

	if settings.Steps <= 0 {
		settings.Steps = defaults.Steps
	}
	settings.Steps = clampInt(settings.Steps, 1, 80)

	if settings.CFG < 0 {
		settings.CFG = 0
	}
	if settings.CFG > 30 {
		settings.CFG = 30
	}

	settings.Sampler = strings.TrimSpace(settings.Sampler)
	if settings.Sampler == "" {
		settings.Sampler = defaults.Sampler
	}
	settings.Scheduler = strings.TrimSpace(settings.Scheduler)
	if settings.Scheduler == "" {
		settings.Scheduler = defaults.Scheduler
	}

	if settings.Seed < -1 {
		settings.Seed = -1
	}

	if settings.HiresScale <= 0 {
		settings.HiresScale = defaults.HiresScale
	}
	if settings.HiresScale < 1 {
		settings.HiresScale = 1
	}
	if settings.HiresScale > 2 {
		settings.HiresScale = 2
	}
	if settings.HiresSteps <= 0 {
		settings.HiresSteps = defaults.HiresSteps
	}
	settings.HiresSteps = clampInt(settings.HiresSteps, 1, 80)
	if settings.HiresDenoise <= 0 {
		settings.HiresDenoise = defaults.HiresDenoise
	}
	if settings.HiresDenoise > 1 {
		settings.HiresDenoise = 1
	}
	settings.HiresSampler = strings.TrimSpace(settings.HiresSampler)

	settings.NegativeExtra = strings.TrimSpace(settings.NegativeExtra)
	if len(settings.NegativeExtra) > 2000 {
		settings.NegativeExtra = settings.NegativeExtra[:2000]
	}

	if settings.Repeat <= 0 {
		settings.Repeat = defaults.Repeat
	}
	settings.Repeat = clampInt(settings.Repeat, 1, 12)

	loras := make([]LoraRef, 0, len(settings.Loras))
	seen := map[string]bool{}
	for _, lora := range settings.Loras {
		name := strings.TrimSpace(lora.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		lora.Name = name
		if lora.Strength < -2 {
			lora.Strength = -2
		}
		if lora.Strength > 2 {
			lora.Strength = 2
		}
		if lora.ClipStrength < -2 {
			lora.ClipStrength = -2
		}
		if lora.ClipStrength > 2 {
			lora.ClipStrength = 2
		}
		lora.TriggerWords = strings.TrimSpace(lora.TriggerWords)
		loras = append(loras, lora)
		if len(loras) >= maxGenLoras {
			break
		}
	}
	settings.Loras = loras
	return settings
}

func loadGenerationSettings(path string) GenerationSettings {
	settings := DefaultGenerationSettings()
	raw, err := os.ReadFile(path)
	if err != nil {
		return settings
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return DefaultGenerationSettings()
	}
	return normalizeGenerationSettings(settings)
}

func saveGenerationSettings(path string, settings GenerationSettings) error {
	raw, err := json.MarshalIndent(normalizeGenerationSettings(settings), "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, raw)
}

// ── Server 状态 ────────────────────────────────────────────────────
func (s *Server) currentGenSettings() GenerationSettings {
	s.genMu.Lock()
	defer s.genMu.Unlock()
	return s.genSettings
}

func (s *Server) updateGenSettings(settings GenerationSettings) error {
	settings = normalizeGenerationSettings(settings)
	s.genMu.Lock()
	s.genSettings = settings
	s.genMu.Unlock()
	return saveGenerationSettings(s.genSettingsPath, settings)
}

func (s *Server) snapshotGenJob() genJob {
	s.genMu.Lock()
	job := s.genJob.clone()
	s.genMu.Unlock()
	// 采样进度来自 ComfyUI 的 websocket 事件，按 prompt_id 对到当前这一张。
	if job.Status == "running" && job.PromptID != "" && s.progress != nil {
		if value, total, node, ok := s.progress.snapshot(job.PromptID); ok {
			job.ProgressValue = value
			job.ProgressNode = node
			if job.ProgressTotal <= 0 && total > 0 {
				job.ProgressTotal = total
			}
		}
	}
	return job
}

func (s *Server) updateGenJob(fn func(*genJob)) {
	s.genMu.Lock()
	fn(&s.genJob)
	s.genMu.Unlock()
}

func (s *Server) stopRequested() bool {
	s.genMu.Lock()
	defer s.genMu.Unlock()
	return s.genStop
}

func (s *Server) finishGenJob(status, message string) {
	s.genMu.Lock()
	s.genJob.Status = status
	s.genJob.Message = message
	if status == "done" && s.genJob.ProgressTotal > 0 {
		s.genJob.ProgressValue = s.genJob.ProgressTotal
	}
	s.genMu.Unlock()
}

func (s *Server) failGenJob(message string) {
	s.genMu.Lock()
	s.genJob.Status = "error"
	s.genJob.Error = message
	s.genJob.Message = message
	s.genMu.Unlock()
}

// ── HTTP 接口 ──────────────────────────────────────────────────────
func (s *Server) handleGenOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	options, err := s.loadGenOptions(r.Context(), r.URL.Query().Get("refresh") == "1")
	payload := map[string]interface{}{
		"ok":              true,
		"comfy":           len(options.Checkpoints) > 0,
		"checkpoints":     stringList(options.Checkpoints),
		"samplers":        stringList(options.Samplers),
		"schedulers":      stringList(options.Schedulers),
		"loras":           stringList(options.Loras),
		"settings":        s.currentGenSettings(),
		"can_open_images": s.imageManagerURL != "",
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	writeJSON(w, payload)
}

func (s *Server) handleGenSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]interface{}{"ok": true, "settings": s.currentGenSettings()})
	case http.MethodPost:
		var incoming GenerationSettings
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&incoming); err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
			return
		}
		incoming = normalizeGenerationSettings(incoming)
		if err := s.updateGenSettings(incoming); err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]interface{}{"ok": true, "settings": incoming})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleGenStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Repeat   int    `json:"repeat"`
		Seed     *int   `json:"seed"`
		Negative string `json:"negative"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
		return
	}

	settings, _, err := s.resolveGenSettings(r.Context())
	if err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	// repeat / seed / negative 只是这一次作业的覆盖值，不能写回设置：
	// 否则点「一键生图」时传 repeat=1 会把用户配置的「连抽 N 次」清成 1。
	if body.Repeat > 0 {
		settings.Repeat = clampInt(body.Repeat, 1, 12)
	}
	if body.Seed != nil {
		settings.Seed = *body.Seed
	}
	settings = normalizeGenerationSettings(settings)
	negOverride := strings.TrimSpace(body.Negative)

	s.genMu.Lock()
	if s.genJob.Status == "running" {
		job := s.genJob.clone()
		s.genMu.Unlock()
		writeJSON(w, map[string]interface{}{"ok": false, "error": "正在生成中，请先停止", "job": job.payload()})
		return
	}
	images := s.genJob.Images
	if len(images) > genHistoryMax {
		images = images[len(images)-genHistoryMax:]
	}
	s.genJob = genJob{
		ID:        fmt.Sprintf("noobai-%d", time.Now().UnixNano()),
		Status:    "running",
		Message:   "准备生成",
		Total:     settings.Repeat,
		Images:    append([]GenImage{}, images...),
		StartedAt: time.Now().Format(time.RFC3339),
	}
	s.genStop = false
	job := s.genJob.clone()
	s.genMu.Unlock()

	go s.runGenJob(settings, negOverride)

	writeJSON(w, map[string]interface{}{"ok": true, "job": job.payload()})
}

func (s *Server) handleGenJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "job": s.snapshotGenJob().payload()})
}

func (s *Server) handleGenInterrupt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.genMu.Lock()
	running := s.genJob.Status == "running"
	if running {
		s.genStop = true
		s.genJob.Message = "正在停止…"
	}
	job := s.genJob.clone()
	s.genMu.Unlock()

	if running && s.comfy != nil {
		_ = s.comfy.interrupt(r.Context())
	}
	writeJSON(w, map[string]interface{}{"ok": true, "job": job.payload()})
}

func (s *Server) handleGenImage(w http.ResponseWriter, r *http.Request) {
	if s.comfy == nil {
		http.Error(w, "ComfyUI 未配置", http.StatusBadGateway)
		return
	}
	query := r.URL.Query()
	filename := query.Get("filename")
	if filename == "" {
		http.Error(w, "缺少 filename", http.StatusBadRequest)
		return
	}
	kind := query.Get("type")
	switch kind {
	case "", "output":
		kind = "output"
	case "input", "temp":
	default:
		http.Error(w, "type 无效", http.StatusBadRequest)
		return
	}
	resp, err := s.comfy.viewImage(r.Context(), filename, query.Get("subfolder"), kind)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(filename))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.Copy(w, resp.Body)
}

func openExternalURL(target string) error {
	return windows.ShellExecute(0, windows.StringToUTF16Ptr("open"), windows.StringToUTF16Ptr(target), nil, nil, windows.SW_SHOWNORMAL)
}

func (s *Server) handleGenOpenImages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(s.imageManagerURL) == "" {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "图片管理服务未启动"})
		return
	}
	target := strings.TrimRight(s.imageManagerURL, "/") + "?dir=" + url.QueryEscape("NoobAI")
	if err := openExternalURL(target); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "打开图片管理失败: " + err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "url": target})
}

// ── 生成循环 ──────────────────────────────────────────────────────
func (s *Server) resolveGenSettings(ctx context.Context) (GenerationSettings, genOptions, error) {
	settings := s.currentGenSettings()
	options, err := s.loadGenOptions(ctx, false)
	if err != nil && len(options.Checkpoints) == 0 {
		return settings, options, fmt.Errorf("ComfyUI 不可用：%v", err)
	}
	if len(options.Checkpoints) > 0 && !containsString(options.Checkpoints, settings.Checkpoint) {
		settings.Checkpoint = options.Checkpoints[0]
	}
	if settings.Checkpoint == "" {
		return settings, options, errors.New("未找到可用的 checkpoint")
	}
	if len(options.Samplers) > 0 && !containsString(options.Samplers, settings.Sampler) {
		settings.Sampler = options.Samplers[0]
	}
	if len(options.Schedulers) > 0 && !containsString(options.Schedulers, settings.Scheduler) {
		settings.Scheduler = options.Schedulers[0]
	}
	if settings.HiresSampler != "" && len(options.Samplers) > 0 && !containsString(options.Samplers, settings.HiresSampler) {
		settings.HiresSampler = ""
	}
	if len(options.Loras) > 0 {
		filtered := make([]LoraRef, 0, len(settings.Loras))
		for _, lora := range settings.Loras {
			if containsString(options.Loras, lora.Name) {
				filtered = append(filtered, lora)
			}
		}
		settings.Loras = filtered
	}
	settings = normalizeGenerationSettings(settings)
	_ = s.updateGenSettings(settings)
	return settings, options, nil
}

// pickNegative 组装负向词：手动输入优先（整体替换，追加词不再生效），
// 否则用抽取结果并追加生图设置里的补充负向词。
func pickNegative(rolled, manual, extra string) string {
	if trimmed := strings.TrimSpace(manual); trimmed != "" {
		return trimmed
	}
	switch {
	case extra == "":
		return rolled
	case rolled == "":
		return extra
	default:
		return rolled + ", " + extra
	}
}

func (s *Server) runGenJob(settings GenerationSettings, negOverride string) {
	ctx := context.Background()
	// 一段基础采样 +（可选）一段高清修复采样，两段步数相加才是整张图的进度总量。
	expectedSteps := settings.Steps
	if settings.HiresEnabled {
		expectedSteps += settings.HiresSteps
	}
	for i := 0; i < settings.Repeat; i++ {
		if s.stopRequested() {
			s.finishGenJob("stopped", fmt.Sprintf("已停止（完成 %d/%d）", i, settings.Repeat))
			return
		}
		s.updateGenJob(func(job *genJob) {
			job.Message = fmt.Sprintf("第 %d/%d 张：抽取提示词", i+1, settings.Repeat)
		})

		roll := s.engine.Roll(s.rollParams(nil))
		positive := stringValue(roll["text"])
		negative := pickNegative(stringValue(roll["negative"]), negOverride, settings.NegativeExtra)
		positive = applyLoraTriggers(settings, positive)

		seed := settings.Seed
		if seed < 0 {
			seed = randv2.IntN(2147483000)
		}

		nodes := buildNoobaiWorkflow(settings, positive, negative, seed)
		s.updateGenJob(func(job *genJob) {
			job.Index = i + 1
			job.Prompt = positive
			job.Negative = negative
			job.Seed = seed
			job.PromptID = ""
			job.ProgressValue = 0
			job.ProgressNode = ""
			if expectedSteps > 0 {
				job.ProgressTotal = expectedSteps
			}
			job.Message = fmt.Sprintf("第 %d/%d 张：排队中", i+1, settings.Repeat)
		})

		promptID, err := s.comfy.queuePrompt(ctx, nodes)
		if err != nil {
			if s.stopRequested() {
				s.finishGenJob("stopped", fmt.Sprintf("已停止（完成 %d/%d）", i, settings.Repeat))
				return
			}
			s.failGenJob("排队失败：" + err.Error())
			return
		}
		s.updateGenJob(func(job *genJob) { job.PromptID = promptID })

		s.updateGenJob(func(job *genJob) {
			job.Message = fmt.Sprintf("第 %d/%d 张：ComfyUI 生成中（seed %d）", i+1, settings.Repeat, seed)
		})

		images, err := s.waitGenImages(ctx, promptID)
		if err != nil {
			if errors.Is(err, errGenStopped) {
				s.finishGenJob("stopped", fmt.Sprintf("已停止（完成 %d/%d）", i, settings.Repeat))
				return
			}
			s.failGenJob(err.Error())
			return
		}

		s.genMu.Lock()
		for _, image := range images {
			image.Seed = seed
			image.Prompt = positive
			image.Negative = negative
			image.PromptID = promptID
			image.URL = genImageURL(image)
			s.genJob.Images = append(s.genJob.Images, image)
		}
		s.genJob.Done = i + 1
		if len(s.genJob.Images) > genHistoryMax {
			s.genJob.Images = append([]GenImage{}, s.genJob.Images[len(s.genJob.Images)-genHistoryMax:]...)
		}
		s.genMu.Unlock()
	}
	s.finishGenJob("done", fmt.Sprintf("生成完成，共 %d 张", settings.Repeat))
}

func (s *Server) waitGenImages(ctx context.Context, promptID string) ([]GenImage, error) {
	deadline := time.Now().Add(15 * time.Minute)
	failures := 0
	for time.Now().Before(deadline) {
		if s.stopRequested() {
			return nil, errGenStopped
		}
		history, err := s.comfy.history(ctx, promptID)
		if err != nil {
			failures++
			if failures >= 8 {
				return nil, fmt.Errorf("查询 ComfyUI 结果失败：%v", err)
			}
			time.Sleep(700 * time.Millisecond)
			continue
		}
		failures = 0
		if entry, ok := history[promptID]; ok {
			images := extractGenImages(entry)
			if len(images) > 0 {
				return images, nil
			}
			if entry.Status.StatusStr == "error" {
				if message := entry.errorMessage(); message != "" {
					return nil, errors.New("ComfyUI 生成失败：" + message)
				}
				return nil, errors.New("ComfyUI 生成失败")
			}
			if entry.Status.Completed || entry.Status.StatusStr == "success" {
				return nil, errors.New("ComfyUI 未返回图片")
			}
		}
		time.Sleep(700 * time.Millisecond)
	}
	return nil, errors.New("等待 ComfyUI 生成超时")
}

func extractGenImages(entry comfyHistoryEntry) []GenImage {
	var images []GenImage
	for _, output := range entry.Outputs {
		for _, image := range output.Images {
			if image.Filename == "" {
				continue
			}
			kind := image.Type
			if kind == "" {
				kind = "output"
			}
			images = append(images, GenImage{
				Filename:  image.Filename,
				Subfolder: image.Subfolder,
				Type:      kind,
			})
		}
	}
	return images
}

func genImageURL(image GenImage) string {
	query := url.Values{}
	query.Set("filename", image.Filename)
	if image.Subfolder != "" {
		query.Set("subfolder", image.Subfolder)
	}
	kind := image.Type
	if kind == "" {
		kind = "output"
	}
	query.Set("type", kind)
	return "/api/gen/image?" + query.Encode()
}

// ── 小工具 ────────────────────────────────────────────────────────
func clampInt(value, low, high int) int {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func stringValue(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func stringList(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
