package noobai

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
)

// safetensors 表头里可能带训练元数据。Civitai 元数据缺失时（本地自训练 LoRA 很常见），
// 从这里兜底读出触发词，等价于造型台「从 .safetensors 文件头提取训练词」。

var commonLoraTags = map[string]bool{
	"1girl": true, "1boy": true, "2girls": true, "2boys": true, "solo": true,
	"multiple girls": true, "multiple boys": true,
	"long hair": true, "short hair": true, "black hair": true, "blonde hair": true,
	"brown hair": true, "white hair": true, "blue eyes": true, "red eyes": true,
	"green eyes": true, "looking at viewer": true, "upper body": true, "full body": true,
	"cowboy shot": true, "simple background": true, "white background": true,
	"grey background": true, "best quality": true, "masterpiece": true,
	"absurdres": true, "highres": true, "high quality": true, "detailed": true,
}

func (s *Server) handleGenLoraWords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		http.Error(w, "缺少 name", http.StatusBadRequest)
		return
	}
	words, err := s.loraWordsFor(r.Context(), name)
	payload := map[string]interface{}{
		"ok":            err == nil,
		"name":          name,
		"trigger_words": words,
	}
	if err != nil {
		payload["error"] = err.Error()
	}
	writeJSON(w, payload)
}

func (s *Server) loraWordsFor(ctx context.Context, name string) ([]string, error) {
	s.loraWordsMu.Lock()
	if words, ok := s.loraWordsCache[name]; ok {
		s.loraWordsMu.Unlock()
		return words, nil
	}
	s.loraWordsMu.Unlock()

	path := s.loraSourcePath(ctx, name)
	if path == "" {
		return nil, errors.New("未在 LoRA 管理器中找到该文件")
	}
	words, err := readSafetensorsTriggerWords(path)
	if err != nil {
		return nil, err
	}
	if words == nil {
		words = []string{}
	}
	s.loraWordsMu.Lock()
	if s.loraWordsCache == nil {
		s.loraWordsCache = map[string][]string{}
	}
	s.loraWordsCache[name] = words
	s.loraWordsMu.Unlock()
	return words, nil
}

func (s *Server) loraSourcePath(ctx context.Context, name string) string {
	items, _ := s.loadLoraMeta(ctx, false)
	for _, item := range items {
		if item.Name == name {
			return item.SourcePath
		}
	}
	return ""
}

func readSafetensorsTriggerWords(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New("读取失败：" + err.Error())
	}
	defer file.Close()

	var size uint64
	if err := binary.Read(file, binary.LittleEndian, &size); err != nil {
		return nil, errors.New("不是有效的 safetensors 文件")
	}
	if size == 0 || size > 32<<20 {
		return nil, errors.New("表头长度异常")
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(file, buf); err != nil {
		return nil, errors.New("表头读取不完整")
	}
	var head struct {
		Metadata map[string]string `json:"__metadata__"`
	}
	if err := json.Unmarshal(buf, &head); err != nil {
		return nil, errors.New("表头不是合法 JSON")
	}
	return triggerWordsFromMetadata(head.Metadata), nil
}

func triggerWordsFromMetadata(meta map[string]string) []string {
	if len(meta) == 0 {
		return nil
	}
	for _, key := range []string{"ss_trained_words", "ss_tagger_tags"} {
		if raw := strings.TrimSpace(meta[key]); raw != "" {
			if words := cleanTriggerWords([]string{raw}); len(words) > 0 {
				return words
			}
		}
	}
	if raw := strings.TrimSpace(meta["ss_tag_frequency"]); raw != "" {
		var groups map[string]map[string]float64
		if json.Unmarshal([]byte(raw), &groups) == nil {
			if words := topFrequencyWords(groups); len(words) > 0 {
				return words
			}
		}
	}
	if title := strings.TrimSpace(meta["modelspec.title"]); title != "" {
		return []string{title}
	}
	return nil
}

// topFrequencyWords 取「出现在每一张训练图上」且不是通用描述的词，
// 这通常是角色的触发词或风格标签。
func topFrequencyWords(groups map[string]map[string]float64) []string {
	best := map[string]float64{}
	total := 0.0
	for _, tags := range groups {
		sum := 0.0
		for _, count := range tags {
			sum += count
		}
		if sum > total {
			total = sum
			best = tags
		}
	}
	if total == 0 {
		return nil
	}
	max := 0.0
	for _, count := range best {
		if count > max {
			max = count
		}
	}
	words := make([]string, 0, 8)
	for tag, count := range best {
		if count < max {
			continue
		}
		clean := strings.TrimSpace(tag)
		if clean == "" || commonLoraTags[strings.ToLower(clean)] {
			continue
		}
		words = append(words, clean)
	}
	sort.Strings(words)
	if len(words) > 6 {
		words = words[:6]
	}
	return words
}
