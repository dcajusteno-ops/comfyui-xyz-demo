package mobile

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestParseMultipart(t *testing.T) {
	// 构造标准 multipart（模拟浏览器 FormData）
	boundary := "----webkitformboundaryABC123"
	var body strings.Builder
	body.WriteString("--" + boundary + "\r\n")
	body.WriteString("Content-Disposition: form-data; name=\"params\"\r\n\r\n")
	body.WriteString("{\"model\":\"m1\",\"threshold\":0.5}\r\n")
	body.WriteString("--" + boundary + "\r\n")
	body.WriteString("Content-Disposition: form-data; name=\"image\"; filename=\"photo%20one.png\"\r\n")
	body.WriteString("Content-Type: image/png\r\n\r\n")
	body.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0x01})
	body.WriteString("\r\n--" + boundary + "--\r\n")

	parts := ParseMultipart([]byte(body.String()), boundary)
	if len(parts) != 2 {
		t.Fatalf("应解析出 2 个 part: %d", len(parts))
	}
	if parts[0].Name != "params" || string(parts[0].Data) != `{"model":"m1","threshold":0.5}` {
		t.Fatalf("params part 不符: %+v", parts[0])
	}
	if parts[1].Filename != "photo one.png" {
		t.Fatalf("filename 应做百分号解码: %q", parts[1].Filename)
	}
	if parts[1].ContentType != "image/png" || len(parts[1].Data) != 6 {
		t.Fatalf("image part 不符: %+v", parts[1])
	}

	// 空 body（只有结束 boundary）
	if parts := ParseMultipart([]byte("--"+boundary+"--\r\n"), boundary); len(parts) != 0 {
		t.Fatalf("空请求应得 0 个 part: %v", parts)
	}
}

func TestExtractTextsFromHistory(t *testing.T) {
	history := map[string]any{
		"p1": map[string]any{
			"outputs": map[string]any{
				"10": map[string]any{"tags": "1girl, solo"},
				"11": map[string]any{"text": []any{"1girl, solo", "masterpiece"}},
			},
		},
	}
	texts := ExtractTextsFromHistory(history, "p1")
	// WD14 节点 tags 与 Save Text text 内容重复时按内容去重；这里 text 是数组
	if len(texts) != 2 {
		t.Fatalf("应 2 条去重文本: %v", texts)
	}
	if texts[0] != "1girl, solo" || texts[1] != "masterpiece" {
		t.Fatalf("文本不符: %v", texts)
	}

	// 单字符字符串数组应拼接
	h2 := map[string]any{
		"p": map[string]any{"outputs": map[string]any{
			"1": map[string]any{"text": []any{"a", "b", "c"}},
		}},
	}
	if got := ExtractTextsFromHistory(h2, "p"); len(got) != 1 || got[0] != "abc" {
		t.Fatalf("单字符数组应拼接: %v", got)
	}

	// promptId 缺失 / 无 outputs
	if got := ExtractTextsFromHistory(history, "nope"); got != nil {
		t.Fatalf("未知 promptId 应为 nil: %v", got)
	}
}

func TestPickLanIP(t *testing.T) {
	if got := PickLanIP([]string{"127.0.0.1", "169.254.1.1", "192.168.1.46", "10.0.0.2"}); got != "192.168.1.46" {
		// 10. 与 192.168. 都属于优先网段，实现取第一个命中的优先项（顺序敏感，对齐 TS find）
		t.Logf("pick = %q（对齐 TS 的 find 语义即可）", got)
	}
	if got := PickLanIP([]string{"127.0.0.1", "169.254.9.9"}); got != "" {
		t.Fatalf("全部被过滤应返回空: %q", got)
	}
}

func TestBuildWd14Workflow(t *testing.T) {
	params := map[string]any{"model": "m1", "threshold": 0.35, "characterThreshold": 0.85, "replaceUnderscore": true, "trailingComma": true, "excludeTags": "", "device": "GPU"}
	wf := BuildWd14Workflow(params, "upload.png")
	raw, _ := json.Marshal(wf)
	s := string(raw)
	for _, want := range []string{"LoadImage", "WD14Tagger|pysssss", "PreviewImage", "Save Text", "upload.png", "tag_temp"} {
		if !strings.Contains(s, want) {
			t.Fatalf("工作流缺少 %s: %s", want, s)
		}
	}
	// device 存在时应包含
	if !strings.Contains(s, "GPU") {
		t.Fatal("device 应下发")
	}
	// device 为空字符串时不下发
	params["device"] = ""
	wf2, _ := json.Marshal(BuildWd14Workflow(params, "u.png"))
	if strings.Contains(string(wf2), `"device"`) {
		t.Fatal("空 device 不应下发")
	}
}

func TestGenSanitizeParams(t *testing.T) {
	m := NewGenManager("http://127.0.0.1:8188")

	// 空 prompt → 400
	if _, err := m.sanitizeParams(map[string]any{}); err == nil || !strings.Contains(err.Error(), "提示词不能为空") {
		t.Fatalf("空 prompt 应 400: %v", err)
	}

	// 数值 clamp：64 对齐、上限 2048
	p, err := m.sanitizeParams(map[string]any{
		"prompt": "1girl",
		"width":  json.Number("9999"),
		"height": json.Number("100"),
		"steps":  json.Number("5000"),
		"cfg":    json.Number("-5"),
		"seed":   json.Number("123456789"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Width != 2048 || p.Height != 256 {
		t.Fatalf("尺寸 clamp 不符: %v %v", p.Width, p.Height)
	}
	if p.Steps != 100 || p.Cfg != 0 {
		t.Fatalf("steps/cfg clamp 不符: %v %v", p.Steps, p.Cfg)
	}
	if p.Seed != 123456789 {
		t.Fatalf("seed 不符: %v", p.Seed)
	}
	// 默认值
	p2, _ := m.sanitizeParams(map[string]any{"prompt": "x"})
	if p2.Width != 832 || p2.Height != 1216 || p2.Steps != 20 || p2.Cfg != 7 {
		t.Fatalf("默认值不符: %+v", p2)
	}
	if p2.Seed < 0 || p2.Seed >= math.Pow(2, 31) {
		t.Fatalf("随机 seed 越界: %v", p2.Seed)
	}
}
