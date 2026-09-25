package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// uistate_test.go —— /api/ui-state 契约固化（SSOT：server/uiState.test.ts 同款用例语义）。

func newUiStateStore(t *testing.T) *UiStateStore {
	t.Helper()
	return &UiStateStore{RepoRoot: t.TempDir(), Queue: storage.NewWriteQueue()}
}

func TestUiState_GetDefault_Put_Merge_DeleteKey(t *testing.T) {
	s := newUiStateStore(t)

	// 空状态
	rec := do(t, s.Handle, "GET", "/api/ui-state", "")
	if rec.Code != 200 {
		t.Fatalf("空 GET 应 200: %d", rec.Code)
	}
	m := bodyJSON(t, rec)
	if m["revision"].(float64) != 0 || len(m["data"].(map[string]any)) != 0 {
		t.Fatalf("默认应为空状态: %v", m)
	}

	// PUT 两个 key
	rec = do(t, s.Handle, "PUT", "/api/ui-state", `{"entries":{"theme":"dark","params":{"steps":20}}}`)
	if rec.Code != 200 {
		t.Fatalf("PUT 应 200: %d %s", rec.Code, rec.Body.String())
	}
	if bodyJSON(t, rec)["revision"].(float64) != 1 {
		t.Fatal("首次 PUT 后 revision 应为 1")
	}

	// 回读
	rec = do(t, s.Handle, "GET", "/api/ui-state", "")
	data := bodyJSON(t, rec)["data"].(map[string]any)
	if data["theme"] != "dark" {
		t.Fatalf("theme 应为 dark: %v", data)
	}
	if data["params"].(map[string]any)["steps"].(float64) != 20 {
		t.Fatalf("params.steps 应为 20: %v", data)
	}

	// 二次 PUT：覆盖 + null 删除
	rec = do(t, s.Handle, "PUT", "/api/ui-state", `{"entries":{"theme":null,"params":{"steps":30}}}`)
	if rec.Code != 200 {
		t.Fatalf("二次 PUT 应 200: %d", rec.Code)
	}
	rec = do(t, s.Handle, "GET", "/api/ui-state", "")
	data = bodyJSON(t, rec)["data"].(map[string]any)
	if _, exists := data["theme"]; exists {
		t.Fatalf("null 应删除 theme key: %v", data)
	}
	if data["params"].(map[string]any)["steps"].(float64) != 30 {
		t.Fatalf("params.steps 应更新为 30: %v", data)
	}
}

func TestUiState_Delete_ClearsAll(t *testing.T) {
	s := newUiStateStore(t)
	if rec := do(t, s.Handle, "PUT", "/api/ui-state", `{"entries":{"a":1,"b":2}}`); rec.Code != 200 {
		t.Fatalf("PUT 应 200: %d", rec.Code)
	}
	rec := do(t, s.Handle, "DELETE", "/api/ui-state", "")
	if rec.Code != 200 {
		t.Fatalf("DELETE 应 200: %d", rec.Code)
	}
	if bodyJSON(t, rec)["revision"].(float64) != 2 {
		t.Fatal("DELETE 后 revision 应为 2")
	}
	rec = do(t, s.Handle, "GET", "/api/ui-state", "")
	if data := bodyJSON(t, rec)["data"].(map[string]any); len(data) != 0 {
		t.Fatalf("DELETE 后应为空: %v", data)
	}
}

func TestUiState_Validation(t *testing.T) {
	s := newUiStateStore(t)

	// entries 缺失 / null / 数组 → 400
	for _, body := range []string{`{}`, `{"entries":null}`, `{"entries":[1]}`} {
		rec := do(t, s.Handle, "PUT", "/api/ui-state", body)
		if rec.Code != 400 {
			t.Fatalf("entries 非法应 400: %s → %d", body, rec.Code)
		}
	}

	// 空 key / 超长 key → 400
	longKey := make([]byte, 121)
	for i := range longKey {
		longKey[i] = 'x'
	}
	for _, key := range []string{"", string(longKey)} {
		rec := do(t, s.Handle, "PUT", "/api/ui-state", `{"entries":{"`+key+`":1}}`)
		if rec.Code != 400 {
			t.Fatalf("非法 key 应 400: %q → %d", key, rec.Code)
		}
	}

	// 其它方法 → 405
	if rec := do(t, s.Handle, "POST", "/api/ui-state", `{"entries":{}}`); rec.Code != 405 {
		t.Fatalf("POST 应 405: %d", rec.Code)
	}
}

func TestUiState_InMemoryMode(t *testing.T) {
	s := &UiStateStore{RepoRoot: t.TempDir(), Queue: storage.NewWriteQueue(), InMemory: true}

	rec := do(t, s.Handle, "PUT", "/api/ui-state", `{"entries":{"theme":"dark"}}`)
	if rec.Code != 200 {
		t.Fatalf("PUT 应 200: %d", rec.Code)
	}
	// 内存态不落盘
	if _, ok := storage.ReadJSONFile(s.file()); ok {
		t.Fatal("InMemory 模式不应写 data/ui-state.json")
	}
	rec = do(t, s.Handle, "GET", "/api/ui-state", "")
	if data := bodyJSON(t, rec)["data"].(map[string]any); data["theme"] != "dark" {
		t.Fatalf("内存态应可回读: %v", data)
	}
	// 独立实例互不可见（每次 E2E 会话全新开始）
	other := &UiStateStore{RepoRoot: t.TempDir(), Queue: storage.NewWriteQueue(), InMemory: true}
	rec = do(t, other.Handle, "GET", "/api/ui-state", "")
	if data := bodyJSON(t, rec)["data"].(map[string]any); len(data) != 0 {
		t.Fatalf("新实例应为空: %v", data)
	}
}

func TestUiState_CorruptFile_FallsBackToEmpty(t *testing.T) {
	s := newUiStateStore(t)
	if err := os.MkdirAll(filepath.Join(s.RepoRoot, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := storage.AtomicWrite(s.file(), []byte("{not json")); err != nil {
		t.Fatal(err)
	}
	rec := do(t, s.Handle, "GET", "/api/ui-state", "")
	if rec.Code != 200 {
		t.Fatalf("损坏文件 GET 应 200: %d", rec.Code)
	}
	m := bodyJSON(t, rec)
	if m["revision"].(float64) != 0 {
		t.Fatalf("损坏文件应回退 revision 0: %v", m)
	}
}
