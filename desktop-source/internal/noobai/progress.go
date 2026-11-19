package noobai

import (
	"encoding/json"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// genClientID 必须同时用于 POST /prompt 与 websocket 连接：
// ComfyUI 只把 progress_state 发给「发起该 prompt 的 client_id」。
const genClientID = "comfy-studio-noobai"

// nodeSlot 记录一个采样节点在整张图里的进度。
type nodeSlot struct {
	offset int
	max    int
	value  int
	state  string
}

// progressTracker 从 ComfyUI 的 websocket 事件里攒采样进度。
// ComfyUI 没有查询步数的 REST 接口，只有 /ws 会推 progress_state；
// 后台保持一条长连接，前端再轮询 /api/gen/job 就能拿到百分比。
type progressTracker struct {
	mu       sync.Mutex
	promptID string
	value    int // 跨采样器的绝对步数（基础采样 + 高清修复）
	total    int // 已经见过的采样器步数之和
	node     string
	order    []string
	nodes    map[string]*nodeSlot
	updated  time.Time
}

func newProgressTracker() *progressTracker {
	return &progressTracker{nodes: map[string]*nodeSlot{}}
}

func (p *progressTracker) reset(promptID string) {
	p.promptID = promptID
	p.value = 0
	p.total = 0
	p.node = ""
	p.order = nil
	p.nodes = map[string]*nodeSlot{}
	p.updated = time.Now()
}

// ensureNode 按首次出现的顺序登记节点，用于给每段采样分配偏移量。
func (p *progressTracker) ensureNode(id string) *nodeSlot {
	if slot, ok := p.nodes[id]; ok {
		return slot
	}
	slot := &nodeSlot{}
	p.nodes[id] = slot
	p.order = append(p.order, id)
	sort.SliceStable(p.order, func(i, j int) bool {
		a, errA := strconv.Atoi(p.order[i])
		b, errB := strconv.Atoi(p.order[j])
		if errA == nil && errB == nil {
			return a < b
		}
		return p.order[i] < p.order[j]
	})
	return slot
}

// recalc 按节点顺序累加偏移量，current 为空时取最后一个有步数的节点。
func (p *progressTracker) recalc(current string) {
	offset := 0
	for _, id := range p.order {
		slot := p.nodes[id]
		slot.offset = offset
		if slot.max > 0 {
			offset += slot.max
		}
	}
	p.total = offset

	if current == "" {
		for i := len(p.order) - 1; i >= 0; i-- {
			id := p.order[i]
			if p.nodes[id].max > 0 {
				current = id
				break
			}
		}
	}
	p.node = current
	if slot, ok := p.nodes[current]; ok {
		p.value = slot.offset + slot.value
		if p.total > 0 && p.value > p.total {
			p.value = p.total
		}
	}
	p.updated = time.Now()
}

func (p *progressTracker) apply(msgType string, data json.RawMessage) {
	if len(data) == 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	switch msgType {
	case "execution_start":
		var d struct {
			PromptID string `json:"prompt_id"`
		}
		if json.Unmarshal(data, &d) == nil && d.PromptID != "" {
			p.reset(d.PromptID)
		}

	// ComfyUI 0.4x 的新格式：一次给出所有非 pending 节点的状态。
	case "progress_state":
		var d struct {
			PromptID string `json:"prompt_id"`
			Nodes    map[string]struct {
				Value float64 `json:"value"`
				Max   float64 `json:"max"`
				State string  `json:"state"`
			} `json:"nodes"`
		}
		if json.Unmarshal(data, &d) != nil {
			return
		}
		if d.PromptID != "" && d.PromptID != p.promptID {
			p.reset(d.PromptID)
		}
		current := ""
		for id, node := range d.Nodes {
			// 每个节点都会以 max=1 的占位状态上报（VAE 解码、保存图片等），
			// 只有真正带步数的采样节点才计入进度，否则总步数会被多算。
			if node.Max <= 1 {
				continue
			}
			slot := p.ensureNode(id)
			slot.max = int(node.Max)
			slot.value = int(node.Value)
			slot.state = node.State
			if node.State == "running" {
				current = id
			}
		}
		p.recalc(current)

	// 旧格式（0.3.x）单节点进度，保留兼容。
	case "progress":
		var d struct {
			Value    int    `json:"value"`
			Max      int    `json:"max"`
			PromptID string `json:"prompt_id"`
			Node     string `json:"node"`
		}
		if json.Unmarshal(data, &d) != nil {
			return
		}
		if d.PromptID != "" && d.PromptID != p.promptID {
			p.reset(d.PromptID)
		}
		slot := p.ensureNode(d.Node)
		slot.max = d.Max
		slot.value = d.Value
		slot.state = "running"
		p.recalc(d.Node)

	case "executing":
		var d struct {
			Node     *string `json:"node"`
			PromptID string  `json:"prompt_id"`
		}
		if json.Unmarshal(data, &d) != nil {
			return
		}
		// node == null 表示这一轮执行结束。
		if d.Node == nil && (d.PromptID == "" || d.PromptID == p.promptID) && p.total > 0 {
			p.value = p.total
		}

	case "execution_success":
		if p.total > 0 {
			p.value = p.total
		}
	case "execution_error":
		if p.total > 0 {
			p.value = p.total
		}
	}
}

// snapshot 只在 promptID 与当前作业一致时返回数据，避免上一个作业的尾事件串到新作业上。
func (p *progressTracker) snapshot(promptID string) (value, total int, node string, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if promptID == "" || p.promptID != promptID || p.total <= 0 {
		return 0, 0, "", false
	}
	return p.value, p.total, p.node, true
}

// startProgressWatcher 起一条常驻的 websocket 连接；断线后每 3 秒重连。
func (s *Server) startProgressWatcher() {
	if s.comfy == nil {
		return
	}
	if s.progress == nil {
		s.progress = newProgressTracker()
	}
	go func() {
		for {
			s.watchComfyEvents()
			time.Sleep(3 * time.Second)
		}
	}()
}

func (s *Server) watchComfyEvents() {
	base, err := url.Parse(s.comfy.base)
	if err != nil || base.Host == "" {
		return
	}
	if base.Scheme == "https" {
		base.Scheme = "wss"
	} else {
		base.Scheme = "ws"
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/ws"
	query := base.Query()
	query.Set("clientId", genClientID)
	base.RawQuery = query.Encode()

	conn, _, err := websocket.DefaultDialer.Dial(base.String(), nil)
	if err != nil {
		return
	}
	defer conn.Close()

	for {
		// ComfyUI 空闲时不一定有心跳，超时就重连，避免连接被中间设备回收后卡死。
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Minute))
		_, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if json.Unmarshal(payload, &msg) != nil {
			continue
		}
		s.progress.apply(msg.Type, msg.Data)
	}
}
