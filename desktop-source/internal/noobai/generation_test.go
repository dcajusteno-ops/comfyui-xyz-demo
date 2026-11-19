package noobai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

func nodesOf(wf map[string]wfNode, class string) map[string]wfNode {
	out := map[string]wfNode{}
	for id, node := range wf {
		if node.ClassType == class {
			out[id] = node
		}
	}
	return out
}

func TestBuildWorkflowWithoutLora(t *testing.T) {
	settings := DefaultGenerationSettings()
	settings.Checkpoint = "demo.safetensors"
	wf := buildNoobaiWorkflow(settings, "1girl, solo", "lowres, bad", 1234)

	if len(wf) != 7 {
		t.Fatalf("节点数 = %d，期望 7", len(wf))
	}
	checkpoint, ok := wf["1"]
	if !ok || checkpoint.ClassType != "CheckpointLoaderSimple" {
		t.Fatalf("缺少 CheckpointLoaderSimple: %#v", wf["1"])
	}
	if checkpoint.Inputs["ckpt_name"] != "demo.safetensors" {
		t.Fatalf("ckpt_name = %v", checkpoint.Inputs["ckpt_name"])
	}

	encoders := nodesOf(wf, "CLIPTextEncode")
	if len(encoders) != 2 {
		t.Fatalf("CLIPTextEncode 数量 = %d", len(encoders))
	}
	texts := map[string]bool{}
	for _, encoder := range encoders {
		texts[encoder.Inputs["text"].(string)] = true
		if !reflect.DeepEqual(encoder.Inputs["clip"], []interface{}{"1", 1}) {
			t.Fatalf("clip 连接错误: %#v", encoder.Inputs["clip"])
		}
	}
	if !texts["1girl, solo"] || !texts["lowres, bad"] {
		t.Fatalf("正负向文本错误: %#v", texts)
	}

	samplers := nodesOf(wf, "KSampler")
	if len(samplers) != 1 {
		t.Fatalf("KSampler 数量 = %d", len(samplers))
	}
	for _, sampler := range samplers {
		if sampler.Inputs["seed"] != 1234 {
			t.Fatalf("seed = %v", sampler.Inputs["seed"])
		}
		if sampler.Inputs["steps"] != settings.Steps || sampler.Inputs["cfg"] != settings.CFG {
			t.Fatalf("采样参数错误: %#v", sampler.Inputs)
		}
		if sampler.Inputs["sampler_name"] != settings.Sampler || sampler.Inputs["scheduler"] != settings.Scheduler {
			t.Fatalf("采样器错误: %#v", sampler.Inputs)
		}
	}

	latents := nodesOf(wf, "EmptyLatentImage")
	if len(latents) != 1 {
		t.Fatalf("EmptyLatentImage 数量 = %d", len(latents))
	}
	for _, latent := range latents {
		if latent.Inputs["width"] != settings.Width || latent.Inputs["height"] != settings.Height {
			t.Fatalf("尺寸错误: %#v", latent.Inputs)
		}
	}

	saves := nodesOf(wf, "SaveImage")
	if len(saves) != 1 {
		t.Fatalf("SaveImage 数量 = %d", len(saves))
	}
	wantPrefix := genFilenamePrefix(time.Now())
	for _, save := range saves {
		if save.Inputs["filename_prefix"] != wantPrefix {
			t.Fatalf("filename_prefix = %v，期望 %v", save.Inputs["filename_prefix"], wantPrefix)
		}
		if !reflect.DeepEqual(save.Inputs["images"], []interface{}{"6", 0}) {
			t.Fatalf("SaveImage 连接错误: %#v", save.Inputs["images"])
		}
	}
}

func TestComfyHistoryError(t *testing.T) {
	entry := comfyHistoryEntry{}
	entry.Status.Messages = []json.RawMessage{
		json.RawMessage(`["execution_start", {"prompt_id": "x"}]`),
		json.RawMessage(`["execution_error", {"exception_message": "[WinError 267] boom\n"}]`),
	}
	if got := entry.errorMessage(); got != "[WinError 267] boom" {
		t.Fatalf("errorMessage = %q", got)
	}
}

func TestBuildWorkflowLoraChain(t *testing.T) {
	settings := DefaultGenerationSettings()
	settings.Checkpoint = "demo.safetensors"
	settings.Loras = []LoraRef{
		{Name: "a.safetensors", Strength: 0.8, ClipStrength: 0.7},
		{Name: "b.safetensors", Strength: 0.6, ClipStrength: 0.5},
	}
	wf := buildNoobaiWorkflow(settings, "p", "n", 7)
	if len(wf) != 9 {
		t.Fatalf("节点数 = %d，期望 9", len(wf))
	}

	first, ok := wf["2"]
	if !ok || first.ClassType != "LoraLoader" {
		t.Fatalf("第一个 LoRA 节点缺失: %#v", wf["2"])
	}
	if !reflect.DeepEqual(first.Inputs["model"], []interface{}{"1", 0}) ||
		!reflect.DeepEqual(first.Inputs["clip"], []interface{}{"1", 1}) {
		t.Fatalf("第一个 LoRA 连接错误: %#v", first.Inputs)
	}
	if first.Inputs["strength_model"] != 0.8 || first.Inputs["strength_clip"] != 0.7 {
		t.Fatalf("第一个 LoRA 强度错误: %#v", first.Inputs)
	}

	second, ok := wf["3"]
	if !ok || second.ClassType != "LoraLoader" {
		t.Fatalf("第二个 LoRA 节点缺失: %#v", wf["3"])
	}
	if !reflect.DeepEqual(second.Inputs["model"], []interface{}{"2", 0}) ||
		!reflect.DeepEqual(second.Inputs["clip"], []interface{}{"2", 1}) {
		t.Fatalf("LoRA 链连接错误: %#v", second.Inputs)
	}

	for _, encoder := range nodesOf(wf, "CLIPTextEncode") {
		if !reflect.DeepEqual(encoder.Inputs["clip"], []interface{}{"3", 1}) {
			t.Fatalf("编码器未接在 LoRA 链末端: %#v", encoder.Inputs["clip"])
		}
	}
}

func TestBuildWorkflowHires(t *testing.T) {
	settings := DefaultGenerationSettings()
	settings.Checkpoint = "demo.safetensors"
	settings.HiresEnabled = true
	wf := buildNoobaiWorkflow(settings, "p", "n", 42)

	if len(wf) != 9 {
		t.Fatalf("节点数 = %d，期望 9", len(wf))
	}
	upscales := nodesOf(wf, "LatentUpscaleBy")
	if len(upscales) != 1 {
		t.Fatalf("LatentUpscaleBy 数量 = %d", len(upscales))
	}
	for _, node := range upscales {
		if node.Inputs["scale_by"] != settings.HiresScale {
			t.Fatalf("scale_by = %v", node.Inputs["scale_by"])
		}
	}
	samplers := nodesOf(wf, "KSampler")
	if len(samplers) != 2 {
		t.Fatalf("KSampler 数量 = %d", len(samplers))
	}
	foundHires := false
	for _, sampler := range samplers {
		if sampler.Inputs["denoise"] == settings.HiresDenoise && sampler.Inputs["steps"] == settings.HiresSteps {
			foundHires = true
		}
	}
	if !foundHires {
		t.Fatalf("未找到高清修复的二次采样: %#v", samplers)
	}
}

func TestPickNegative(t *testing.T) {
	cases := []struct{ rolled, manual, extra, want string }{
		{"auto", "", "extra", "auto, extra"},
		{"auto", "", "", "auto"},
		{"", "", "extra", "extra"},
		{"auto", "  手动负向  ", "extra", "手动负向"},
		{"", "手动负向", "", "手动负向"},
	}
	for _, c := range cases {
		if got := pickNegative(c.rolled, c.manual, c.extra); got != c.want {
			t.Fatalf("pickNegative(%q,%q,%q) = %q，期望 %q", c.rolled, c.manual, c.extra, got, c.want)
		}
	}
}

func TestApplyLoraTriggers(t *testing.T) {
	settings := DefaultGenerationSettings()
	settings.Loras = []LoraRef{
		{Name: "a", TriggerWords: "styleA, glitch", AutoTrigger: true},
		{Name: "b", TriggerWords: "styleB", AutoTrigger: false},
		{Name: "c", TriggerWords: "solo|styleC", AutoTrigger: true},
	}
	got := applyLoraTriggers(settings, "1girl, solo, styleA")
	want := "glitch, styleC, 1girl, solo, styleA"
	if got != want {
		t.Fatalf("触发词结果 = %q，期望 %q", got, want)
	}
	if applyLoraTriggers(DefaultGenerationSettings(), "1girl") != "1girl" {
		t.Fatal("没有 LoRA 时不应改动提示词")
	}
}

func TestNormalizeGenerationSettings(t *testing.T) {
	loras := make([]LoraRef, 0, 10)
	for i := 0; i < 10; i++ {
		loras = append(loras, LoraRef{Name: "lora" + string(rune('a'+i)), Strength: 9, ClipStrength: -9})
	}
	loras = append(loras, LoraRef{Name: "loraa"})

	settings := NormalizeForTest(GenerationSettings{
		Width:        100,
		Height:       5000,
		Steps:        0,
		CFG:          -3,
		HiresScale:   9,
		HiresDenoise: 3,
		Repeat:       99,
		Loras:        loras,
	})

	if settings.Width != 256 || settings.Height != 2048 {
		t.Fatalf("尺寸 = %dx%d", settings.Width, settings.Height)
	}
	if settings.Steps != 28 || settings.CFG != 0 {
		t.Fatalf("采样 = %d 步 / CFG %v", settings.Steps, settings.CFG)
	}
	if settings.Sampler != "euler_ancestral" || settings.Scheduler != "normal" {
		t.Fatalf("采样器 = %q / %q", settings.Sampler, settings.Scheduler)
	}
	if settings.Repeat != 12 {
		t.Fatalf("连抽 = %d", settings.Repeat)
	}
	if settings.HiresScale != 2 || settings.HiresDenoise != 1 {
		t.Fatalf("高清修复 = %v / %v", settings.HiresScale, settings.HiresDenoise)
	}
	if len(settings.Loras) != 8 {
		t.Fatalf("LoRA 数量 = %d", len(settings.Loras))
	}
	if settings.Loras[0].Strength != 2 || settings.Loras[0].ClipStrength != -2 {
		t.Fatalf("LoRA 强度未夹紧: %#v", settings.Loras[0])
	}
}

// NormalizeForTest 暴露内部归一化，仅供同包测试的可读调用。
func NormalizeForTest(settings GenerationSettings) GenerationSettings {
	return normalizeGenerationSettings(settings)
}

func TestLoadGenOptions(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/object_info/CheckpointLoaderSimple", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["a.safetensors","b.safetensors"],{}]}}}}`)
	})
	mux.HandleFunc("/object_info/KSampler", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"KSampler":{"input":{"required":{"sampler_name":[["euler","dpmpp_2m"],{}],"scheduler":[["normal","karras"],{}]}}}}`)
	})
	mux.HandleFunc("/object_info/LoraLoader", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"LoraLoader":{"input":{"required":{"lora_name":[["x.safetensors","y.safetensors"],{}]}}}}`)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	s := &Server{comfy: newComfyClient(server.URL)}
	options, err := s.loadGenOptions(context.Background(), true)
	if err != nil {
		t.Fatalf("loadGenOptions: %v", err)
	}
	if !reflect.DeepEqual(options.Checkpoints, []string{"a.safetensors", "b.safetensors"}) {
		t.Fatalf("checkpoints = %#v", options.Checkpoints)
	}
	if !reflect.DeepEqual(options.Samplers, []string{"euler", "dpmpp_2m"}) {
		t.Fatalf("samplers = %#v", options.Samplers)
	}
	if !reflect.DeepEqual(options.Schedulers, []string{"normal", "karras"}) {
		t.Fatalf("schedulers = %#v", options.Schedulers)
	}
	if !reflect.DeepEqual(options.Loras, []string{"x.safetensors", "y.safetensors"}) {
		t.Fatalf("loras = %#v", options.Loras)
	}
}

func TestLoadGenOptionsDegraded(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	s := &Server{comfy: newComfyClient(server.URL)}
	if _, err := s.loadGenOptions(context.Background(), true); err == nil {
		t.Fatal("ComfyUI 不可用时应返回错误")
	}
}

func TestExtractGenImages(t *testing.T) {
	entry := comfyHistoryEntry{}
	entry.Outputs = map[string]struct {
		Images []comfyImageRef `json:"images"`
	}{
		"9": {Images: []comfyImageRef{{Filename: "a.png", Subfolder: "NoobAI/2026-11-16", Type: "output"}}},
	}
	images := extractGenImages(entry)
	if len(images) != 1 || images[0].Filename != "a.png" || images[0].Type != "output" {
		t.Fatalf("images = %#v", images)
	}
	url := genImageURL(images[0])
	if url == "" || url[:15] != "/api/gen/image?" {
		t.Fatalf("url = %q", url)
	}
}

func TestGenJobPayload(t *testing.T) {
	job := genJob{Status: "idle", Images: nil}
	raw, err := json.Marshal(job.payload())
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" || string(raw) == "null" {
		t.Fatal("job payload 为空")
	}
}
