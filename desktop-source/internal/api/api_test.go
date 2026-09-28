package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

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

// ---- wildcards：exe 布局（单文件 exe 旁边没有 public/wildcards）----

// 回归：旧实现把词库目录写死成 public/wildcards，而单文件 exe 旁边并没有 public/ ——
// GET 四个词库全返回 missing + 空内容（编辑器打开是空白），POST 直接 500：
//
//	open ...\public\wildcards\styles.txt.12345.tmp: The system cannot find the path specified.
//
// 现在应落到 data/wildcards，并由内嵌 dist 播种内置词库。
func TestWildcards_ExeLayoutUsesRuntimeDirAndSeeds(t *testing.T) {
	s := newTestStores(t) // t.TempDir() 下没有 public/wildcards = exe 布局
	if dirExists(filepath.Join(s.RepoRoot, "public", "wildcards")) {
		t.Fatal("前置条件不成立：public/wildcards 不应存在")
	}
	dist := fstest.MapFS{
		"wildcards/styles.txt":   {Data: []byte("# styles\nanime style\n")},
		"wildcards/lighting.txt": {Data: []byte("golden hour\n")},
	}

	if err := s.SeedWildcards(dist); err != nil {
		t.Fatalf("SeedWildcards: %v", err)
	}
	if want := filepath.Join(s.RepoRoot, "data", "wildcards"); s.wildcardDir() != want {
		t.Fatalf("wildcardDir = %q, 期望 %q", s.wildcardDir(), want)
	}

	// 播种成功 → 不再是 missing，内容来自内嵌词库
	rec := do(t, s.HandleWildcards, "GET", "/xyz/wildcards", "")
	byName := map[string]map[string]any{}
	for _, f := range bodyJSON(t, rec)["files"].([]any) {
		e := f.(map[string]any)
		byName[e["name"].(string)] = e
	}
	if byName["styles"]["missing"] != false || byName["styles"]["content"] != "# styles\nanime style\n" {
		t.Fatalf("styles 未播种: %v", byName["styles"])
	}
	// 内嵌里没有的词库保持 missing（不因播种整体成功就伪造内容）
	if byName["camera"]["missing"] != true {
		t.Fatalf("camera 无内嵌内容应保持 missing: %v", byName["camera"])
	}

	// POST：exe 里原本 500，现在应成功并落盘到 data/wildcards
	rec = do(t, s.HandleWildcards, "POST", "/xyz/wildcards", `{"name":"styles","content":"# edited\nwatercolor\n","baseRevision":0}`)
	if rec.Code != 200 {
		t.Fatalf("POST 应 200，实得 %d %s", rec.Code, rec.Body.String())
	}
	b, err := os.ReadFile(filepath.Join(s.RepoRoot, "data", "wildcards", "styles.txt"))
	if err != nil || string(b) != "# edited\nwatercolor\n" {
		t.Fatalf("未落到 data/wildcards: %q %v", b, err)
	}

	// /wildcards/styles.txt 必须回放编辑后的内容 —— 否则保存「成功」但展开仍读内嵌旧版，
	// 编辑静默失效（比直接报错更难查）。
	rec2 := httptest.NewRecorder()
	s.ServeWildcardFile(rec2, httptest.NewRequest("GET", "/wildcards/styles.txt", nil), dist)
	if rec2.Code != 200 || rec2.Body.String() != "# edited\nwatercolor\n" {
		t.Fatalf("ServeWildcardFile 未回放编辑后内容: %d %q", rec2.Code, rec2.Body.String())
	}
	// 工作目录里没有的仍在 dist 里回退命中
	rec2 = httptest.NewRecorder()
	s.ServeWildcardFile(rec2, httptest.NewRequest("GET", "/wildcards/lighting.txt", nil), dist)
	if rec2.Code != 200 || rec2.Body.String() != "golden hour\n" {
		t.Fatalf("回退内嵌版本失败: %d %q", rec2.Code, rec2.Body.String())
	}
	// 白名单外 → 404（不泄漏 dist 里的任意文件）
	rec2 = httptest.NewRecorder()
	s.ServeWildcardFile(rec2, httptest.NewRequest("GET", "/wildcards/../favicon.svg", nil), dist)
	if rec2.Code != 404 {
		t.Fatalf("白名单外应 404，实得 %d", rec2.Code)
	}
}

// dev / 测试布局（public/wildcards 存在）必须保持原行为：目录就是源码树里那个，且不播种。
func TestWildcards_DevLayoutKeepsSourceDir(t *testing.T) {
	s := newTestStores(t)
	src := filepath.Join(s.RepoRoot, "public", "wildcards")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	dist := fstest.MapFS{"wildcards/styles.txt": {Data: []byte("from dist\n")}}
	if err := s.SeedWildcards(dist); err != nil {
		t.Fatalf("SeedWildcards: %v", err)
	}
	if s.wildcardDir() != src {
		t.Fatalf("dev 布局应沿用 public/wildcards，实得 %q", s.wildcardDir())
	}
	if _, err := os.Stat(filepath.Join(src, "styles.txt")); err == nil {
		t.Fatal("dev 布局不应播种（会把 dist 的副本写进源码树）")
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
