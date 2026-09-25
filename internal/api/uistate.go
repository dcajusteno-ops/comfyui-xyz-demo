// uistate.go —— 移植 server/uiState.ts（前端持久化状态存储 /api/ui-state）。
// SSOT 是 server/uiState.ts；响应结构、错误文案、状态码逐字段对齐，勿单边改动。
//
// 前端此前把全部持久化状态存浏览器 localStorage（按 origin 隔离，端口漂移即"重置"），
// 现统一迁移到 data/ui-state.json（原子写 + 留档 + 写队列，与 notes 同款契约）。
package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// uiStateKeyMaxLength 对齐 TS 的 KEY_MAX_LENGTH。
const uiStateKeyMaxLength = 120

// UiStateStore 承载 /api/ui-state 的路径、写队列与 E2E 内存态。
type UiStateStore struct {
	RepoRoot string
	Queue    *storage.WriteQueue
	// InMemory 对齐 TS 的 DSH_E2E=1：全内存态，不读写 data/ui-state.json，防测试污染真实数据。
	InMemory bool

	memRevision int64
	memData     map[string]any
}

func (s *UiStateStore) file() string { return filepath.Join(s.RepoRoot, "data", "ui-state.json") }

// IsValidUiStateKey 对齐 isValidUiStateKey：非空字符串且 ≤120 长度。
func IsValidUiStateKey(key any) bool {
	str, ok := key.(string)
	return ok && len(str) > 0 && len(str) <= uiStateKeyMaxLength
}

// mergeUiStateEntries 对齐 mergeUiStateEntries：逐 key 合并，null 删除该 key。
func mergeUiStateEntries(data, entries map[string]any) map[string]any {
	next := make(map[string]any, len(data)+len(entries))
	for k, v := range data {
		next[k] = v
	}
	for k, v := range entries {
		if v == nil {
			delete(next, k)
		} else {
			next[k] = v
		}
	}
	return next
}

// Handle 对齐 handleUiStateRequest。
func (s *UiStateStore) Handle(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if s.InMemory {
			if s.memData == nil {
				s.memData = map[string]any{}
			}
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": s.memData, "revision": s.memRevision})
			return
		}
		existing, ok := storage.ReadJSONFile(s.file())
		data, hasData := existing["data"].(map[string]any)
		if ok && hasData {
			revision, _ := numOr(existing, "revision")
			storage.SendJSON(w, 200, map[string]any{"success": true, "data": data, "revision": revision})
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "data": map[string]any{}, "revision": int64(0)})

	case http.MethodPut:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		entries, isObj := payload["entries"].(map[string]any)
		if !isObj {
			// JSON null / 数组 / 缺失 → 与 TS 的 typeof 检查同为 400
			storage.SendJSON(w, 400, map[string]any{"success": false, "error": "payload.entries must be an object"})
			return
		}
		for key := range entries {
			if !IsValidUiStateKey(key) {
				preview := key
				if len(preview) > 40 {
					preview = preview[:40]
				}
				storage.SendJSON(w, 400, map[string]any{"success": false, "error": "invalid ui-state key: " + preview})
				return
			}
		}

		if s.InMemory {
			s.memData = mergeUiStateEntries(s.memData, entries)
			s.memRevision++
			storage.SendJSON(w, 200, map[string]any{"success": true, "revision": s.memRevision})
			return
		}

		file := s.file()
		var revision int64
		err = s.Queue.Do(file, func() error {
			// 对齐 notes：写前确保 data/ 存在（exe 全新解压目录可能没有）
			if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
				return err
			}
			baseRevision := int64(0)
			var baseData map[string]any
			if existing, ok := storage.ReadJSONFile(file); ok {
				if d, has := existing["data"].(map[string]any); has {
					baseData = d
					baseRevision, _ = numOr(existing, "revision")
				}
			}
			next := map[string]any{"revision": baseRevision + 1, "data": mergeUiStateEntries(baseData, entries)}
			if err := storage.AtomicWriteJSONWithBackup(file, next); err != nil {
				return err
			}
			revision = baseRevision + 1
			return nil
		})
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "revision": revision})

	case http.MethodDelete:
		if s.InMemory {
			s.memData = map[string]any{}
			s.memRevision++
			storage.SendJSON(w, 200, map[string]any{"success": true, "revision": s.memRevision})
			return
		}
		file := s.file()
		var revision int64
		err := s.Queue.Do(file, func() error {
			if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
				return err
			}
			prev := int64(0)
			if existing, ok := storage.ReadJSONFile(file); ok {
				prev, _ = numOr(existing, "revision")
			}
			next := map[string]any{"revision": prev + 1, "data": map[string]any{}}
			if err := storage.AtomicWriteJSONWithBackup(file, next); err != nil {
				return err
			}
			revision = prev + 1
			return nil
		})
		if err != nil {
			storage.SendError(w, err, 500)
			return
		}
		storage.SendJSON(w, 200, map[string]any{"success": true, "revision": revision})

	default:
		storage.SendJSON(w, 405, map[string]any{"success": false, "error": "Method Not Allowed"})
	}
}
