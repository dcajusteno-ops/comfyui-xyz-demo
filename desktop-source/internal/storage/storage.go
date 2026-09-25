// Package storage 移植 server/utils.ts 的行为契约：
// 原子写(temp+rename) + 写前留档(backups/) + 按文件串行写队列 +
// 请求体上限(413 排干) + JSON 文件读写。SSOT 是 server/utils.ts，行为存疑时以它为准。
package storage

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// SendJSON 对齐 utils.ts 的 sendJson。
func SendJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(payload)
}

// DefaultBodyLimit 对齐 utils.ts 的 DEFAULT_BODY_LIMIT（2MB）。
const DefaultBodyLimit int64 = 2 * 1024 * 1024

// BodyLimitError 对齐 BodyLimitError（status 413，文案含 KB 数）。
type BodyLimitError struct{ Limit int64 }

func (e *BodyLimitError) Error() string {
	return fmt.Sprintf("Request body exceeds limit of %dKB", e.Limit/1024)
}

// StatusCode 供 SendError 提取。
func (e *BodyLimitError) StatusCode() int { return http.StatusRequestEntityTooLarge }

// ReadJSONBody 对齐 readJsonBody：
//   - 超限不立即断开：排干剩余请求体后正常响应 413（客户端才能读到状态码）；
//   - 超过 32 倍上限的恶意超大流直接断开（置 Connection: close）；
//   - 空请求体返回空对象。
func ReadJSONBody(w http.ResponseWriter, r *http.Request, maxBytes int64) (map[string]any, error) {
	if maxBytes <= 0 {
		maxBytes = DefaultBodyLimit
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		// 排干最多 32 倍上限；仍没排完说明是恶意超大流，强制断开
		drained, _ := io.Copy(io.Discard, io.LimitReader(r.Body, maxBytes*32))
		if drained >= maxBytes*32 {
			w.Header().Set("Connection", "close")
		}
		return nil, &BodyLimitError{Limit: maxBytes}
	}
	return ParseJSONObject(data)
}

// ParseJSONObject 解析 JSON 对象；空输入返回空对象。
// 用 UseNumber 保真大整数（对齐 JS 侧 JSON.parse 的数值语义）。
func ParseJSONObject(data []byte) (map[string]any, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var obj map[string]any
	if err := dec.Decode(&obj); err != nil {
		return nil, err
	}
	if obj == nil {
		obj = map[string]any{}
	}
	return obj, nil
}

// ReadJSONFile 对齐 readJsonFile：不存在或损坏返回 nil, false。
func ReadJSONFile(filePath string) (map[string]any, bool) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, false
	}
	obj, err := ParseJSONObject(data)
	if err != nil {
		return nil, false
	}
	return obj, true
}

const (
	backupKeep        = 30
	backupMinInterval = 5 * time.Minute
	jsonIndent        = "  "
	backupDirName     = "backups"
	backupSuffix      = ".bak"
)

// marshalJSONCompactIndent 对齐 JSON.stringify(data, null, 2)：两空格缩进、不转义 HTML、无尾随换行。
func marshalJSONIndent(data any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", jsonIndent)
	if err := enc.Encode(data); err != nil {
		return nil, err
	}
	// Encoder 会在结尾多写一个 \n，TS 的 JSON.stringify 没有——去掉
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// backupPreviousFile 对齐 backupPreviousFile：
// 写入前把上一版快照到同目录 backups/ 下；同文件 5 分钟内只留档一次；保留最近 30 份。
// 备份失败不阻断写入主流程。
func backupPreviousFile(filePath string) {
	prev, err := os.ReadFile(filePath)
	if err != nil {
		return // 文件不存在等情况：与 TS 一致，直接返回
	}
	dir := filepath.Join(filepath.Dir(filePath), backupDirName)
	base := filepath.Base(filePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	existing, err := listBackups(dir, base)
	if err != nil {
		return
	}
	if len(existing) > 0 {
		newest := existing[len(existing)-1]
		if info, err := os.Stat(filepath.Join(dir, newest)); err == nil {
			if time.Since(info.ModTime()) < backupMinInterval {
				return
			}
		}
	}
	stamp := time.Now().UTC().Format("2006-01-02T15-04-05.000Z07:00")
	// TS: new Date().toISOString().replace(/[:.]/g, "-") → 2026-09-23T13-03-26-153Z
	stamp = strings.NewReplacer(":", "-", ".", "-").Replace(stamp)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("%s.%s%s", base, stamp, backupSuffix)), prev, 0o644)
	all, err := listBackups(dir, base)
	if err != nil {
		return
	}
	if keep := len(all) - backupKeep; keep > 0 {
		for _, old := range all[:keep] {
			_ = os.Remove(filepath.Join(dir, old))
		}
	}
}

func listBackups(dir, base string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, base+".") && strings.HasSuffix(name, backupSuffix) {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}

// AtomicWriteJSON 原子写 JSON（temp+rename，不留档——wildcards 的 atomicWriteText 同款语义）。
func AtomicWriteJSON(filePath string, data any) error {
	return AtomicWrite(filePath, mustMarshal(data))
}

func mustMarshal(data any) []byte {
	b, err := marshalJSONIndent(data)
	if err != nil {
		// 与 TS 不同：JSON.stringify 对循环引用抛错；这里数据来自已解析 JSON，不会发生
		panic(fmt.Sprintf("storage: marshal json: %v", err))
	}
	return b
}

// AtomicWrite 原子写文本（对齐 wildcards 的 atomicWriteText：temp+rename，不留档）。
func AtomicWrite(filePath string, content []byte) error {
	tmp := fmt.Sprintf("%s.%d.tmp", filePath, os.Getpid())
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filePath)
}

// AtomicWriteJSONWithBackup = 留档 + 原子写（atomicWriteJson 的完整语义）。
func AtomicWriteJSONWithBackup(filePath string, data any) error {
	backupPreviousFile(filePath)
	return AtomicWriteJSON(filePath, data)
}

// WriteQueue 对齐 enqueueFileWrite：同一文件的写操作串行化，单次失败不影响后续。
type WriteQueue struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewWriteQueue() *WriteQueue { return &WriteQueue{locks: map[string]*sync.Mutex{}} }

// Do 串行执行针对 filePath 的写任务（失败隔离：任务自行处理错误，队列不会卡死）。
func (q *WriteQueue) Do(filePath string, fn func() error) error {
	q.mu.Lock()
	m, ok := q.locks[filePath]
	if !ok {
		m = &sync.Mutex{}
		q.locks[filePath] = m
	}
	q.mu.Unlock()
	m.Lock()
	defer m.Unlock()
	return fn()
}

// StatusError 携带 HTTP 状态码的错误（供 SendError 尊重）。
type StatusError struct {
	Status int
	Err    error
}

func (e *StatusError) Error() string { return e.Err.Error() }
func (e *StatusError) Unwrap() error { return e.Err }

// SendError 对齐 sendError：尊重错误上的 status（BodyLimitError/StatusError），兜底 500。
func SendError(w http.ResponseWriter, err error, fallbackStatus int) {
	status := fallbackStatus
	var be *BodyLimitError
	if errors.As(err, &be) {
		status = be.StatusCode()
	} else {
		var se *StatusError
		if errors.As(err, &se) {
			status = se.Status
		}
	}
	SendJSON(w, status, map[string]any{"success": false, "error": err.Error()})
}
