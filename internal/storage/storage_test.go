package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestMarshalIndentNoHTMLNoTrailingNewline(t *testing.T) {
	b, err := marshalJSONIndent(map[string]any{"s": "<a>&b", "n": json.Number("123")})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "\\u003c") {
		t.Fatalf("HTML 不应被转义: %s", b)
	}
	if strings.HasSuffix(string(b), "\n") {
		t.Fatalf("不应有尾随换行: %q", b)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("产出必须是合法 JSON: %v", err)
	}
}

func TestParseJSONObject(t *testing.T) {
	// 空体 → 空对象
	obj, err := ParseJSONObject(nil)
	if err != nil || len(obj) != 0 {
		t.Fatalf("空体应得空对象: %v %v", obj, err)
	}
	// 大整数保真（UseNumber）
	obj, err = ParseJSONObject([]byte(`{"revision":9007199254740993}`))
	if err != nil {
		t.Fatal(err)
	}
	if obj["revision"].(json.Number).String() != "9007199254740993" {
		t.Fatalf("大整数失真: %v", obj["revision"])
	}
}

func TestReadJSONBody_Limit(t *testing.T) {
	// 空体
	r := httptest.NewRequest("POST", "/", strings.NewReader(""))
	obj, err := ReadJSONBody(httptest.NewRecorder(), r, 1024)
	if err != nil || len(obj) != 0 {
		t.Fatalf("空体应得空对象: %v %v", obj, err)
	}
	// 超限 → BodyLimitError(413)
	r = httptest.NewRequest("POST", "/", strings.NewReader(strings.Repeat("x", 2048)))
	_, err = ReadJSONBody(httptest.NewRecorder(), r, 1024)
	var be *BodyLimitError
	if !errors.As(err, &be) || be.StatusCode() != 413 {
		t.Fatalf("应得 413 BodyLimitError: %v", err)
	}
	if !strings.Contains(be.Error(), "1KB") {
		t.Fatalf("错误文案应含 KB 数: %s", be.Error())
	}
	// 正常解析
	r = httptest.NewRequest("POST", "/", strings.NewReader(`{"a":1}`))
	obj, err = ReadJSONBody(httptest.NewRecorder(), r, 1024)
	if err != nil || len(obj) != 1 {
		t.Fatalf("正常解析失败: %v %v", obj, err)
	}
}

func TestAtomicWriteJSONWithBackup_AndPrune(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "notes.json")

	// 首次写：无上一版 → 不产生备份
	if err := AtomicWriteJSONWithBackup(file, map[string]any{"v": 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatal("主文件未写入")
	}
	// 第二次写：留档 v1
	if err := AtomicWriteJSONWithBackup(file, map[string]any{"v": 2}); err != nil {
		t.Fatal(err)
	}
	// 第三次写：距上次留档不足 5 分钟 → 防抖跳过（仍成功写主文件）
	if err := AtomicWriteJSONWithBackup(file, map[string]any{"v": 3}); err != nil {
		t.Fatal(err)
	}
	backups := listBackupsOrDie(t, dir, "notes.json")
	if len(backups) != 1 {
		t.Fatalf("防抖后应只有 1 份留档, got %d: %v", len(backups), backups)
	}
	data, _ := os.ReadFile(file)
	if !strings.Contains(string(data), `"v": 3`) {
		t.Fatalf("主文件应为最新版: %s", data)
	}
	// 留档内容是 v1（跳过了 v2 的留档）
	bak, _ := os.ReadFile(filepath.Join(dir, "backups", backups[0]))
	if !strings.Contains(string(bak), `"v": 1`) {
		t.Fatalf("留档应是上一版 v1: %s", bak)
	}

	// 修剪：手工塞 35 份旧留档（连同前几次写产生的真实留档，把 mtime 全部拨到 5 分钟前
	// 以绕过防抖——否则最新一份真实留档的 mtime 是 now，会直接 return），再写一次 → 保留 30
	bakDir := filepath.Join(dir, backupDirName)
	old := time.Now().Add(-10 * time.Minute)
	for i := 0; i < 35; i++ {
		name := fmt.Sprintf("notes.json.2026-01-01T00-00-%02d-000Z.bak", i)
		p := filepath.Join(bakDir, name)
		_ = os.WriteFile(p, []byte("old"), 0o644)
	}
	entries2, _ := os.ReadDir(bakDir)
	for _, e := range entries2 {
		_ = os.Chtimes(filepath.Join(bakDir, e.Name()), old, old)
	}
	if err := AtomicWriteJSONWithBackup(file, map[string]any{"v": 4}); err != nil {
		t.Fatal(err)
	}
	backups = listBackupsOrDie(t, dir, "notes.json")
	if len(backups) != backupKeep {
		t.Fatalf("应修剪为 %d 份, got %d", backupKeep, len(backups))
	}
}

func listBackupsOrDie(t *testing.T, dir, base string) []string {
	t.Helper()
	names, err := listBackups(filepath.Join(dir, backupDirName), base)
	if err != nil {
		t.Fatal(err)
	}
	return names
}

func TestWriteQueue_SerializesAndIsolatesFailures(t *testing.T) {
	q := NewWriteQueue()
	var counter, okCount, errCount atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			err := q.Do("same-file", func() error {
				v := counter.Add(1)
				time.Sleep(time.Millisecond) // 制造交错窗口
				if v != counter.Load() {
					t.Error("写队列未串行化：计数在任务内被并发修改")
				}
				if i%2 == 0 {
					return errors.New("boom")
				}
				return nil
			})
			if err != nil {
				errCount.Add(1)
			} else {
				okCount.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if counter.Load() != 50 {
		t.Fatalf("50 个任务都应执行: %d", counter.Load())
	}
	if okCount.Load() != 25 || errCount.Load() != 25 {
		t.Fatalf("失败隔离失败: ok=%d err=%d", okCount.Load(), errCount.Load())
	}
	// 失败之后队列仍然可用
	if err := q.Do("same-file", func() error { return nil }); err != nil {
		t.Fatalf("失败后队列卡死: %v", err)
	}
	// 不同文件互不阻塞：两文件并发执行应在串行等待下仍全部完成
	done := make(chan struct{})
	go func() {
		_ = q.Do("file-a", func() error { time.Sleep(20 * time.Millisecond); return nil })
		close(done)
	}()
	select {
	case <-done:
		// file-a 完成
	case <-time.After(2 * time.Second):
		t.Fatal("跨文件被意外阻塞")
	}
}

func TestSendError_RespectsStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	SendError(rec, &BodyLimitError{Limit: 2048}, 500)
	if rec.Code != 413 {
		t.Fatalf("BodyLimitError 应 413, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	SendError(rec, errors.New("plain"), 500)
	if rec.Code != 500 {
		t.Fatalf("普通错误应兜底 500, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	SendError(rec, &StatusError{Status: 403, Err: errors.New("forbidden")}, 500)
	if rec.Code != 403 {
		t.Fatalf("StatusError 应被尊重, got %d", rec.Code)
	}
}
