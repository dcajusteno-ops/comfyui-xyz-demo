// Package proxy 移植 vite.config.ts 的两条 server.proxy：
//   - /comfy/* → ComfyUI（默认 http://127.0.0.1:8188，COMFYUI_URL 覆盖），去 /comfy 前缀，
//     changeOrigin=false（保留客户端 Host），WebSocket 升级由 ReverseProxy 原生透传；
//   - /proxy/aliyun/* → https://mt.cn-hangzhou.aliyuncs.com，去前缀，changeOrigin=true（改写 Host）。
//
// /comfy/api/interrupt 与 /comfy/api/queue 额外做一层语义修正：
//   - interrupt：先清空等待队列，再全局中断。ComfyUI 原生的 /interrupt 只停当前任务，
//     等待队列里的旧任务会在下次生成时继续跑（表现为「中断后再次生成把中断的也一起跑了」）。
//   - queue：兼容旧前端发送的空队列数组清空写法与 DELETE 删除写法。
package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// NewComfy 构造 /comfy/ 反代。target 形如 http://127.0.0.1:8188。
func NewComfy(target *url.URL) http.Handler {
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			// 去掉 /comfy 前缀（对齐 vite 的 rewrite）
			pr.Out.URL.Path = strings.TrimPrefix(pr.Out.URL.Path, "/comfy")
			pr.Out.URL.RawPath = strings.TrimPrefix(pr.Out.URL.RawPath, "/comfy")
			// changeOrigin=false：保留客户端原始 Host
			pr.Out.Host = pr.In.Host
		},
	}
	return &comfyProxy{
		target: target,
		proxy:  rp,
		client: &http.Client{Timeout: 8 * time.Second},
	}
}

type comfyProxy struct {
	target *url.URL
	proxy  *httputil.ReverseProxy
	client *http.Client
}

func (p *comfyProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/comfy"), "/")
	switch {
	case path == "/api/interrupt" && r.Method == http.MethodPost:
		p.stopAll(w)
	case path == "/api/queue" && r.Method == http.MethodDelete:
		p.deleteQueue(w, r)
	case path == "/api/queue" && r.Method == http.MethodPost:
		p.postQueue(w, r)
	default:
		p.proxy.ServeHTTP(w, r)
	}
}

// stopAll 把前端的一次「中断」升级为「清空等待队列 + 全局中断」。
func (p *comfyProxy) stopAll(w http.ResponseWriter) {
	// 顺序不能反：先清 pending，再中断 running。否则中断后 ComfyUI 会立刻取下一个
	// pending 任务开始执行，再清队列也停不下它。
	_ = p.call(http.MethodPost, "/queue", map[string]any{"clear": true})
	_ = p.call(http.MethodPost, "/interrupt", map[string]any{})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// deleteQueue 把旧前端的 DELETE /queue 转成当前 ComfyUI 支持的 POST /queue {"delete":[...]}。
func (p *comfyProxy) deleteQueue(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "读取队列请求失败", http.StatusBadRequest)
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		http.Error(w, "队列请求不是合法 JSON", http.StatusBadRequest)
		return
	}
	body, _ := json.Marshal(payload)
	r.Method = http.MethodPost
	p.forwardBody(w, r, body)
}

// postQueue 兼容旧前端 clearQueue() 的 {queue_running:[],queue_pending:[]} 清空写法。
func (p *comfyProxy) postQueue(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "读取队列请求失败", http.StatusBadRequest)
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		p.forwardBody(w, r, raw)
		return
	}
	if _, hasClear := payload["clear"]; !hasClear {
		_, hasRunning := payload["queue_running"]
		_, hasPending := payload["queue_pending"]
		if hasRunning && hasPending {
			payload = map[string]any{"clear": true}
		}
	}
	body, _ := json.Marshal(payload)
	p.forwardBody(w, r, body)
}

func (p *comfyProxy) forwardBody(w http.ResponseWriter, r *http.Request, body []byte) {
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	r.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	p.proxy.ServeHTTP(w, r)
}

func (p *comfyProxy) call(method, path string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	u := *p.target
	u.Path = strings.TrimRight(u.Path, "/") + path
	u.RawQuery = ""
	req, err := http.NewRequest(method, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("comfy %s %s: %s", method, path, resp.Status)
	}
	return nil
}

// NewAliyun 构造 /proxy/aliyun/ 反代（changeOrigin=true 对齐：Host 改写为目标）。
func NewAliyun(target *url.URL) http.Handler {
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.URL.Path = strings.TrimPrefix(pr.Out.URL.Path, "/proxy/aliyun")
			pr.Out.URL.RawPath = strings.TrimPrefix(pr.Out.URL.RawPath, "/proxy/aliyun")
			// changeOrigin=true：SetURL 已把 Host 置为 target 的 host
		},
	}
	return rp
}
