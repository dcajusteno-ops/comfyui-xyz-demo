// Package proxy 移植 vite.config.ts 的两条 server.proxy：
//   - /comfy/* → ComfyUI（默认 http://127.0.0.1:8188，COMFYUI_URL 覆盖），去 /comfy 前缀，
//     changeOrigin=false（保留客户端 Host），WebSocket 升级由 ReverseProxy 原生透传；
//   - /proxy/aliyun/* → https://mt.cn-hangzhou.aliyuncs.com，去前缀，changeOrigin=true（改写 Host）。
package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
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
	return rp
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
