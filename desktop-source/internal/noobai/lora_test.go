package noobai

import (
	"strings"
	"testing"
)

func TestLoraPathHelpers(t *testing.T) {
	cases := []struct {
		filePath string
		wantRel  string
	}{
		{"F:/AIimg/ComfyUI/models/loras/SDXL/NSFW/a.safetensors", "SDXL/NSFW/a.safetensors"},
		{`F:\AIimg\ComfyUI\models\loras\AnimaLora\cs\x.safetensors`, "AnimaLora/cs/x.safetensors"},
		{"/opt/comfy/models/loras/y.safetensors", "y.safetensors"},
		{"C:/other/place/z.safetensors", ""},
	}
	for _, tc := range cases {
		if got := loraRelPath(tc.filePath); got != tc.wantRel {
			t.Fatalf("loraRelPath(%q) = %q, want %q", tc.filePath, got, tc.wantRel)
		}
	}

	if got := loraBaseName(`AnimaLora\cs\fengyao.safetensors`); got != "fengyao.safetensors" {
		t.Fatalf("loraBaseName = %q", got)
	}
	if got := loraStem(`AnimaLora\cs\fengyao.safetensors`); got != "fengyao" {
		t.Fatalf("loraStem = %q", got)
	}
}

func TestLoraPreviewPath(t *testing.T) {
	local := "/api/lm/previews?path=F%3A%2Fx.jpeg&v=1"
	got := loraPreviewPath(local)
	if !strings.HasPrefix(got, "/api/gen/lora-preview?path=") {
		t.Fatalf("local preview should be proxied, got %q", got)
	}
	if loraPreviewPath("https://civitai.com/x.jpg") != "" {
		t.Fatal("external preview should be dropped")
	}
	if loraPreviewPath("") != "" {
		t.Fatal("empty preview should stay empty")
	}
}

func TestCleanTriggerWords(t *testing.T) {
	raw := []string{"<lora:2koma-x:1>, 2koma fellatio, 2koma", "looking at viewer，blush"}
	got := cleanTriggerWords(raw)
	want := []string{"2koma fellatio", "2koma", "looking at viewer", "blush"}
	if len(got) != len(want) {
		t.Fatalf("cleanTriggerWords = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("cleanTriggerWords[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if len(cleanTriggerWords([]string{"", "  ", "<lora:x:1>"})) != 0 {
		t.Fatal("empty / lora syntax should be dropped")
	}
}

func TestTriggerWordsFromMetadata(t *testing.T) {
	// kohya 风格：所有训练图都带角色名，其余是通用描述
	freq := `{"1_zkz": {"ashima \\(roro046\\)": 52, "1girl": 52, "solo": 40, "long hair": 46, "green eyes": 15}}`
	got := triggerWordsFromMetadata(map[string]string{"ss_tag_frequency": freq})
	if len(got) != 1 || got[0] != "ashima \\(roro046\\)" {
		t.Fatalf("tag frequency words = %#v", got)
	}

	// 显式训练词优先
	got = triggerWordsFromMetadata(map[string]string{
		"ss_trained_words": "styleA, styleB, styleA",
		"ss_tag_frequency": freq,
		"modelspec.title":  "ignored",
	})
	if len(got) != 2 || got[0] != "styleA" || got[1] != "styleB" {
		t.Fatalf("trained words = %#v", got)
	}

	// 没有训练词时退回模型标题
	got = triggerWordsFromMetadata(map[string]string{"modelspec.title": "ashima"})
	if len(got) != 1 || got[0] != "ashima" {
		t.Fatalf("title fallback = %#v", got)
	}

	if triggerWordsFromMetadata(nil) != nil {
		t.Fatal("empty metadata should return nil")
	}
}

func TestDisabledLoraSkipped(t *testing.T) {
	settings := DefaultGenerationSettings()
	settings.Checkpoint = "model.safetensors"
	settings.Loras = []LoraRef{
		{Name: "a.safetensors", Strength: 1, ClipStrength: 1, TriggerWords: "styleA", AutoTrigger: true},
		{Name: "b.safetensors", Strength: 1, ClipStrength: 1, TriggerWords: "styleB", AutoTrigger: true, Disabled: true},
	}

	nodes := buildNoobaiWorkflow(settings, "1girl", "bad", 42)
	loaders := 0
	for _, node := range nodes {
		if node.ClassType == "LoraLoader" {
			loaders++
			if node.Inputs["lora_name"] == "b.safetensors" {
				t.Fatal("disabled LoRA should not be in workflow")
			}
		}
	}
	if loaders != 1 {
		t.Fatalf("LoraLoader nodes = %d, want 1", loaders)
	}

	positive := applyLoraTriggers(settings, "1girl")
	if strings.Contains(positive, "styleB") {
		t.Fatalf("disabled LoRA trigger should be skipped: %q", positive)
	}
	if !strings.Contains(positive, "styleA") {
		t.Fatalf("enabled LoRA trigger should be kept: %q", positive)
	}
}
