// Package api 移植 server/ 下的本地读写类中间件（notes/prompts/wildcards/fsBrowse）。
// SSOT 是对应 TS 文件；响应结构、错误文案、状态码逐字段对齐。
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// Stores 持有各端点共用的路径与写队列。
type Stores struct {
	// RepoRoot 对齐 TS 的 path.resolve(process.cwd())。
	RepoRoot string
	Queue    *storage.WriteQueue
}

func numOr(m map[string]any, key string) (int64, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	if err != nil {
		return 0, false
	}
	return i, true
}

// ---- notes（server/notes.ts） ----

func (s *Stores) NotesFile() string { return filepath.Join(s.RepoRoot, "data", "notes.json") }

func (s *Stores) HandleNotes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		existing, ok := storage.ReadJSONFile(s.NotesFile())
		if ok {
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": existing})
		} else {
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"revision": 0, "notes": []any{}}})
		}
	case http.MethodPost:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		incomingNotes, isArr := payload["notes"].([]any)
		if !isArr {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "payload.notes must be an array"})
			return
		}
		// baseRevision 缺省时保持旧的 last-writer-wins 行为（向后兼容）；携带时做乐观并发检测
		baseRevision, hasBase := numOr(payload, "baseRevision")
		_ = os.MkdirAll(filepath.Dir(s.NotesFile()), 0o755)

		file := s.NotesFile()
		type outcome struct {
			conflict        bool
			currentRevision int64
			data            map[string]any
		}
		res, err := func() (outcome, error) {
			var oc outcome
			err := s.Queue.Do(file, func() error {
				existing, ok := storage.ReadJSONFile(file)
				current := int64(0)
				if ok {
					current, _ = numOr(existing, "revision")
				}
				if hasBase && baseRevision != current {
					oc = outcome{conflict: true, currentRevision: current, data: existing}
					return nil
				}
				next := map[string]any{"revision": current + 1, "notes": incomingNotes}
				if err := storage.AtomicWriteJSONWithBackup(file, next); err != nil {
					return err
				}
				oc = outcome{currentRevision: current + 1}
				return nil
			})
			return oc, err
		}()
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		if res.conflict {
			storage.SendJSON(w, 409, map[string]any{
				"success":  false,
				"error":    "Notes were modified in another window",
				"revision": res.currentRevision,
				"data":     res.data,
			})
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "revision": res.currentRevision})
	default:
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown notes endpoint"})
	}
}

// ---- prompts（server/prompts.ts） ----

func (s *Stores) PromptsFile() string {
	return filepath.Join(s.RepoRoot, "data", "prompts_state.json")
}

var promptsDefaults = map[string]any{
	"favorites":     []any{},
	"recents":       []any{},
	"customEntries": []any{},
	"templates":     []any{},
}

func (s *Stores) HandlePrompts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		existing, ok := storage.ReadJSONFile(s.PromptsFile())
		if ok {
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": existing})
		} else {
			def := map[string]any{"revision": 0}
			for k, v := range promptsDefaults {
				def[k] = v
			}
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": def})
		}
	case http.MethodPost:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		baseRevision, hasBase := numOr(payload, "baseRevision")
		_ = os.MkdirAll(filepath.Dir(s.PromptsFile()), 0o755)

		file := s.PromptsFile()
		type outcome struct {
			conflict        bool
			currentRevision int64
			data            map[string]any
		}
		res, err := func() (outcome, error) {
			var oc outcome
			err := s.Queue.Do(file, func() error {
				existing, ok := storage.ReadJSONFile(file)
				current := int64(0)
				if ok {
					current, _ = numOr(existing, "revision")
				}
				if hasBase && baseRevision != current {
					oc = outcome{conflict: true, currentRevision: current, data: existing}
					return nil
				}
				// 逐字段校验后整体落盘（沿用原有 schema 校验），并递增 revision
				next := map[string]any{"revision": current + 1}
				for k, v := range promptsDefaults {
					next[k] = v
				}
				for _, field := range []string{"favorites", "recents", "customEntries", "templates"} {
					if arr, isArr := payload[field].([]any); isArr {
						next[field] = arr
					}
				}
				if err := storage.AtomicWriteJSONWithBackup(file, next); err != nil {
					return err
				}
				oc = outcome{currentRevision: current + 1}
				return nil
			})
			return oc, err
		}()
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		if res.conflict {
			storage.SendJSON(w, 409, map[string]any{
				"success":  false,
				"error":    "Prompts state was modified in another window",
				"revision": res.currentRevision,
				"data":     res.data,
			})
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "revision": res.currentRevision})
	default:
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown prompts endpoint"})
	}
}

// ---- wildcards（server/wildcards.ts） ----

// wildcardNames 对齐 WILDCARD_NAMES（顺序即 GET 返回顺序）。
var wildcardNames = []string{"styles", "lighting", "camera", "quality"}

func (s *Stores) wildcardDir() string { return filepath.Join(s.RepoRoot, "public", "wildcards") }
func (s *Stores) wildcardsStateFile() string {
	return filepath.Join(s.RepoRoot, "data", "wildcards_state.json")
}

func (s *Stores) wildcardFile(name string) (string, error) {
	// name 已过白名单；仍用 Abs 复核一次（对齐 TS 的 resolve + startsWith 校验）
	absDir, err := filepath.Abs(s.wildcardDir())
	if err != nil {
		return "", err
	}
	target, err := filepath.Abs(filepath.Join(absDir, name+".txt"))
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(target, absDir+string(filepath.Separator)) {
		return "", fmt.Errorf("非法的词库名")
	}
	return target, nil
}

func (s *Stores) HandleWildcards(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		state, _ := storage.ReadJSONFile(s.wildcardsStateFile())
		filesRev := map[string]any{}
		if state != nil {
			if f, ok := state["files"].(map[string]any); ok {
				filesRev = f
			}
		}
		files := make([]map[string]any, 0, len(wildcardNames))
		for _, name := range wildcardNames {
			content, err := os.ReadFile(mustWildcardFile(s, name))
			missing := err != nil
			rev := int64(0)
			if n, ok := numOr(filesRev, name); ok {
				rev = n
			}
			entry := map[string]any{
				"name":     name,
				"content":  string(content),
				"missing":  missing,
				"revision": rev,
			}
			if !missing {
				entry["content"] = string(content)
			}
			files = append(files, entry)
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "files": files})
	case http.MethodPost:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		name, _ := payload["name"].(string)
		content, hasContent := payload["content"].(string)
		if !isWildcardName(name) {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": fmt.Sprintf("未知词库「%s」", name)})
			return
		}
		if !hasContent {
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "缺少 content 字段"})
			return
		}
		_ = os.MkdirAll(filepath.Dir(s.wildcardsStateFile()), 0o755)

		baseRevision, hasBase := numOr(payload, "baseRevision")
		stateFile := s.wildcardsStateFile()
		type outcome struct {
			conflict        bool
			currentRevision int64
		}
		res, err := func() (outcome, error) {
			var oc outcome
			err := s.Queue.Do(stateFile, func() error {
				state, _ := storage.ReadJSONFile(stateFile)
				filesRev := map[string]any{}
				if state != nil {
					if f, ok := state["files"].(map[string]any); ok {
						for k, v := range f {
							filesRev[k] = v
						}
					}
				}
				current := int64(0)
				if n, ok := numOr(filesRev, name); ok {
					current = n
				}
				if hasBase && baseRevision != current {
					oc = outcome{conflict: true, currentRevision: current}
					return nil
				}
				txt, err := s.wildcardFile(name)
				if err != nil {
					return err
				}
				if err := storage.AtomicWrite(txt, []byte(content)); err != nil {
					return err
				}
				next := current + 1
				filesRev[name] = json.Number(fmt.Sprintf("%d", next))
				nextState := map[string]any{"revision": next, "files": filesRev}
				if err := storage.AtomicWriteJSONWithBackup(stateFile, nextState); err != nil {
					return err
				}
				oc = outcome{currentRevision: next}
				return nil
			})
			return oc, err
		}()
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		if res.conflict {
			storage.SendJSON(w, 409, map[string]any{
				"success":  false,
				"error":    "词库已在其它窗口被修改，请刷新后重试",
				"revision": res.currentRevision,
			})
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "revision": res.currentRevision})
	default:
		storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown wildcards endpoint"})
	}
}

func isWildcardName(name string) bool {
	for _, n := range wildcardNames {
		if n == name {
			return true
		}
	}
	return false
}

func mustWildcardFile(s *Stores, name string) string {
	p, err := s.wildcardFile(name)
	if err != nil {
		panic(err) // 白名单内的固定名字，不可能触发
	}
	return p
}

// ---- fsBrowse（server/fsBrowse.ts） ----

func (s *Stores) HandleFsBrowse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}
	raw := r.URL.Query().Get("path")
	target, err := filepath.Abs(raw)
	if err != nil || raw == "" {
		target = s.RepoRoot
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		// 对齐 TS：错误也返回 200 + success:false（前端据 error 提示）
		storage.SendJSON(w, 200, map[string]any{
			"success": false,
			"path":    target,
			"error":   err.Error(),
			"folders": []any{},
		})
		return
	}
	var folders []string
	for _, e := range entries {
		if e.IsDir() {
			folders = append(folders, e.Name())
		}
	}
	// TS 用 localeCompare("zh-Hans-CN")；Go 无内建 collation，用字节序（对 ASCII 目录名等价）
	sort.Strings(folders)
	parent := filepath.Dir(target)
	var parentAny any
	if parent != target {
		parentAny = parent
	}
	storage.SendJSON(w, 200, map[string]any{
		"success": true,
		"path":    target,
		"parent":  parentAny,
		"folders": folders,
	})
}
