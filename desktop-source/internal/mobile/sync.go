package mobile

// sync.go 移植 server/mobileSync.ts：/api/mobile/*（events SSE / info / tasks CRUD / 图片字节）。
// 路由顺序：/api/mobile/gen 由 GenManager 处理，Go mux 最长前缀优先，天然等价于 TS 的注册顺序约束。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// MobileTask 对齐 src/types.ts 的 MobileTask（公共形态，不含 image 字节）。
type MobileTask struct {
	ID         string         `json:"id"`
	ImageName  string         `json:"imageName"`
	Mime       string         `json:"mime"`
	Size       int            `json:"size"`
	Status     string         `json:"status"`
	Params     map[string]any `json:"params"`
	Tags       string         `json:"tags"`
	Error      string         `json:"error,omitempty"`
	PromptID   string         `json:"promptId,omitempty"`
	CreatedAt  string         `json:"createdAt"`
	StartedAt  string         `json:"startedAt,omitempty"`
	FinishedAt string         `json:"finishedAt,omitempty"`
}

type syncTask struct {
	task  MobileTask
	image []byte
}

type sseClient struct {
	mu  sync.Mutex
	w   http.ResponseWriter
	flc http.Flusher
}

func (c *sseClient) write(s string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.w.Write([]byte(s))
	c.flc.Flush()
}

// SyncManager 对齐 mobileSync 插件的闭包状态。
type SyncManager struct {
	ComfyBase string
	client    *http.Client

	mu       sync.Mutex
	tasks    map[string]*syncTask
	order    []string // 插入序（Map 遍历无序，用切片维护）
	queue    []*syncTask
	draining bool
	clients  map[*sseClient]struct{}
}

func NewSyncManager(comfyBase string) *SyncManager {
	m := &SyncManager{
		ComfyBase: strings.TrimRight(comfyBase, "/"),
		client:    &http.Client{Timeout: 60 * time.Second},
		tasks:     map[string]*syncTask{},
		clients:   map[*sseClient]struct{}{},
	}
	// SSE 心跳（对齐 TS 的 setInterval；进程生命周期即定时器生命周期）
	go func() {
		ticker := time.NewTicker(HeartbeatMS * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			m.mu.Lock()
			clients := make([]*sseClient, 0, len(m.clients))
			for c := range m.clients {
				clients = append(clients, c)
			}
			m.mu.Unlock()
			for _, c := range clients {
				c.write(": heartbeat\n\n")
			}
		}
	}()
	return m
}

// toPublic 拷贝公共形态。
func (t *syncTask) toPublic() MobileTask { return t.task }

func (m *SyncManager) broadcast(task *syncTask) {
	pub, _ := json.Marshal(task.toPublic())
	payload := fmt.Sprintf("event: task-updated\ndata: %s\n\n", pub)
	m.mu.Lock()
	clients := make([]*sseClient, 0, len(m.clients))
	for c := range m.clients {
		clients = append(clients, c)
	}
	m.mu.Unlock()
	for _, c := range clients {
		c.write(payload)
	}
}

// removeFromQueue 从待执行队列移除任务（已开始执行的任务无法撤销）。
func (m *SyncManager) removeFromQueue(id string) {
	for i, t := range m.queue {
		if t.task.ID == id {
			m.queue = append(m.queue[:i], m.queue[i+1:]...)
			return
		}
	}
}

func (m *SyncManager) lanIP() string { return LanIP() }

var reLoopbackHost = regexp.MustCompile(`^(127\.0\.0\.1|localhost)$`)

func (m *SyncManager) buildMobileURL(r *http.Request) string {
	lan := m.lanIP()
	host := r.Host
	if host == "" {
		host = "127.0.0.1:9999"
	}
	sep := strings.LastIndex(host, ":")
	hostname, port := host, ""
	if sep != -1 {
		hostname, port = host[:sep], host[sep+1:]
	}
	hostForURL := hostname
	if reLoopbackHost.MatchString(hostname) && lan != "" {
		hostForURL = lan
	}
	portPart := ""
	if port != "" && port != "80" {
		portPart = ":" + port
	}
	return fmt.Sprintf("http://%s%s/%s", hostForURL, portPart, PageHash)
}

// Handle 处理 /api/mobile 与 /api/mobile/ 前缀（/api/mobile/gen 由 GenManager 优先接管）。
func (m *SyncManager) Handle(w http.ResponseWriter, r *http.Request) {
	pathName := r.URL.Path
	method := strings.ToUpper(r.Method)

	// SSE 事件流
	if pathName == "/api/mobile/events" {
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache, no-transform")
		h.Set("Connection", "keep-alive")
		h.Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flc, ok := w.(http.Flusher)
		if !ok {
			return
		}
		_, _ = w.Write([]byte("retry: 3000\n\n"))
		flc.Flush()
		c := &sseClient{w: w, flc: flc}
		m.mu.Lock()
		m.clients[c] = struct{}{}
		m.mu.Unlock()
		// 保持连接打开直到客户端断开（SSE 语义）
		<-r.Context().Done()
		m.mu.Lock()
		delete(m.clients, c)
		m.mu.Unlock()
		return
	}

	if pathName == "/api/mobile/info" {
		storage.SendJSON(w, 200, map[string]any{
			"success": true,
			"data":    map[string]any{"mobileUrl": m.buildMobileURL(r), "lanIp": m.lanIP()},
		})
		return
	}

	if pathName == "/api/mobile/tasks" {
		switch method {
		case "GET":
			m.mu.Lock()
			list := make([]MobileTask, 0, len(m.order))
			for i := len(m.order) - 1; i >= 0; i-- {
				list = append(list, m.tasks[m.order[i]].toPublic())
			}
			m.mu.Unlock()
			storage.SendJSON(w, 200, map[string]any{"success": true, "tasks": list})
		case "POST":
			task, err := m.createTask(w, r)
			if err != nil {
				sendMobileError(w, err)
				return
			}
			storage.SendJSON(w, 202, map[string]any{"success": true, "id": task.task.ID})
		case "DELETE":
			m.mu.Lock()
			for _, id := range m.order {
				m.removeFromQueue(id)
			}
			m.tasks = map[string]*syncTask{}
			m.order = nil
			m.mu.Unlock()
			storage.SendJSON(w, 200, map[string]any{"success": true})
		default:
			// 落到 404（对齐 TS：未匹配方法则走末尾 404）
			storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown mobile endpoint"})
		}
		return
	}

	// /api/mobile/tasks/:id[/image]
	segments := strings.Split(strings.Trim(pathName, "/"), "/") // ["api","mobile",...]
	if len(segments) >= 3 && segments[2] == "tasks" && len(segments) >= 4 && segments[3] != "" {
		id := segments[3]
		m.mu.Lock()
		record := m.tasks[id]
		m.mu.Unlock()
		if record == nil {
			storage.SendJSON(w, 404, map[string]any{"success": false, "error": "任务不存在"})
			return
		}
		if len(segments) >= 5 && segments[4] == "image" && method == "GET" {
			w.Header().Set("Content-Type", record.task.Mime)
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(record.image)))
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(record.image)
			return
		}
		if method == "GET" {
			storage.SendJSON(w, 200, map[string]any{"success": true, "task": record.toPublic()})
			return
		}
		if method == "DELETE" {
			m.mu.Lock()
			m.removeFromQueue(id)
			delete(m.tasks, id)
			for i, oid := range m.order {
				if oid == id {
					m.order = append(m.order[:i], m.order[i+1:]...)
					break
				}
			}
			m.mu.Unlock()
			storage.SendJSON(w, 200, map[string]any{"success": true})
			return
		}
	}

	storage.SendJSON(w, 404, map[string]any{"success": false, "error": "Unknown mobile endpoint"})
}

func sendMobileError(w http.ResponseWriter, err error) {
	var se *StatusError
	status := 500
	if ok := asStatusError(err, &se); ok {
		status = se.Status
	}
	storage.SendJSON(w, status, map[string]any{"success": false, "error": err.Error()})
}

func asStatusError(err error, target **StatusError) bool {
	if se, ok := err.(*StatusError); ok {
		*target = se
		return true
	}
	return false
}

var reBoundary = regexp.MustCompile(`boundary=(?:"([^"]+)"|([^;]+))`)

var wd14Defaults = map[string]any{
	"model":              "wd-v1-4-moat-tagger-v2",
	"threshold":          0.35,
	"characterThreshold": 0.85,
	"replaceUnderscore":  true,
	"trailingComma":      true,
	"excludeTags":        "",
	"device":             "GPU",
}

func (m *SyncManager) createTask(w http.ResponseWriter, r *http.Request) (*syncTask, error) {
	contentType := r.Header.Get("Content-Type")
	bm := reBoundary.FindStringSubmatch(contentType)
	if bm == nil {
		return nil, &StatusError{Status: 400, Msg: "请求必须为 multipart/form-data"}
	}
	boundary := bm[1]
	if boundary == "" {
		boundary = bm[2]
	}
	raw, err := readBodyLimited(r, MaxImageBytes+64*1024, fmt.Sprintf("图片过大，上限 %dMB", MaxImageBytes/1024/1024))
	if err != nil {
		return nil, err
	}
	parts := ParseMultipart(raw, boundary)

	var imagePart *MultipartPart
	for i, p := range parts {
		if p.Filename != "" && strings.HasPrefix(p.ContentType, "image/") {
			imagePart = &parts[i]
			break
		}
	}
	if imagePart == nil {
		return nil, &StatusError{Status: 400, Msg: "缺少图片字段（image）"}
	}
	if len(imagePart.Data) == 0 || len(imagePart.Data) > MaxImageBytes {
		return nil, &StatusError{Status: 413, Msg: fmt.Sprintf("图片大小需在 1B ~ %dMB 之间", MaxImageBytes/1024/1024)}
	}

	params := map[string]any{}
	for k, v := range wd14Defaults {
		params[k] = v
	}
	for _, p := range parts {
		if p.Name == "params" {
			decoded, perr := decodeJSONLoose(p.Data)
			if perr != nil {
				return nil, &StatusError{Status: 400, Msg: "params 字段必须是合法 JSON"}
			}
			for k, v := range decoded {
				params[k] = v
			}
		}
	}

	m.mu.Lock()
	if len(m.queue) >= MaxQueue {
		m.mu.Unlock()
		return nil, &StatusError{Status: 429, Msg: fmt.Sprintf("排队任务已达上限（%d），请稍后再试", MaxQueue)}
	}
	m.mu.Unlock()

	task := &syncTask{
		task: MobileTask{
			ID:        UUIDv4(),
			ImageName: imagePart.Filename,
			Mime:      imagePart.ContentType,
			Size:      len(imagePart.Data),
			Status:    "queued",
			Params:    params,
			CreatedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
		},
		image: imagePart.Data,
	}
	if task.task.ImageName == "" {
		task.task.ImageName = "upload.png"
	}
	if task.task.Mime == "" {
		task.task.Mime = "image/png"
	}

	m.mu.Lock()
	m.tasks[task.task.ID] = task
	m.order = append(m.order, task.task.ID)
	if len(m.order) > MaxTasks {
		oldest := m.order[0]
		m.order = m.order[1:]
		delete(m.tasks, oldest)
	}
	m.queue = append(m.queue, task)
	m.mu.Unlock()

	m.broadcast(task)
	go m.drainQueue()
	return task, nil
}

// decodeJSONLoose 解析对象 JSON（UseNumber 保真）。
func decodeJSONLoose(data []byte) (map[string]any, error) {
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.UseNumber()
	var obj map[string]any
	if err := dec.Decode(&obj); err != nil {
		return nil, err
	}
	return obj, nil
}

func readBodyLimited(r *http.Request, maxBytes int, overMessage string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r.Body, int64(maxBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, &StatusError{Status: 413, Msg: overMessage}
	}
	return data, nil
}

// ---- ComfyUI 执行（对齐 runTask / drainQueue） ----

func (m *SyncManager) drainQueue() {
	m.mu.Lock()
	if m.draining {
		m.mu.Unlock()
		return
	}
	m.draining = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.draining = false
		m.mu.Unlock()
	}()
	for {
		m.mu.Lock()
		if len(m.queue) == 0 {
			m.mu.Unlock()
			return
		}
		task := m.queue[0]
		m.queue = m.queue[1:]
		m.mu.Unlock()
		m.runTask(task)
	}
}

func nowISO() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00") }

func (m *SyncManager) runTask(task *syncTask) {
	m.mu.Lock()
	task.task.Status = "running"
	task.task.StartedAt = nowISO()
	m.mu.Unlock()
	m.broadcast(task)

	err := m.executeTask(task)

	m.mu.Lock()
	if err != nil {
		task.task.Status = "error"
		task.task.Error = err.Error()
	} else {
		task.task.Error = ""
	}
	task.task.FinishedAt = nowISO()
	m.mu.Unlock()
	m.broadcast(task)
}

func (m *SyncManager) executeTask(task *syncTask) error {
	// 1. 探测 ComfyUI 可达（5s）
	if _, e := GetJSON(m.client, m.ComfyBase+"/api/system_stats", 5000); e != nil {
		return &StatusError{Status: 502, Msg: fmt.Sprintf("ComfyUI 请求失败（/api/system_stats 不可达）")}
	}

	// 2. 上传图片（multipart）
	imageName, err := m.uploadImage(task)
	if err != nil {
		return err
	}

	// 3. 提交 WD14 工作流（15s）
	workflow := BuildWd14Workflow(task.task.Params, imageName)
	queueRes, err := PostJSON(m.client, m.ComfyBase+"/api/prompt", map[string]any{
		"prompt":    workflow,
		"client_id": UUIDv4(),
	}, 15000)
	if err != nil {
		return err
	}
	promptID, _ := queueRes["prompt_id"].(string)
	if promptID == "" {
		return &StatusError{Status: 502, Msg: "ComfyUI 未返回 prompt_id"}
	}
	m.mu.Lock()
	task.task.PromptID = promptID
	m.mu.Unlock()

	// 4. 轮询 history（上限 180s）
	var history map[string]any
	found := false
	for i := 0; i < 180; i++ {
		time.Sleep(1 * time.Second)
		h, e := GetJSON(m.client, m.ComfyBase+"/api/history/"+url.PathEscape(promptID), 10000)
		if e != nil {
			continue
		}
		history = h
		entry, _ := history[promptID].(map[string]any)
		statusObj, _ := entry["status"].(map[string]any)
		if s, _ := statusObj["status_str"].(string); s == "error" {
			return &StatusError{Status: 502, Msg: "ComfyUI 执行失败"}
		}
		if outputs, ok := entry["outputs"].(map[string]any); ok && len(outputs) > 0 {
			found = true
			break
		}
	}
	if !found {
		return &StatusError{Status: 502, Msg: "识别超时（180 秒内未完成）"}
	}

	texts := ExtractTextsFromHistory(history, promptID)
	if len(texts) == 0 {
		return &StatusError{Status: 502, Msg: "识别完成但未解析到 tags"}
	}
	m.mu.Lock()
	task.task.Tags = strings.Join(texts, "\n")
	task.task.Status = "done"
	m.mu.Unlock()
	return nil
}

func (m *SyncManager) uploadImage(task *syncTask) (string, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("image", task.task.ImageName)
	if err != nil {
		return "", err
	}
	if _, err := fw.Write(task.image); err != nil {
		return "", err
	}
	_ = mw.WriteField("type", "input")
	_ = mw.WriteField("overwrite", "true")
	if err := mw.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequest("POST", m.ComfyBase+"/api/upload/image", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	ctx, cancel := context.WithTimeout(req.Context(), 60*time.Second)
	defer cancel()
	resp, err := m.client.Do(req.WithContext(ctx))
	if err != nil {
		return "", &StatusError{Status: 502, Msg: fmt.Sprintf("上传图片到 ComfyUI 失败（%v）", err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", &StatusError{Status: 502, Msg: fmt.Sprintf("上传图片到 ComfyUI 失败（%d）", resp.StatusCode)}
	}
	var uploaded map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&uploaded); err != nil {
		return "", err
	}
	name, _ := uploaded["name"].(string)
	if name == "" {
		name = task.task.ImageName
	}
	return name, nil
}
