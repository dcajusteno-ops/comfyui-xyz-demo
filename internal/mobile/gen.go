package mobile

// gen.go 移植 server/mobileGen.ts：/api/mobile/gen/*。
// 手机提交提示词 → 服务端排队、构造极简 SD 工作流提交 ComfyUI → 轮询 history → 手机取图。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

const (
	genMaxQueue       = 5
	genMaxTasks       = 40
	genMaxPromptChars = 4000
	genPollSeconds    = 300
)

type GenImage struct {
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder"`
	Type      string `json:"type"`
}

type GenParams struct {
	Prompt         string  `json:"prompt"`
	NegativePrompt string  `json:"negativePrompt"`
	Checkpoint     *string `json:"checkpoint,omitempty"`
	Width          float64 `json:"width"`
	Height         float64 `json:"height"`
	Steps          float64 `json:"steps"`
	Cfg            float64 `json:"cfg"`
	Seed           float64 `json:"seed"`
}

type GenTask struct {
	ID         string     `json:"id"`
	Status     string     `json:"status"`
	Params     GenParams  `json:"params"`
	PromptID   *string    `json:"promptId,omitempty"`
	Images     []GenImage `json:"images"`
	Error      *string    `json:"error,omitempty"`
	CreatedAt  string     `json:"createdAt"`
	StartedAt  *string    `json:"startedAt,omitempty"`
	FinishedAt *string    `json:"finishedAt,omitempty"`
}

type genTask struct {
	task GenTask
}

// GenManager 对齐 mobileGen 插件的闭包状态。
type GenManager struct {
	ComfyBase string
	client    *http.Client

	mu       sync.Mutex
	tasks    map[string]*genTask
	order    []string
	queue    []*genTask
	draining bool
}

func NewGenManager(comfyBase string) *GenManager {
	return &GenManager{
		ComfyBase: strings.TrimRight(comfyBase, "/"),
		client:    &http.Client{Timeout: 60 * time.Second},
		tasks:     map[string]*genTask{},
	}
}

func clampDim(v float64) float64 {
	rounded := math.Round(v/64) * 64
	return math.Min(2048, math.Max(256, rounded))
}

func (m *GenManager) sanitizeParams(raw map[string]any) (GenParams, error) {
	prompt := ""
	if s, ok := raw["prompt"].(string); ok {
		prompt = strings.TrimSpace(s)
	}
	if prompt == "" {
		return GenParams{}, &StatusError{Status: 400, Msg: "提示词不能为空"}
	}
	if len(prompt) > genMaxPromptChars {
		return GenParams{}, &StatusError{Status: 400, Msg: fmt.Sprintf("提示词过长（上限 %d 字符）", genMaxPromptChars)}
	}
	num := func(key string, fallback, min, max float64) float64 {
		v := fallback
		if n, ok := raw[key].(json.Number); ok {
			if f, err := n.Float64(); err == nil {
				v = f
			}
		}
		return math.Min(max, math.Max(min, v))
	}
	negative := ""
	if s, ok := raw["negativePrompt"].(string); ok {
		negative = s
		if len(negative) > genMaxPromptChars {
			negative = negative[:genMaxPromptChars]
		}
	}
	var checkpoint *string
	if s, ok := raw["checkpoint"].(string); ok && strings.TrimSpace(s) != "" {
		t := strings.TrimSpace(s)
		checkpoint = &t
	}
	var seed float64
	if n, ok := raw["seed"].(json.Number); ok {
		if f, err := n.Float64(); err == nil && !math.IsInf(f, 0) {
			seed = math.Floor(math.Abs(f))
			mod := math.Pow(2, 48)
			seed = seed - math.Floor(seed/mod)*mod
		} else {
			seed = float64(rand.Intn(1 << 31))
		}
	} else {
		seed = float64(rand.Intn(1 << 31))
	}
	return GenParams{
		Prompt:         prompt,
		NegativePrompt: negative,
		Checkpoint:     checkpoint,
		Width:          clampDim(num("width", 832, 256, 2048)),
		Height:         clampDim(num("height", 1216, 256, 2048)),
		Steps:          math.Round(num("steps", 20, 1, 100)),
		Cfg:            num("cfg", 7, 0, 30),
		Seed:           seed,
	}, nil
}

// buildText2ImgWorkflow 对齐 buildText2ImgWorkflow（只用核心节点）。
func buildText2ImgWorkflow(p GenParams, checkpoint string) map[string]any {
	return map[string]any{
		"1": metaNode("CheckpointLoaderSimple", map[string]any{"ckpt_name": checkpoint}, "手机生图 · Checkpoint"),
		"2": metaNode("CLIPTextEncode", map[string]any{"text": p.Prompt, "clip": []any{"1", 1}}, "正向提示词"),
		"3": metaNode("CLIPTextEncode", map[string]any{"text": p.NegativePrompt, "clip": []any{"1", 1}}, "负向提示词"),
		"4": metaNode("EmptyLatentImage", map[string]any{"width": p.Width, "height": p.Height, "batch_size": 1}, "空 Latent"),
		"5": metaNode("KSampler", map[string]any{
			"model":        []any{"1", 0},
			"positive":     []any{"2", 0},
			"negative":     []any{"3", 0},
			"latent_image": []any{"4", 0},
			"seed":         p.Seed,
			"steps":        p.Steps,
			"cfg":          p.Cfg,
			"sampler_name": "euler_ancestral",
			"scheduler":    "simple",
			"denoise":      1,
		}, "采样"),
		"6": metaNode("VAEDecode", map[string]any{"samples": []any{"5", 0}, "vae": []any{"1", 2}}, "VAE 解码"),
		"7": metaNode("SaveImage", map[string]any{"images": []any{"6", 0}, "filename_prefix": "MobileGen/gen"}, "保存图像"),
	}
}

// resolveCheckpoint 从 /object_info 实际枚举取 checkpoint（模糊命中优先，否则首项）。
func (m *GenManager) resolveCheckpoint(requested *string) (string, error) {
	info, err := GetJSON(m.client, m.ComfyBase+"/api/object_info/CheckpointLoaderSimple", 10000)
	if err != nil {
		return "", &StatusError{Status: 502, Msg: "无法连接 ComfyUI（/object_info 不可达）"}
	}
	cls, _ := info["CheckpointLoaderSimple"].(map[string]any)
	input, _ := cls["input"].(map[string]any)
	required, _ := input["required"].(map[string]any)
	ckptField, _ := required["ckpt_name"].([]any)
	var choices []string
	if len(ckptField) > 0 {
		if arr, ok := ckptField[0].([]any); ok {
			for _, c := range arr {
				if s, ok := c.(string); ok {
					choices = append(choices, s)
				}
			}
		}
	}
	if len(choices) == 0 {
		return "", &StatusError{Status: 502, Msg: "ComfyUI 未返回可用模型"}
	}
	if requested != nil {
		lower := strings.ToLower(*requested)
		for _, c := range choices {
			if strings.ToLower(c) == lower {
				return c, nil
			}
		}
		for _, c := range choices {
			if strings.Contains(strings.ToLower(c), lower) {
				return c, nil
			}
		}
	}
	return choices[0], nil
}

func (m *GenManager) drainQueue() {
	m.mu.Lock()
	if m.draining {
		m.mu.Unlock()
		return
	}
	m.draining = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.draining = false
		m.mu.Unlock()
	}()
	for {
		m.mu.Lock()
		if len(m.queue) == 0 {
			m.mu.Unlock()
			return
		}
		task := m.queue[0]
		m.queue = m.queue[1:]
		m.mu.Unlock()
		m.runTask(task)
	}
}

func (m *GenManager) runTask(task *genTask) {
	m.mu.Lock()
	task.task.Status = "running"
	started := nowISO()
	task.task.StartedAt = &started
	m.mu.Unlock()

	var runErr error
	func() {
		checkpoint, err := m.resolveCheckpoint(task.task.Params.Checkpoint)
		if err != nil {
			runErr = err
			return
		}
		queueRes, err := PostJSON(m.client, m.ComfyBase+"/api/prompt", map[string]any{
			"prompt":    buildText2ImgWorkflow(task.task.Params, checkpoint),
			"client_id": UUIDv4(),
		}, 15000)
		if err != nil {
			runErr = err
			return
		}
		promptID, _ := queueRes["prompt_id"].(string)
		if promptID == "" {
			runErr = &StatusError{Status: 502, Msg: "ComfyUI 未返回 prompt_id"}
			return
		}
		m.mu.Lock()
		task.task.PromptID = &promptID
		m.mu.Unlock()

		for i := 0; i < genPollSeconds; i++ {
			time.Sleep(1 * time.Second)
			history, err := GetJSON(m.client, m.ComfyBase+"/api/history/"+url.PathEscape(promptID), 10000)
			if err != nil {
				continue
			}
			entry, _ := history[promptID].(map[string]any)
			statusObj, _ := entry["status"].(map[string]any)
			if s, _ := statusObj["status_str"].(string); s == "error" {
				runErr = &StatusError{Status: 502, Msg: "ComfyUI 执行失败"}
				return
			}
			outputs, ok := entry["outputs"].(map[string]any)
			if !ok || len(outputs) == 0 {
				continue
			}
			var images []GenImage
			for _, nodeOutput := range outputs {
				obj, ok := nodeOutput.(map[string]any)
				if !ok {
					continue
				}
				list, _ := obj["images"].([]any)
				for _, raw := range list {
					img, ok := raw.(map[string]any)
					if !ok {
						continue
					}
					filename, _ := img["filename"].(string)
					typ, _ := img["type"].(string)
					if filename != "" && typ == "output" {
						subfolder, _ := img["subfolder"].(string)
						images = append(images, GenImage{Filename: filename, Subfolder: subfolder, Type: "output"})
					}
				}
			}
			if len(images) == 0 {
				runErr = &StatusError{Status: 502, Msg: "生成完成但未解析到图片"}
				return
			}
			m.mu.Lock()
			task.task.Images = images
			task.task.Status = "done"
			m.mu.Unlock()
			return
		}
		runErr = &StatusError{Status: 502, Msg: fmt.Sprintf("生成超时（%d 秒内未完成）", genPollSeconds)}
	}()

	m.mu.Lock()
	if runErr != nil {
		task.task.Status = "error"
		msg := runErr.Error()
		task.task.Error = &msg
	} else {
		task.task.Error = nil
	}
	fin := nowISO()
	task.task.FinishedAt = &fin
	m.mu.Unlock()
}

// Handle 处理 /api/mobile/gen 与 /api/mobile/gen/ 前缀。
func (m *GenManager) Handle(w http.ResponseWriter, r *http.Request) {
	method := strings.ToUpper(r.Method)
	segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // ["api","mobile","gen",...]

	if method == "POST" && len(segments) == 3 {
		payload, err := readGenBody(r)
		if err != nil {
			sendMobileError(w, err)
			return
		}
		params, err := m.sanitizeParams(payload)
		if err != nil {
			sendMobileError(w, err)
			return
		}
		m.mu.Lock()
		if len(m.queue) >= genMaxQueue {
			m.mu.Unlock()
			sendMobileError(w, &StatusError{Status: 429, Msg: fmt.Sprintf("排队任务已达上限（%d），请稍后再试", genMaxQueue)})
			return
		}
		task := &genTask{task: GenTask{
			ID:        UUIDv4(),
			Status:    "queued",
			Params:    params,
			Images:    []GenImage{},
			CreatedAt: nowISO(),
		}}
		m.tasks[task.task.ID] = task
		m.order = append(m.order, task.task.ID)
		if len(m.order) > genMaxTasks {
			oldest := m.order[0]
			m.order = m.order[1:]
			delete(m.tasks, oldest)
		}
		m.queue = append(m.queue, task)
		m.mu.Unlock()
		go m.drainQueue()
		storage.SendJSON(w, 202, map[string]any{"success": true, "id": task.task.ID})
		return
	}

	if method == "GET" && len(segments) == 3 {
		m.mu.Lock()
		list := make([]GenTask, 0, len(m.order))
		for i := len(m.order) - 1; i >= 0; i-- {
			list = append(list, m.tasks[m.order[i]].task)
		}
		m.mu.Unlock()
		storage.SendJSON(w, 200, map[string]any{"success": true, "tasks": list})
		return
	}

	if len(segments) >= 4 && segments[3] != "" {
		id := segments[3]
		m.mu.Lock()
		record := m.tasks[id]
		m.mu.Unlock()
		if record == nil {
			storage.SendJSON(w, 404, map[string]any{"success": false, "error": "任务不存在"})
			return
		}
		if method == "GET" && len(segments) == 4 {
			storage.SendJSON(w, 200, map[string]any{"success": true, "task": record.task})
			return
		}
		if method == "DELETE" && len(segments) == 4 {
			m.mu.Lock()
			for i, t := range m.queue {
				if t.task.ID == id {
					m.queue = append(m.queue[:i], m.queue[i+1:]...)
					break
				}
			}
			delete(m.tasks, id)
			for i, oid := range m.order {
				if oid == id {
					m.order = append(m.order[:i], m.order[i+1:]...)
					break
				}
			}
			m.mu.Unlock()
			storage.SendJSON(w, 200, map[string]any{"success": true})
			return
		}
		// 代理成图：/api/mobile/gen/tasks/:id/image/:index → ComfyUI /api/view
		if method == "GET" && len(segments) >= 5 && segments[4] == "image" {
			index := 0
			if len(segments) >= 6 {
				if v, err := strconv.Atoi(segments[5]); err == nil && v > 0 {
					index = v
				}
			}
			m.mu.Lock()
			imgs := record.task.Images
			m.mu.Unlock()
			if index >= len(imgs) {
				storage.SendJSON(w, 404, map[string]any{"success": false, "error": "成图不存在（任务可能尚未完成）"})
				return
			}
			image := imgs[index]
			q := url.Values{}
			q.Set("filename", image.Filename)
			q.Set("subfolder", image.Subfolder)
			q.Set("type", image.Type)
			ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, "GET", m.ComfyBase+"/api/view?"+q.Encode(), nil)
			if err != nil {
				sendMobileError(w, err)
				return
			}
			upstream, err := m.client.Do(req)
			if err != nil {
				sendMobileError(w, &StatusError{Status: 502, Msg: "读取成图失败（请求失败）"})
				return
			}
			defer upstream.Body.Close()
			if upstream.StatusCode != http.StatusOK {
				sendMobileError(w, &StatusError{Status: 502, Msg: fmt.Sprintf("读取成图失败（%d）", upstream.StatusCode)})
				return
			}
			data, err := io.ReadAll(upstream.Body)
			if err != nil {
				sendMobileError(w, &StatusError{Status: 502, Msg: "读取成图失败（读取响应体失败）"})
				return
			}
			ct := upstream.Header.Get("Content-Type")
			if ct == "" {
				ct = "image/png"
			}
			w.Header().Set("Content-Type", ct)
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}

	storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown mobile gen endpoint"})
}

// readGenBody 对齐 mobileGen 的 readJsonBody（1MB 上限，413）。
func readGenBody(r *http.Request) (map[string]any, error) {
	data, err := readBodyLimited(r, 1024*1024, "请求体过大")
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return map[string]any{}, nil
	}
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.UseNumber()
	var obj map[string]any
	if err := dec.Decode(&obj); err != nil {
		return nil, &StatusError{Status: 400, Msg: "请求体必须是合法 JSON"}
	}
	return obj, nil
}
