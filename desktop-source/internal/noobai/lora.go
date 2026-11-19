package noobai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

// LoRA 卡片的元数据来自 ComfyUI-Lora-Manager 插件（若安装）。
// 插件不可用时退化为「只有文件名」的列表，前端仍可正常添加与调强度。

type loraListItem struct {
	ModelName   string   `json:"model_name"`
	FileName    string   `json:"file_name"`
	FilePath    string   `json:"file_path"`
	Folder      string   `json:"folder"`
	BaseModel   string   `json:"base_model"`
	PreviewURL  string   `json:"preview_url"`
	PreviewNSFW int      `json:"preview_nsfw_level"`
	FileSize    int64    `json:"file_size"`
	Tags        []string `json:"tags"`
	// Civitai 里带着模型自带的触发词（trainedWords），可能是逗号串，也可能混着 <lora:...> 语法。
	Civitai struct {
		TrainedWords []string `json:"trainedWords"`
	} `json:"civitai"`
}

type loraListResponse struct {
	Items      []loraListItem `json:"items"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	TotalPages int            `json:"total_pages"`
}

// LoraMeta 供前端渲染 LoRA 卡片：Name 仍是 ComfyUI 的 lora_name（写工作流用）。
type LoraMeta struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	BaseModel   string `json:"base_model"`
	Folder      string `json:"folder"`
	Size        int64  `json:"size"`
	Preview     string `json:"preview"`
	// NSFWLevel 来自 LoRA Manager 的 preview_nsfw_level：0 安全，16 起为限制级。
	NSFWLevel int `json:"nsfw_level"`
	// TriggerWords 是模型自带的触发词（Civitai trainedWords），已去掉 <lora:…> 语法并去重。
	TriggerWords []string `json:"trigger_words"`
	// SourcePath 是本地文件路径，只用于按需读取 safetensors 表头，不下发到前端。
	SourcePath string `json:"-"`
}

const (
	loraMetaTTL  = 2 * time.Minute
	loraPageSize = 100
	loraMaxPages = 20
)

// collectLoraIndex 逐页抓取 LoRA 管理器列表（该接口固定 100 条/页）。
func (s *Server) collectLoraIndex(ctx context.Context, index map[string]loraListItem) error {
	lmCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	for page := 1; page <= loraMaxPages; page++ {
		var payload loraListResponse
		target := "/api/lm/loras/list?page=" + strconv.Itoa(page) +
			"&page_size=" + strconv.Itoa(loraPageSize) + "&sort_by=name"
		if err := s.comfy.getJSON(lmCtx, target, &payload); err != nil {
			if page == 1 {
				return errors.New("LoRA 管理器不可用：" + err.Error())
			}
			break
		}
		for _, item := range payload.Items {
			if rel := loraRelPath(item.FilePath); rel != "" {
				index[strings.ToLower(rel)] = item
			}
			if item.FileName != "" {
				index["#"+strings.ToLower(item.FileName)] = item
			}
		}
		if len(payload.Items) == 0 || (payload.TotalPages > 0 && page >= payload.TotalPages) {
			break
		}
	}
	return nil
}

// loadLoraMeta 把 ComfyUI 的 LoRA 枚举与 LoRA Manager 的元数据合并。
// 返回的 items 始终覆盖全部 LoRA；error 只表示元数据（预览 / 基础模型）不可用。
func (s *Server) loadLoraMeta(ctx context.Context, force bool) ([]LoraMeta, error) {
	s.loraMetaMu.Lock()
	if !force && len(s.loraMetaCache) > 0 && time.Since(s.loraMetaAt) < loraMetaTTL {
		cached := s.loraMetaCache
		s.loraMetaMu.Unlock()
		return cached, nil
	}
	s.loraMetaMu.Unlock()

	options, _ := s.loadGenOptions(ctx, false)
	if len(options.Loras) == 0 {
		return nil, errors.New("ComfyUI 未返回 LoRA 列表")
	}

	index := map[string]loraListItem{}
	var warn error
	if s.comfy == nil {
		warn = errors.New("未配置 ComfyUI 地址")
	} else if err := s.collectLoraIndex(ctx, index); err != nil {
		warn = err
	}

	items := make([]LoraMeta, 0, len(options.Loras))
	for _, name := range options.Loras {
		meta := LoraMeta{Name: name, DisplayName: loraBaseName(name)}
		item, ok := index[strings.ToLower(normalizeLoraName(name))]
		if !ok {
			item, ok = index["#"+strings.ToLower(loraStem(name))]
		}
		if ok {
			if strings.TrimSpace(item.ModelName) != "" {
				meta.DisplayName = item.ModelName
			}
			meta.BaseModel = item.BaseModel
			meta.Folder = item.Folder
			meta.Size = item.FileSize
			meta.Preview = loraPreviewPath(item.PreviewURL)
			meta.NSFWLevel = item.PreviewNSFW
			meta.TriggerWords = cleanTriggerWords(item.Civitai.TrainedWords)
			meta.SourcePath = item.FilePath
			meta.NSFWLevel = item.PreviewNSFW
		}
		items = append(items, meta)
	}

	s.loraMetaMu.Lock()
	s.loraMetaCache = items
	s.loraMetaAt = time.Now()
	s.loraMetaMu.Unlock()
	return items, warn
}

func (s *Server) handleGenLoras(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	items, err := s.loadLoraMeta(r.Context(), r.URL.Query().Get("refresh") == "1")
	payload := map[string]interface{}{
		"ok":    true,
		"comfy": s.comfy != nil,
		"total": len(items),
		"items": items,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	writeJSON(w, payload)
}

// handleGenLoraPreview 代理 LoRA 管理器的预览图，避免前端跨端口直接取图。
func (s *Server) handleGenLoraPreview(w http.ResponseWriter, r *http.Request) {
	if s.comfy == nil {
		http.Error(w, "ComfyUI 未配置", http.StatusBadGateway)
		return
	}
	target := r.URL.Query().Get("path")
	if !strings.HasPrefix(target, "/api/lm/") {
		http.Error(w, "path 无效", http.StatusBadRequest)
		return
	}
	resp, err := s.comfy.get(r.Context(), target)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		http.Error(w, resp.Status, resp.StatusCode)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = io.Copy(w, resp.Body)
}

func normalizeLoraName(name string) string {
	value := strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
	return strings.TrimPrefix(value, "/")
}

// loraRelPath 取 file_path 里 models/loras/ 之后的部分，与 ComfyUI 枚举名对齐。
func loraRelPath(filePath string) string {
	normalized := normalizeLoraName(filePath)
	lower := strings.ToLower(normalized)
	marker := "/models/loras/"
	if i := strings.Index(lower, marker); i >= 0 {
		return normalized[i+len(marker):]
	}
	return ""
}

func loraBaseName(name string) string {
	return path.Base(normalizeLoraName(name))
}

func loraStem(name string) string {
	base := loraBaseName(name)
	return strings.TrimSuffix(base, path.Ext(base))
}

func loraPreviewPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "/api/lm/") {
		return ""
	}
	return "/api/gen/lora-preview?path=" + url.QueryEscape(raw)
}

// cleanTriggerWords 把 Civitai 的 trainedWords 摊平：
// 条目可能是逗号串，也可能混着 <lora:name:1> 这样的语法，需要拆开、去语法、去重。
func cleanTriggerWords(raw []string) []string {
	out := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, entry := range raw {
		parts := strings.FieldsFunc(entry, func(r rune) bool {
			return r == ',' || r == '，' || r == '|' || r == '\n'
		})
		for _, part := range parts {
			word := strings.TrimSpace(part)
			if word == "" || strings.HasPrefix(word, "<") {
				continue
			}
			key := strings.ToLower(word)
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, word)
			if len(out) >= 24 {
				return out
			}
		}
	}
	return out
}
