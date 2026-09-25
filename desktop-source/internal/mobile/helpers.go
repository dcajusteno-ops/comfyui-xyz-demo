// Package mobile 移植 server/mobileSync.ts（手机识图联动）与 server/mobileGen.ts（手机远程生图）。
// 依赖的 src/lib 纯函数（parseMultipart / extractTextsFromHistory / buildWd14Workflow / pickLanIp / CONFIG.MOBILE）一并移植于此。
package mobile

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// CONFIG.MOBILE 常量（对齐 src/config.ts）。
const (
	MaxTasks      = 50
	MaxImageBytes = 20 * 1024 * 1024
	MaxQueue      = 10
	HeartbeatMS   = 20000
	PageHash      = "#/mobile-tag"
)

// StatusError 携带 HTTP 状态码（对齐 TS HttpError）。
type StatusError struct {
	Status int
	Msg    string
}

func (e *StatusError) Error() string { return e.Msg }

// UUIDv4 生成随机 UUID（对齐 randomUUID）。
func UUIDv4() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// PickLanIP 对齐 src/lib/lanAddress.ts 的 pickLanIp。
func PickLanIP(addresses []string) string {
	reIPv4 := regexp.MustCompile(`^(\d{1,3}\.){3}\d{1,3}$`)
	reExclude := regexp.MustCompile(`^(127\.|169\.254\.|0\.|255\.).*$`)
	rePreferred := regexp.MustCompile(`^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.).*$`)
	var candidates []string
	for _, a := range addresses {
		if reIPv4.MatchString(a) && !reExclude.MatchString(a) {
			candidates = append(candidates, a)
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	for _, a := range candidates {
		if rePreferred.MatchString(a) {
			return a
		}
	}
	return candidates[0]
}

// LanIP 枚举本机 IPv4（排除回环/链路本地）并挑出最可达的。
func LanIP() string {
	var addresses []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip4 := ipnet.IP.To4(); ip4 != nil && !ip4.IsLoopback() && !ip4.IsLinkLocalUnicast() {
				addresses = append(addresses, ip4.String())
			}
		}
	}
	return PickLanIP(addresses)
}

// DoJSON 对齐 mobileSync/mobileGen 的 fetchJson：超时 + 非 200 → StatusError(502)。
// 调用方负责构造请求（方法/头/体），label 用于错误文案。
func DoJSON(client *http.Client, req *http.Request, timeoutMS int, label string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(req.Context(), time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()
	resp, err := client.Do(req.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &StatusError{Status: 502, Msg: fmt.Sprintf("ComfyUI 请求失败（%s → %d）", label, resp.StatusCode)}
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetJSON 便捷封装：GET 请求。
func GetJSON(client *http.Client, urlStr string, timeoutMS int) (map[string]any, error) {
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	return DoJSON(client, req, timeoutMS, urlStr)
}

// PostJSON 便捷封装：POST JSON 请求。
func PostJSON(client *http.Client, urlStr string, body any, timeoutMS int) (map[string]any, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest("POST", urlStr, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return DoJSON(client, req, timeoutMS, urlStr)
}

// ---- multipart 解析（对齐 src/lib/mobileSync.ts 的 parseMultipart） ----

type MultipartPart struct {
	Name        string
	Filename    string
	ContentType string
	Data        []byte
}

func indexOfBytes(haystack, needle []byte, from int) int {
	return bytes.Index(haystack[from:], needle) + from
}

func decodeFilename(raw string) string {
	if strings.Contains(raw, "%") {
		if v, err := url.PathUnescape(raw); err == nil {
			return v
		}
	}
	return raw
}

var (
	reName     = regexp.MustCompile(`name="([^"]*)"`)
	reFilename = regexp.MustCompile(`filename="([^"]*)"`)
)

// ParseMultipart 极简 multipart/form-data 解析（仅平铺字段）。
func ParseMultipart(raw []byte, boundary string) []MultipartPart {
	delim := []byte("--" + boundary)
	var parts []MultipartPart
	cursor := indexOfBytes(raw, delim, 0)
	if cursor == -1 {
		return parts
	}
	cursor += len(delim)
	// 首行 boundary 后必须是 --（空请求）或 \r\n
	if cursor+1 < len(raw) && raw[cursor] == 45 && raw[cursor+1] == 45 {
		return parts
	}
	cursor += 2
	crlfcrlf := []byte{13, 10, 13, 10}
	needle := append([]byte{13, 10}, delim...)

	for cursor < len(raw) {
		headerEnd := indexOfBytes(raw, crlfcrlf, cursor)
		if headerEnd == -1 || headerEnd < cursor {
			break
		}
		headers := string(raw[cursor:headerEnd])
		bodyStart := headerEnd + 4
		nextDelim := indexOfBytes(raw, needle, bodyStart)
		if nextDelim == -1 || nextDelim < bodyStart {
			break
		}
		part := MultipartPart{Data: raw[bodyStart:nextDelim]}
		for _, line := range strings.Split(headers, "\r\n") {
			if strings.HasPrefix(line, "Content-Disposition:") {
				if m := reName.FindStringSubmatch(line); m != nil {
					part.Name = m[1]
				}
				if m := reFilename.FindStringSubmatch(line); m != nil {
					part.Filename = decodeFilename(m[1])
				}
			}
			if strings.HasPrefix(line, "Content-Type:") {
				part.ContentType = strings.TrimSpace(line[strings.Index(line, ":")+1:])
			}
		}
		parts = append(parts, part)
		cursor = nextDelim + len(needle)
		if cursor+1 < len(raw) && raw[cursor] == 45 && raw[cursor+1] == 45 {
			break
		}
		cursor += 2
	}
	return parts
}

// ---- history 文本提取（对齐 src/lib/mobileSync.ts 的 extractTextsFromHistory） ----

func pushHistoryValue(raw *[]string, value any) {
	switch v := value.(type) {
	case []any:
		var valid []string
		allSingle := true
		for _, item := range v {
			switch x := item.(type) {
			case string:
				valid = append(valid, x)
				if len(x) != 1 {
					allSingle = false
				}
			case float64:
				valid = append(valid, fmt.Sprintf("%v", x))
				allSingle = false
			}
		}
		if len(valid) == 0 {
			return
		}
		if len(valid) > 1 && allSingle {
			*raw = append(*raw, strings.Join(valid, ""))
		} else {
			*raw = append(*raw, valid...)
		}
	case string:
		if strings.TrimSpace(v) != "" {
			*raw = append(*raw, v)
		}
	case float64:
		s := fmt.Sprintf("%v", v)
		if strings.TrimSpace(s) != "" {
			*raw = append(*raw, s)
		}
	}
}

var historyTextKeys = []string{"text", "texts", "STRING", "string", "tags", "csv"}

// ExtractTextsFromHistory 从 ComfyUI history 提取文本结果（按内容去重、保序）。
func ExtractTextsFromHistory(history map[string]any, promptID string) []string {
	var entry map[string]any
	if promptID != "" {
		entry, _ = history[promptID].(map[string]any)
	} else {
		for _, v := range history {
			entry, _ = v.(map[string]any)
			break
		}
	}
	if entry == nil {
		return nil
	}
	outputs, _ := entry["outputs"].(map[string]any)
	if outputs == nil {
		return nil
	}
	var raw []string
	for _, output := range outputs {
		obj, ok := output.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range historyTextKeys {
			if v, ok := obj[key]; ok {
				pushHistoryValue(&raw, v)
			}
		}
	}
	seen := map[string]bool{}
	var texts []string
	for _, t := range raw {
		if !seen[t] {
			seen[t] = true
			texts = append(texts, t)
		}
	}
	return texts
}

// ---- WD14 工作流（对齐 src/lib/wd14Workflow.ts 的 buildWd14Workflow） ----

func metaNode(classType string, inputs map[string]any, title string) map[string]any {
	return map[string]any{
		"class_type": classType,
		"inputs":     inputs,
		"_meta":      map[string]any{"title": title},
	}
}

// BuildWd14Workflow params 来自手机上传的 JSON（已与默认值合并），imageName 来自上传结果。
func BuildWd14Workflow(params map[string]any, imageName string) map[string]any {
	inputs := map[string]any{
		"image":               []any{"1", 0},
		"model":               params["model"],
		"threshold":           params["threshold"],
		"character_threshold": params["characterThreshold"],
		"replace_underscore":  params["replaceUnderscore"],
		"trailing_comma":      params["trailingComma"],
		"exclude_tags":        params["excludeTags"],
	}
	if device, ok := params["device"]; ok && device != nil && device != "" {
		inputs["device"] = device
	}
	return map[string]any{
		"1": metaNode("LoadImage", map[string]any{"image": imageName}, "Load Image"),
		"2": metaNode("WD14Tagger|pysssss", inputs, "WD14 Tagger"),
		"3": metaNode("PreviewImage", map[string]any{"images": []any{"1", 0}}, "Preview Image"),
		"4": metaNode("> Save Text", map[string]any{
			"text":            []any{"2", 0},
			"filename_opt":    "tag_temp",
			"filename_prefix": "",
			"folder":          "tagging",
		}, "Save Tags"),
	}
}
