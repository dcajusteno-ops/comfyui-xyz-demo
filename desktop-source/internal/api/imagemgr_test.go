package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
)

func newImageHandler(t *testing.T) *ImageHandler {
	t.Helper()
	// 非回环地址：探测直接返回 none，测试不碰网络
	return &ImageHandler{RepoRoot: t.TempDir(), ComfyBase: "http://192.0.2.1:8188"}
}

// doLocal 发一个「本机」请求：httptest.NewRequest 默认 RemoteAddr 是 192.0.2.1，会被写接口挡掉。
func doLocal(t *testing.T, h http.HandlerFunc, method, target, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, target, reader)
	r.RemoteAddr = "127.0.0.1:54321"
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	h(rec, r)
	return rec
}

func deleteBody(t *testing.T, paths []string) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{"paths": paths})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(data)
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func TestDetectImageOutputDir(t *testing.T) {
	// 用 filepath.Abs 造真正带盘符的绝对路径（Windows 上 `\AIimg` 只是 rooted，不算 absolute）
	base, err := filepath.Abs("comfy-home")
	if err != nil {
		t.Fatal(err)
	}
	comfyRoot := filepath.Join(base, "ComfyUI")
	mainPy := filepath.Join(comfyRoot, "main.py")
	envDir := filepath.Join(base, "env-out")
	out2 := filepath.Join(base, "out2")
	out3 := filepath.Join(base, "out3")
	baseDir := filepath.Join(base, "base")

	cases := []struct {
		name   string
		argv   []string
		env    string
		dir    string
		source string
	}{
		{
			name:   "env 优先",
			argv:   []string{mainPy},
			env:    envDir,
			dir:    envDir,
			source: "env",
		},
		{
			name:   "argv-output 分开写",
			argv:   []string{mainPy, "--output-directory", out2},
			dir:    out2,
			source: "argv-output",
		},
		{
			name:   "argv-output 等号写",
			argv:   []string{mainPy, "--output-directory=" + out3},
			dir:    out3,
			source: "argv-output",
		},
		{
			name:   "argv-base 拼 output",
			argv:   []string{mainPy, "--base-directory=" + baseDir},
			dir:    filepath.Join(baseDir, "output"),
			source: "argv-base",
		},
		{
			name:   "main.py 同级 output",
			argv:   []string{mainPy},
			dir:    filepath.Join(comfyRoot, "output"),
			source: "argv-main",
		},
		{
			name:   "main.py 相对路径不猜",
			argv:   []string{"main.py", "--auto-launch"},
			source: "none",
		},
		{
			name:   "没有 argv",
			argv:   nil,
			source: "none",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DetectImageOutputDir(tc.argv, tc.env)
			if got.Source != tc.source {
				t.Fatalf("source 应为 %s: %+v", tc.source, got)
			}
			if tc.dir != "" && filepath.Clean(got.Dir) != filepath.Clean(tc.dir) {
				t.Fatalf("dir 应为 %s: %s", tc.dir, got.Dir)
			}
		})
	}
}

func TestIsInsideImageRoot(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "data", "output")
	if !IsInsideImageRoot(root, root) {
		t.Fatalf("同路径应算在内")
	}
	if !IsInsideImageRoot(root, filepath.Join(root, "001", "a.png")) {
		t.Fatalf("子路径应算在内")
	}
	if IsInsideImageRoot(root, root+"2"+string(filepath.Separator)+"a.png") {
		t.Fatalf("同前缀兄弟目录不算在内")
	}
	if IsInsideImageRoot("", filepath.Join(root, "a.png")) {
		t.Fatalf("空根目录一律 false")
	}
}

func TestImageConfig_FromArgvAndKeys(t *testing.T) {
	root := t.TempDir()
	comfyRoot := filepath.Join(root, "ComfyUI")
	outputDir := filepath.Join(comfyRoot, "output")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/system_stats" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"system": map[string]any{"argv": []string{filepath.Join(comfyRoot, "main.py")}},
		})
	}))
	defer srv.Close()

	h := &ImageHandler{RepoRoot: t.TempDir(), ComfyBase: srv.URL}
	rec := do(t, h.HandleConfig, "GET", "/xyz/images/config", "")
	if rec.Code != 200 {
		t.Fatalf("应 200: %d", rec.Code)
	}
	body := bodyJSON(t, rec)
	if body["success"] != true {
		t.Fatalf("success 应为 true: %v", body)
	}
	if body["outputDirSource"] != "argv-main" {
		t.Fatalf("应识别 argv-main: %v", body)
	}
	if filepath.Clean(body["outputDir"].(string)) != filepath.Clean(outputDir) {
		t.Fatalf("outputDir 不符: %v", body["outputDir"])
	}
	if body["rootSource"] != "detected" || body["rootDir"] != body["outputDir"] {
		t.Fatalf("未设置保存值时根目录应回落到探测值: %v", body)
	}
	if _, ok := body["drives"].([]any); !ok {
		t.Fatalf("drives 应是数组: %v", body["drives"])
	}
	want := []string{"drives", "outputDir", "outputDirExists", "outputDirSource", "rootDir", "rootExists", "rootSource", "savedRootDir", "success", "trashEnabled"}
	if strings.Join(keysOf(body), ",") != strings.Join(want, ",") {
		t.Fatalf("键集不符: %v", keysOf(body))
	}
}

func TestImageConfig_UnreachableKeepsKeys(t *testing.T) {
	h := newImageHandler(t)
	rec := do(t, h.HandleConfig, "GET", "/xyz/images/config", "")
	body := bodyJSON(t, rec)
	if body["outputDirSource"] != "none" || body["rootSource"] != "none" {
		t.Fatalf("不可达时应回 none: %v", body)
	}
	want := "drives,outputDir,outputDirExists,outputDirSource,rootDir,rootExists,rootSource,savedRootDir,success,trashEnabled"
	if strings.Join(keysOf(body), ",") != want {
		t.Fatalf("失败时也必须同键集: %v", keysOf(body))
	}
}

func TestImageConfig_SaveRootOnlyFromLoopback(t *testing.T) {
	h := newImageHandler(t)
	root := t.TempDir()
	payload := `{"rootDir":` + jsonString(root) + `}`

	rec := doLocal(t, h.HandleConfig, "POST", "/xyz/images/config", payload, "application/json")
	if rec.Code != 200 {
		t.Fatalf("本机应允许: %d %s", rec.Code, rec.Body.String())
	}
	if bodyJSON(t, rec)["rootSource"] != "saved" {
		t.Fatalf("应记录 saved: %v", bodyJSON(t, rec))
	}

	r := httptest.NewRequest("POST", "/xyz/images/config", strings.NewReader(payload))
	r.RemoteAddr = "192.168.1.20:5000"
	r.Header.Set("Content-Type", "application/json")
	remote := httptest.NewRecorder()
	h.HandleConfig(remote, r)
	if remote.Code != 403 {
		t.Fatalf("非本机应 403: %d", remote.Code)
	}
}

func jsonString(value string) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func TestImageBrowse(t *testing.T) {
	h := newImageHandler(t)
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "001"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "a.png"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "c.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := do(t, h.HandleBrowse, "GET", "/xyz/images/browse?dir="+url.QueryEscape(dir), "")
	body := bodyJSON(t, rec)
	if body["success"] != true {
		t.Fatalf("应成功: %v", body)
	}
	folders := body["folders"].([]any)
	if len(folders) != 1 || folders[0] != "001" {
		t.Fatalf("目录不符: %v", folders)
	}
	images := body["images"].([]any)
	if len(images) != 1 {
		t.Fatalf("非图片应被过滤: %v", images)
	}
	if images[0].(map[string]any)["name"] != "a.png" {
		t.Fatalf("图片名不符: %v", images[0])
	}
	if body["total"].(float64) != 1 {
		t.Fatalf("total 不符: %v", body["total"])
	}
}

func TestImageBrowse_MissingDirReturnsNearest(t *testing.T) {
	h := newImageHandler(t)
	dir := t.TempDir()
	missing := filepath.Join(dir, "a", "b", "c")

	rec := do(t, h.HandleBrowse, "GET", "/xyz/images/browse?dir="+url.QueryEscape(missing), "")
	body := bodyJSON(t, rec)
	if body["success"] != false {
		t.Fatalf("应失败: %v", body)
	}
	if filepath.Clean(body["nearest"].(string)) != filepath.Clean(dir) {
		t.Fatalf("nearest 应为最近存在祖先: %v", body["nearest"])
	}
	if len(body["images"].([]any)) != 0 || len(body["folders"].([]any)) != 0 {
		t.Fatalf("失败时数组应为空: %v", body)
	}
}

func TestImageFile_ServesOnlyInsideRoot(t *testing.T) {
	h := newImageHandler(t)
	root := t.TempDir()
	sub := filepath.Join(root, "001")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(sub, "a.png")
	if err := os.WriteFile(image, []byte("PNGDATA"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := h.writeSettings(imageSettings{RootDir: root, TrashEnabled: true}); err != nil {
		t.Fatal(err)
	}

	rec := do(t, h.HandleFile, "GET", "/xyz/images/file?path="+url.QueryEscape(image), "")
	if rec.Code != 200 {
		t.Fatalf("应 200: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type 不符: %s", rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("ETag") == "" {
		t.Fatalf("缺 ETag")
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("缺 nosniff")
	}
	if rec.Body.String() != "PNGDATA" {
		t.Fatalf("内容不符: %s", rec.Body.String())
	}

	// HEAD 不返回 body
	head := do(t, h.HandleFile, "HEAD", "/xyz/images/file?path="+url.QueryEscape(image), "")
	if head.Code != 200 || head.Body.Len() != 0 {
		t.Fatalf("HEAD 不符: %d %q", head.Code, head.Body.String())
	}

	// 根目录外的图片
	outside := filepath.Join(t.TempDir(), "b.png")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec = do(t, h.HandleFile, "GET", "/xyz/images/file?path="+url.QueryEscape(outside), "")
	if rec.Code != 403 {
		t.Fatalf("根外应 403: %d", rec.Code)
	}

	// 非图片
	text := filepath.Join(root, "note.txt")
	if err := os.WriteFile(text, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec = do(t, h.HandleFile, "GET", "/xyz/images/file?path="+url.QueryEscape(text), "")
	if rec.Code != 400 {
		t.Fatalf("非图片应 400: %d", rec.Code)
	}
}

func TestImageConfig_TrashToggle(t *testing.T) {
	h := newImageHandler(t)
	root := t.TempDir()
	if err := h.writeSettings(imageSettings{RootDir: root, TrashEnabled: true}); err != nil {
		t.Fatal(err)
	}

	rec := doLocal(t, h.HandleConfig, "POST", "/xyz/images/config", `{"trashEnabled":false}`, "application/json")
	if rec.Code != 200 {
		t.Fatalf("应允许关闭: %d %s", rec.Code, rec.Body.String())
	}
	body := bodyJSON(t, rec)
	if body["trashEnabled"] != false {
		t.Fatalf("trashEnabled 应为 false: %v", body)
	}
	if filepath.Clean(body["rootDir"].(string)) != filepath.Clean(root) {
		t.Fatalf("局部更新不应清掉 rootDir: %v", body["rootDir"])
	}

	// 只改根目录时，trashEnabled 也要保留
	other := t.TempDir()
	rec = doLocal(t, h.HandleConfig, "POST", "/xyz/images/config", `{"rootDir":`+jsonString(other)+`}`, "application/json")
	body = bodyJSON(t, rec)
	if body["trashEnabled"] != false {
		t.Fatalf("改根目录不应重置删除方式: %v", body)
	}
}

func TestImageDelete_PermanentWhenTrashDisabled(t *testing.T) {
	h := newImageHandler(t)
	root := t.TempDir()
	file := filepath.Join(root, "a.png")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := h.writeSettings(imageSettings{RootDir: root, TrashEnabled: false}); err != nil {
		t.Fatal(err)
	}
	trashCalled := false
	h.TrashFunc = func([]string) []FailedFile {
		trashCalled = true
		return nil
	}

	rec := doLocal(t, h.HandleDelete, "POST", "/xyz/images/delete", deleteBody(t, []string{file}), "application/json")
	if rec.Code != 200 {
		t.Fatalf("应 200: %d %s", rec.Code, rec.Body.String())
	}
	body := bodyJSON(t, rec)
	if body["mode"] != "delete" {
		t.Fatalf("mode 应为 delete: %v", body["mode"])
	}
	if trashCalled {
		t.Fatalf("关闭回收站后不应调用回收站")
	}
	if _, err := os.Stat(file); err == nil {
		t.Fatalf("文件应已被永久删除")
	}
}

func TestImageDelete_ReportsPerFile(t *testing.T) {
	h := newImageHandler(t)
	root := t.TempDir()
	first := filepath.Join(root, "a.png")
	second := filepath.Join(root, "b.png")
	for _, file := range []string{first, second} {
		if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.writeSettings(imageSettings{RootDir: root, TrashEnabled: true}); err != nil {
		t.Fatal(err)
	}

	var got []string
	h.TrashFunc = func(paths []string) []FailedFile {
		got = append(got, paths...)
		return []FailedFile{{Path: second, Error: "被占用"}}
	}

	outside := filepath.Join(t.TempDir(), "c.png")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	rec := doLocal(t, h.HandleDelete, "POST", "/xyz/images/delete",
		deleteBody(t, []string{first, second, outside}), "application/json")
	if rec.Code != 200 {
		t.Fatalf("应 200: %d %s", rec.Code, rec.Body.String())
	}
	body := bodyJSON(t, rec)
	if body["mode"] != "trash" {
		t.Fatalf("mode 应为 trash: %v", body["mode"])
	}
	deleted := body["deleted"].([]any)
	if len(deleted) != 1 || deleted[0] != first {
		t.Fatalf("deleted 只应含成功项: %v", deleted)
	}
	failed := body["failed"].([]any)
	if len(failed) != 2 {
		t.Fatalf("failed 应含占用 + 根外两条: %v", failed)
	}
	if len(got) != 2 {
		t.Fatalf("只应把根内文件交给回收站: %v", got)
	}
}

func TestImageDelete_RejectsNonJSON(t *testing.T) {
	h := newImageHandler(t)
	rec := doLocal(t, h.HandleDelete, "POST", "/xyz/images/delete", `{"paths":[]}`, "text/plain")
	if rec.Code != 415 {
		t.Fatalf("非 JSON 应 415: %d", rec.Code)
	}
}

func TestImageHandleService(t *testing.T) {
	h := &ImageHandler{}
	rec := do(t, h.HandleService, "GET", "/xyz/images/service", "")
	body := bodyJSON(t, rec)
	if body["success"] != false {
		t.Fatalf("未注入地址时应 success:false: %v", body)
	}
	h.ServiceURL = func() string { return "http://127.0.0.1:9124/" }
	rec = do(t, h.HandleService, "GET", "/xyz/images/service", "")
	body = bodyJSON(t, rec)
	if body["success"] != true || body["url"] != "http://127.0.0.1:9124/" {
		t.Fatalf("应返回外置地址: %v", body)
	}
}

func TestImageService_ServesStandalonePage(t *testing.T) {
	handler := &ImageHandler{RepoRoot: t.TempDir(), ComfyBase: "http://192.0.2.1:8188"}
	dist := fstest.MapFS{
		"standalone.html": &fstest.MapFile{Data: []byte("<html>standalone-page</html>")},
		"assets/app.js":   &fstest.MapFile{Data: []byte("console.log(1)")},
	}
	service := NewImageService(dist, handler, nil)
	if service.Start() == "" {
		t.Fatal("应能绑定到 9124-9133 中的某个端口")
	}
	defer service.Stop()
	base := service.URL()

	get := func(path string) (int, string) {
		t.Helper()
		response, err := http.Get(base + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		defer func() { _ = response.Body.Close() }()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("读取 %s: %v", path, err)
		}
		return response.StatusCode, string(data)
	}

	if status, body := get("standalone.html"); status != 200 || !strings.Contains(body, "standalone-page") {
		t.Fatalf("外置页面不符: %d %q", status, body)
	}
	if status, body := get(""); status != 200 || !strings.Contains(body, "standalone-page") {
		t.Fatalf("根路径应发同一页面: %d %q", status, body)
	}
	if status, body := get("assets/app.js"); status != 200 || !strings.Contains(body, "console.log") {
		t.Fatalf("静态资源不符: %d %q", status, body)
	}
	status, body := get("xyz/images/config")
	if status != 200 || !strings.Contains(body, `"success":true`) {
		t.Fatalf("API 应同源可用: %d %q", status, body)
	}
	if status, _ := get("nope"); status != 404 {
		t.Fatalf("未知路径应 404: %d", status)
	}
}
