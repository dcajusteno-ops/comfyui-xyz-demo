package noobai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// genOutputPrefix 与 Anima 造型台一致：按日期分目录，图片管理页可直接定位。
// 目录名在 Go 侧展开日期；部分 ComfyUI 版本不会解析 %date:...% 占位符。
const genOutputPrefix = "NoobAI/%s/ComfyUI"

func genFilenamePrefix(now time.Time) string {
	return fmt.Sprintf(genOutputPrefix, now.Format("2006-01-02"))
}

// wfNode 是 ComfyUI API 格式的工作流节点。
type wfNode struct {
	ClassType string                 `json:"class_type"`
	Inputs    map[string]interface{} `json:"inputs"`
}

type comfyClient struct {
	base string
	http *http.Client
}

// genOptions 是 ComfyUI 可选项缓存。
type genOptions struct {
	Checkpoints []string  `json:"checkpoints"`
	Samplers    []string  `json:"samplers"`
	Schedulers  []string  `json:"schedulers"`
	Loras       []string  `json:"loras"`
	FetchedAt   time.Time `json:"fetched_at"`
}

type objectInfoNode struct {
	Input struct {
		Required map[string]json.RawMessage `json:"required"`
	} `json:"input"`
}

type comfyImageRef struct {
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder"`
	Type      string `json:"type"`
}

type comfyHistoryEntry struct {
	Outputs map[string]struct {
		Images []comfyImageRef `json:"images"`
	} `json:"outputs"`
	Status struct {
		StatusStr string            `json:"status_str"`
		Completed bool              `json:"completed"`
		Messages  []json.RawMessage `json:"messages"`
	} `json:"status"`
}

// errorMessage 从 history.status.messages 中提取 ComfyUI 的执行异常文本。
func (e comfyHistoryEntry) errorMessage() string {
	for _, raw := range e.Status.Messages {
		var pair []json.RawMessage
		if err := json.Unmarshal(raw, &pair); err != nil || len(pair) < 2 {
			continue
		}
		var kind string
		if err := json.Unmarshal(pair[0], &kind); err != nil {
			continue
		}
		if kind != "execution_error" && kind != "execution_interrupted" {
			continue
		}
		var data struct {
			ExceptionMessage string `json:"exception_message"`
		}
		if err := json.Unmarshal(pair[1], &data); err != nil {
			continue
		}
		if message := strings.TrimSpace(data.ExceptionMessage); message != "" {
			return message
		}
	}
	return ""
}

func newComfyClient(base string) *comfyClient {
	return &comfyClient{
		base: strings.TrimRight(strings.TrimSpace(base), "/"),
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// get 取一个原始响应，调用方负责关闭 Body。
func (c *comfyClient) get(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	return c.http.Do(req)
}

func (c *comfyClient) getJSON(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return comfyHTTPError(path, resp)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out)
}

func (c *comfyClient) postJSON(ctx context.Context, path string, body, out interface{}) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return comfyHTTPError(path, resp)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func comfyHTTPError(path string, resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = resp.Status
	}
	return fmt.Errorf("ComfyUI %s: HTTP %d %s", path, resp.StatusCode, message)
}

func (c *comfyClient) objectInfo(ctx context.Context, class string) (map[string]json.RawMessage, error) {
	var payload map[string]objectInfoNode
	if err := c.getJSON(ctx, "/object_info/"+url.PathEscape(class), &payload); err != nil {
		return nil, err
	}
	node, ok := payload[class]
	if !ok {
		return nil, fmt.Errorf("ComfyUI 未返回 %s 节点信息", class)
	}
	return node.Input.Required, nil
}

func (c *comfyClient) queuePrompt(ctx context.Context, nodes map[string]wfNode) (string, error) {
	payload := map[string]interface{}{
		"prompt":    nodes,
		"client_id": genClientID,
	}
	var out struct {
		PromptID string `json:"prompt_id"`
	}
	if err := c.postJSON(ctx, "/prompt", payload, &out); err != nil {
		return "", err
	}
	if out.PromptID == "" {
		return "", errors.New("ComfyUI 未返回 prompt_id")
	}
	return out.PromptID, nil
}

func (c *comfyClient) history(ctx context.Context, promptID string) (map[string]comfyHistoryEntry, error) {
	var payload map[string]comfyHistoryEntry
	if err := c.getJSON(ctx, "/history/"+url.PathEscape(promptID), &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (c *comfyClient) interrupt(ctx context.Context) error {
	return c.postJSON(ctx, "/interrupt", map[string]interface{}{}, nil)
}

func (c *comfyClient) viewImage(ctx context.Context, filename, subfolder, kind string) (*http.Response, error) {
	query := url.Values{}
	query.Set("filename", filename)
	if subfolder != "" {
		query.Set("subfolder", subfolder)
	}
	if kind == "" {
		kind = "output"
	}
	query.Set("type", kind)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/view?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("ComfyUI 图片读取失败: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return resp, nil
}

// loadGenOptions 拉取并缓存 checkpoint / 采样器 / 调度器 / LoRA 列表。
func (s *Server) loadGenOptions(ctx context.Context, force bool) (genOptions, error) {
	s.genOptionsMu.Lock()
	if !force && len(s.genOptions.Checkpoints) > 0 && time.Since(s.genOptionsAt) < time.Minute {
		cached := s.genOptions
		s.genOptionsMu.Unlock()
		return cached, nil
	}
	s.genOptionsMu.Unlock()

	if s.comfy == nil {
		return genOptions{}, errors.New("未配置 ComfyUI 地址")
	}

	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	options := genOptions{}
	var problems []string
	if required, err := s.comfy.objectInfo(ctx, "CheckpointLoaderSimple"); err != nil {
		problems = append(problems, err.Error())
	} else {
		options.Checkpoints = extractEnum(required["ckpt_name"])
	}
	if required, err := s.comfy.objectInfo(ctx, "KSampler"); err != nil {
		problems = append(problems, err.Error())
	} else {
		options.Samplers = extractEnum(required["sampler_name"])
		options.Schedulers = extractEnum(required["scheduler"])
	}
	if required, err := s.comfy.objectInfo(ctx, "LoraLoader"); err != nil {
		problems = append(problems, err.Error())
	} else {
		options.Loras = extractEnum(required["lora_name"])
	}

	if len(options.Checkpoints) == 0 {
		if len(problems) == 0 {
			problems = append(problems, "ComfyUI 未返回可用 checkpoint")
		}
		return options, errors.New(strings.Join(problems, "；"))
	}

	s.genOptionsMu.Lock()
	s.genOptions = options
	s.genOptionsAt = time.Now()
	s.genOptionsMu.Unlock()
	return options, nil
}

func extractEnum(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var list []json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil || len(list) == 0 {
		return nil
	}
	var values []string
	if err := json.Unmarshal(list[0], &values); err != nil {
		return nil
	}
	return values
}

// buildNoobaiWorkflow 生成 ComfyUI API 工作流。
//
// 节点链：CheckpointLoaderSimple → LoraLoader×N → CLIPTextEncode×2 →
// EmptyLatentImage → KSampler →（可选 LatentUpscaleBy + 二次 KSampler）→
// VAEDecode → SaveImage。
func buildNoobaiWorkflow(settings GenerationSettings, positive, negative string, seed int) map[string]wfNode {
	nodes := map[string]wfNode{}
	nodes["1"] = wfNode{
		ClassType: "CheckpointLoaderSimple",
		Inputs:    map[string]interface{}{"ckpt_name": settings.Checkpoint},
	}

	model := []interface{}{"1", 0}
	clip := []interface{}{"1", 1}
	nodeID := 2
	for _, lora := range settings.Loras {
		if lora.Disabled || strings.TrimSpace(lora.Name) == "" {
			continue
		}
		id := strconv.Itoa(nodeID)
		nodes[id] = wfNode{
			ClassType: "LoraLoader",
			Inputs: map[string]interface{}{
				"model":          model,
				"clip":           clip,
				"lora_name":      lora.Name,
				"strength_model": lora.Strength,
				"strength_clip":  lora.ClipStrength,
			},
		}
		model = []interface{}{id, 0}
		clip = []interface{}{id, 1}
		nodeID++
	}

	positiveID := strconv.Itoa(nodeID)
	nodeID++
	nodes[positiveID] = wfNode{
		ClassType: "CLIPTextEncode",
		Inputs:    map[string]interface{}{"text": positive, "clip": clip},
	}
	negativeID := strconv.Itoa(nodeID)
	nodeID++
	nodes[negativeID] = wfNode{
		ClassType: "CLIPTextEncode",
		Inputs:    map[string]interface{}{"text": negative, "clip": clip},
	}

	latentID := strconv.Itoa(nodeID)
	nodeID++
	nodes[latentID] = wfNode{
		ClassType: "EmptyLatentImage",
		Inputs: map[string]interface{}{
			"width":      settings.Width,
			"height":     settings.Height,
			"batch_size": 1,
		},
	}

	samplerID := strconv.Itoa(nodeID)
	nodeID++
	nodes[samplerID] = wfNode{
		ClassType: "KSampler",
		Inputs: map[string]interface{}{
			"model":        model,
			"seed":         seed,
			"steps":        settings.Steps,
			"cfg":          settings.CFG,
			"sampler_name": settings.Sampler,
			"scheduler":    settings.Scheduler,
			"positive":     []interface{}{positiveID, 0},
			"negative":     []interface{}{negativeID, 0},
			"latent_image": []interface{}{latentID, 0},
			"denoise":      1.0,
		},
	}
	lastLatent := []interface{}{samplerID, 0}

	if settings.HiresEnabled {
		upscaleID := strconv.Itoa(nodeID)
		nodeID++
		nodes[upscaleID] = wfNode{
			ClassType: "LatentUpscaleBy",
			Inputs: map[string]interface{}{
				"samples":        lastLatent,
				"upscale_method": "bislerp",
				"scale_by":       settings.HiresScale,
			},
		}
		hiresSampler := settings.HiresSampler
		if hiresSampler == "" {
			hiresSampler = settings.Sampler
		}
		hiresID := strconv.Itoa(nodeID)
		nodeID++
		nodes[hiresID] = wfNode{
			ClassType: "KSampler",
			Inputs: map[string]interface{}{
				"model":        model,
				"seed":         seed,
				"steps":        settings.HiresSteps,
				"cfg":          settings.CFG,
				"sampler_name": hiresSampler,
				"scheduler":    settings.Scheduler,
				"positive":     []interface{}{positiveID, 0},
				"negative":     []interface{}{negativeID, 0},
				"latent_image": []interface{}{upscaleID, 0},
				"denoise":      settings.HiresDenoise,
			},
		}
		lastLatent = []interface{}{hiresID, 0}
	}

	vaeID := strconv.Itoa(nodeID)
	nodeID++
	nodes[vaeID] = wfNode{
		ClassType: "VAEDecode",
		Inputs:    map[string]interface{}{"samples": lastLatent, "vae": []interface{}{"1", 2}},
	}
	saveID := strconv.Itoa(nodeID)
	nodes[saveID] = wfNode{
		ClassType: "SaveImage",
		Inputs: map[string]interface{}{
			"images":          []interface{}{vaeID, 0},
			"filename_prefix": genFilenamePrefix(time.Now()),
		},
	}
	return nodes
}

// applyLoraTriggers 把启用「自动触发」的 LoRA 触发词前置到正向提示词。
func applyLoraTriggers(settings GenerationSettings, positive string) string {
	var extras []string
	for _, lora := range settings.Loras {
		if lora.Disabled || !lora.AutoTrigger || strings.TrimSpace(lora.TriggerWords) == "" {
			continue
		}
		extras = append(extras, splitTriggerWords(lora.TriggerWords)...)
	}
	if len(extras) == 0 {
		return positive
	}
	existing := map[string]bool{}
	for _, tag := range strings.Split(positive, ",") {
		existing[strings.ToLower(strings.TrimSpace(tag))] = true
	}
	var add []string
	for _, tag := range extras {
		key := strings.ToLower(strings.TrimSpace(tag))
		if key == "" || existing[key] {
			continue
		}
		existing[key] = true
		add = append(add, strings.TrimSpace(tag))
	}
	if len(add) == 0 {
		return positive
	}
	prefix := strings.Join(add, ", ")
	if strings.TrimSpace(positive) == "" {
		return prefix
	}
	return prefix + ", " + positive
}

func splitTriggerWords(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == '|'
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
