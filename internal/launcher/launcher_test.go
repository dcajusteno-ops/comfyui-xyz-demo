package launcher

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	return NewStore(t.TempDir())
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

// ---- 命令构造（与 server/launcher.test.ts 成对，防单边改动） ----

func TestResolveLaunchCommand(t *testing.T) {
	file, args, cwd := ResolveLaunchCommand(`D:\tools\merger.exe`, "--listen 0.0.0.0")
	if file != `D:\tools\merger.exe` || cwd != `D:\tools` {
		t.Fatalf("exe 直启: %q %q", file, cwd)
	}
	if !reflect.DeepEqual(args, []string{"--listen", "0.0.0.0"}) {
		t.Fatalf("args 应按空白切分: %v", args)
	}

	file, args, _ = ResolveLaunchCommand(`D:\tools\script.bat`, "")
	if file != "cmd.exe" {
		t.Fatalf(".bat 应走 cmd.exe: %q", file)
	}
	if !reflect.DeepEqual(args, []string{"/c", "start", "", `D:\tools\script.bat`}) {
		t.Fatalf("start 语义应为 [/c start \"\" path]: %v", args)
	}

	// 大小写不敏感（对齐 TS path.extname().toLowerCase()）
	file, _, _ = ResolveLaunchCommand(`D:\t\page.HTML`, "")
	if file != "cmd.exe" {
		t.Fatalf("扩展名应大小写不敏感: %q", file)
	}

	// 未知扩展名按可执行文件直启（与原实现一致）
	file, _, _ = ResolveLaunchCommand(`D:\notes\readme.txt`, "")
	if file != `D:\notes\readme.txt` {
		t.Fatalf("未知扩展名应直启: %q", file)
	}
}

func TestSplitLaunchArgs(t *testing.T) {
	if got := SplitLaunchArgs("  --a   --b \t "); !reflect.DeepEqual(got, []string{"--a", "--b"}) {
		t.Fatalf("strings.Fields 语义: %v", got)
	}
	if len(SplitLaunchArgs("")) != 0 {
		t.Fatal("空串应得空切片")
	}
}

// ---- CRUD roundtrip（httptest） ----

func TestLauncher_CRUD_Roundtrip(t *testing.T) {
	s := newTestStore(t)

	// 空列表默认
	rec := do(t, s.Handle, "GET", "/xyz/launcher", "")
	if rec.Code != 200 {
		t.Fatalf("GET 默认应 200: %d", rec.Code)
	}
	if m := bodyJSON(t, rec); len(m["tools"].([]any)) != 0 {
		t.Fatalf("默认 tools 应为空数组: %v", m)
	}

	// POST 添加
	rec = do(t, s.Handle, "POST", "/xyz/launcher", `{"name":"模型合并器","path":"D:\\tools\\m.exe","args":"--x","icon":""}`)
	if rec.Code != 200 {
		t.Fatalf("POST 应 200: %d %s", rec.Code, rec.Body.String())
	}
	m := bodyJSON(t, rec)
	tool := m["tool"].(map[string]any)
	id, _ := tool["id"].(string)
	if id == "" {
		t.Fatalf("POST 应返回生成的 id: %v", tool)
	}

	// GET 回读
	rec = do(t, s.Handle, "GET", "/xyz/launcher", "")
	tools := bodyJSON(t, rec)["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("应有 1 个工具: %v", tools)
	}

	// PUT 更新
	rec = do(t, s.Handle, "PUT", "/xyz/launcher", `{"id":"`+id+`","name":"改名","path":"D:\\tools\\m2.exe","args":"","icon":""}`)
	if rec.Code != 200 {
		t.Fatalf("PUT 应 200: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(t, s.Handle, "GET", "/xyz/launcher", "")
	tools = bodyJSON(t, rec)["tools"].([]any)
	if tools[0].(map[string]any)["name"] != "改名" {
		t.Fatalf("PUT 后名称应更新: %v", tools)
	}

	// PUT 未知 id → 404 "tool not found"（对齐 TS 文案）
	rec = do(t, s.Handle, "PUT", "/xyz/launcher", `{"id":"nope","name":"x","path":"D:\\x.exe"}`)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "tool not found") {
		t.Fatalf("PUT 未知 id 应 404: %d %s", rec.Code, rec.Body.String())
	}

	// DELETE
	rec = do(t, s.Handle, "DELETE", "/xyz/launcher?id="+id, "")
	if rec.Code != 200 {
		t.Fatalf("DELETE 应 200: %d", rec.Code)
	}
	rec = do(t, s.Handle, "GET", "/xyz/launcher", "")
	if len(bodyJSON(t, rec)["tools"].([]any)) != 0 {
		t.Fatal("DELETE 后应为空")
	}

	// 校验：缺字段 400
	rec = do(t, s.Handle, "POST", "/xyz/launcher", `{"name":"只有名字"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "缺少 name 或 path") {
		t.Fatalf("缺 path 应 400: %d %s", rec.Code, rec.Body.String())
	}
}

// ---- run 校验（不真启动） ----

func TestLauncher_Run_Validation(t *testing.T) {
	s := newTestStore(t)

	// 未知 id → 404
	rec := do(t, s.Handle, "POST", "/xyz/launcher/run", `{"id":"nope"}`)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "tool not found") {
		t.Fatalf("run 未知 id 应 404: %d %s", rec.Code, rec.Body.String())
	}

	// path 为空 → 400（先塞一个空 path 工具）
	if err := s.writeTools([]Tool{{ID: "t1", Name: "空", Path: "   "}}); err != nil {
		t.Fatal(err)
	}
	rec = do(t, s.Handle, "POST", "/xyz/launcher/run", `{"id":"t1"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "tool path is empty") {
		t.Fatalf("空 path 应 400: %d %s", rec.Code, rec.Body.String())
	}

	// 文件不存在 → 404
	if err := s.writeTools([]Tool{{ID: "t2", Name: "缺失", Path: filepath.Join(t.TempDir(), "ghost.exe")}}); err != nil {
		t.Fatal(err)
	}
	rec = do(t, s.Handle, "POST", "/xyz/launcher/run", `{"id":"t2"}`)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "tool file not found") {
		t.Fatalf("文件缺失应 404: %d %s", rec.Code, rec.Body.String())
	}
}
