package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

func newTestStores(t *testing.T) *Stores {
	t.Helper()
	return &Stores{RepoRoot: t.TempDir(), Queue: storage.NewWriteQueue()}
}

func do(t *testing.T, h http.HandlerFunc, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	h(rec, r)
	return rec
}

func bodyJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("响应不是 JSON: %v: %s", err, rec.Body.String())
	}
	return m
}

// ---- notes ----

func TestNotes_GetDefault_Post_GetBack_Conflict(t *testing.T) {
	s := newTestStores(t)

	rec := do(t, s.HandleNotes, "GET", "/api/notes", "")
	if rec.Code != 200 {
		t.Fatalf("默认 GET 应 200: %d", rec.Code)
	}
	m := bodyJSON(t, rec)
	data := m["data"].(map[string]any)
	if data["revision"].(float64) != 0 {
		t.Fatalf("默认 revision 应为 0: %v", data)
	}
	if _, ok := data["notes"].([]any); !ok {
		t.Fatalf("默认 notes 应为数组: %v", data)
	}

	// POST 保存（带 baseRevision）
	rec = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":[{"id":1}],"baseRevision":0}`)
	if rec.Code != 200 {
		t.Fatalf("POST 应 200: %d %s", rec.Code, rec.Body.String())
	}
	if bodyJSON(t, rec)["revision"].(float64) != 1 {
		t.Fatal("revision 应为 1")
	}

	// 回读
	rec = do(t, s.HandleNotes, "GET", "/api/notes", "")
	data = bodyJSON(t, rec)["data"].(map[string]any)
	if data["revision"].(float64) != 1 || len(data["notes"].([]any)) != 1 {
		t.Fatalf("回读不符: %v", data)
	}

	// 过期 baseRevision → 409 + 最新数据
	rec = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":[],"baseRevision":0}`)
	if rec.Code != 409 {
		t.Fatalf("冲突应 409: %d", rec.Code)
	}
	m = bodyJSON(t, rec)
	if m["error"] != "Notes were modified in another window" {
		t.Fatalf("409 文案不符: %v", m["error"])
	}
	if m["revision"].(float64) != 1 {
		t.Fatalf("409 应附最新 revision: %v", m)
	}
	if _, ok := m["data"].(map[string]any); !ok {
		t.Fatalf("409 应附最新 data: %v", m)
	}

	// 不带 baseRevision → last-writer-wins
	rec = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":[{"id":2}]}`)
	if rec.Code != 200 {
		t.Fatalf("无 baseRevision 应 200: %d", rec.Code)
	}

	// 非数组 notes → 400
	rec = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":"x"}`)
	if rec.Code != 400 {
		t.Fatalf("应 400: %d", rec.Code)
	}

	// 未知方法 → 404
	rec = do(t, s.HandleNotes, "DELETE", "/api/notes", "")
	if rec.Code != 404 {
		t.Fatalf("DELETE 应 404: %d", rec.Code)
	}
}

func TestNotes_BackupFileCreated(t *testing.T) {
	s := newTestStores(t)
	_ = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":[{"id":1}],"baseRevision":0}`)
	_ = do(t, s.HandleNotes, "POST", "/api/notes", `{"notes":[{"id":2}],"baseRevision":1}`)
	// 首次 POST 时文件不存在不留档；第二次写时上一版存在 → 留档 1 份
	entries, err := os.ReadDir(filepath.Join(s.RepoRoot, "data", "backups"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "notes.json.") || !strings.HasSuffix(entries[0].Name(), ".bak") {
		t.Fatalf("应恰好 1 份 notes.json 留档: %v", entries)
	}
}

// ---- prompts ----

func TestPrompts_DefaultMergeAndRevision(t *testing.T) {
	s := newTestStores(t)

	rec := do(t, s.HandlePrompts, "GET", "/api/prompts", "")
	data := bodyJSON(t, rec)["data"].(map[string]any)
	if data["revision"].(float64) != 0 || len(data["favorites"].([]any)) != 0 {
		t.Fatalf("默认状态不符: %v", data)
	}

	rec = do(t, s.HandlePrompts, "POST", "/api/prompts", `{"favorites":[1,2],"baseRevision":0}`)
	if rec.Code != 200 || bodyJSON(t, rec)["revision"].(float64) != 1 {
		t.Fatalf("POST 失败: %d %s", rec.Code, rec.Body.String())
	}

	// 合并语义：只传 favorites，其余字段回落默认
	rec = do(t, s.HandlePrompts, "GET", "/api/prompts", "")
	data = bodyJSON(t, rec)["data"].(map[string]any)
	if len(data["favorites"].([]any)) != 2 {
		t.Fatalf("favorites 应为 2: %v", data)
	}
	for _, field := range []string{"recents", "customEntries", "templates"} {
		if _, ok := data[field].([]any); !ok {
			t.Fatalf("%s 应回落默认数组: %v", field, data)
		}
	}

	// 非数组字段被忽略（不报错），revision 仍递增
	rec = do(t, s.HandlePrompts, "POST", "/api/prompts", `{"favorites":"x"}`)
	if rec.Code != 200 || bodyJSON(t, rec)["revision"].(float64) != 2 {
		t.Fatalf("非法字段应被忽略: %d %s", rec.Code, rec.Body.String())
	}

	// 409
	rec = do(t, s.HandlePrompts, "POST", "/api/prompts", `{"baseRevision":0}`)
	if rec.Code != 409 || bodyJSON(t, rec)["error"] != "Prompts state was modified in another window" {
		t.Fatalf("409 不符: %d %s", rec.Code, rec.Body.String())
	}
}

// ---- wildcards ----

func TestWildcards_ListAndWrite(t *testing.T) {
	s := newTestStores(t)
	// TS 版 wildcards POST 不建 public/wildcards 目录（目录缺失同样 500），这里按真实场景预置
	_ = os.MkdirAll(filepath.Join(s.RepoRoot, "public", "wildcards"), 0o755)

	// 全部缺失 → missing:true, content:""
	rec := do(t, s.HandleWildcards, "GET", "/xyz/wildcards", "")
	m := bodyJSON(t, rec)
	files := m["files"].([]any)
	if len(files) != 4 {
		t.Fatalf("应 4 个词库: %v", m)
	}
	first := files[0].(map[string]any)
	if first["name"] != "styles" || first["missing"] != true || first["content"] != "" || first["revision"].(float64) != 0 {
		t.Fatalf("缺失词库条目不符: %v", first)
	}

	// 写入
	rec = do(t, s.HandleWildcards, "POST", "/xyz/wildcards", `{"name":"styles","content":"a\nb","baseRevision":0}`)
	if rec.Code != 200 || bodyJSON(t, rec)["revision"].(float64) != 1 {
		t.Fatalf("写入失败: %d %s", rec.Code, rec.Body.String())
	}
	// txt 落盘
	b, err := os.ReadFile(filepath.Join(s.RepoRoot, "public", "wildcards", "styles.txt"))
	if err != nil || string(b) != "a\nb" {
		t.Fatalf("txt 内容不符: %q %v", b, err)
	}
	// 回读
	rec = do(t, s.HandleWildcards, "GET", "/xyz/wildcards", "")
	first = bodyJSON(t, rec)["files"].([]any)[0].(map[string]any)
	if first["missing"] != false || first["content"] != "a\nb" || first["revision"].(float64) != 1 {
		t.Fatalf("回读不符: %v", first)
	}
	// 其余词库 revision 仍为 0
	second := bodyJSON(t, rec)["files"].([]any)[1].(map[string]any)
	if second["name"] != "lighting" || second["revision"].(float64) != 0 {
		t.Fatalf("其他词库不应被波及: %v", second)
	}

	// 白名单外 → 400 + 中文文案
	rec = do(t, s.HandleWildcards, "POST", "/xyz/wildcards", `{"name":"../evil","content":"x"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "未知词库") {
		t.Fatalf("白名单外应 400: %d %s", rec.Code, rec.Body.String())
	}
	// 缺 content → 400
	rec = do(t, s.HandleWildcards, "POST", "/xyz/wildcards", `{"name":"styles"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "缺少 content 字段") {
		t.Fatalf("缺 content 应 400: %d %s", rec.Code, rec.Body.String())
	}
	// 过期 baseRevision → 409（无 data 字段）
	rec = do(t, s.HandleWildcards, "POST", "/xyz/wildcards", `{"name":"styles","content":"z","baseRevision":0}`)
	if rec.Code != 409 || bodyJSON(t, rec)["error"] != "词库已在其它窗口被修改，请刷新后重试" {
		t.Fatalf("409 不符: %d %s", rec.Code, rec.Body.String())
	}
	// 未知方法 → 404
	rec = do(t, s.HandleWildcards, "DELETE", "/xyz/wildcards", "")
	if rec.Code != 404 {
		t.Fatalf("DELETE 应 404: %d", rec.Code)
	}
}

// ---- fsBrowse ----

func TestFsBrowse(t *testing.T) {
	s := newTestStores(t)
	_ = os.MkdirAll(filepath.Join(s.RepoRoot, "data", "backups"), 0o755)
	_ = os.MkdirAll(filepath.Join(s.RepoRoot, "public", "wildcards"), 0o755)
	_ = os.WriteFile(filepath.Join(s.RepoRoot, "file.txt"), []byte("x"), 0o644) // 文件不应出现在 folders

	rec := do(t, s.HandleFsBrowse, "GET", "/xyz/fs/folders", "")
	if rec.Code != 200 {
		t.Fatalf("应 200: %d", rec.Code)
	}
	m := bodyJSON(t, rec)
	if m["success"] != true {
		t.Fatalf("应成功: %v", m)
	}
	folders := m["folders"].([]any)
	if len(folders) != 2 {
		t.Fatalf("应只有 2 个子目录（不含文件）: %v", folders)
	}
	if m["parent"] == nil {
		t.Fatal("非根目录应有 parent")
	}

	// 不存在的目录 → 200 + success:false + error
	rec = do(t, s.HandleFsBrowse, "GET", "/xyz/fs/folders?path="+filepath.Join(s.RepoRoot, "no-such-dir"), "")
	if rec.Code != 200 {
		t.Fatalf("错误也应 200: %d", rec.Code)
	}
	m = bodyJSON(t, rec)
	if m["success"] != false || m["error"] == nil || len(m["folders"].([]any)) != 0 {
		t.Fatalf("错误响应结构不符: %v", m)
	}

	// 非 GET → 405
	rec = do(t, s.HandleFsBrowse, "POST", "/xyz/fs/folders", "{}")
	if rec.Code != 405 {
		t.Fatalf("POST 应 405: %d", rec.Code)
	}
}
