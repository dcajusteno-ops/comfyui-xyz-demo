// Danbooru 图片同源代理（移植 server/animaImage.ts，SSOT 是 TS 侧）。
//
// 浏览器直连 cdn.donmai.us 会带 Sec-Fetch-Site: cross-site，被 Cloudflare
// 热链保护回 403（响应还是 CORP: same-origin 的 HTML，浏览器报 NotSameOrigin）。
// 服务端请求不带该头，可以正常取图；只放行 donmai.us 域，避免 SSRF。
package api

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

const (
	// AnimaImageRoute 是前端 <img> 走的同源路径。
	AnimaImageRoute    = "/xyz/anima/image"
	maxAnimaImageBytes = 20 << 20
	// Cloudflare 对 UA 敏感：Mozilla / Go 默认 UA 会被 403，插件同款 UA 实测 200。
	animaImageUserAgent = "Anima-Tools-Danbooru/1.0 (+https://github.com/nregret/Comfyui-Anima-Tools)"
)

var animaImageClient = &http.Client{Timeout: 20 * time.Second}

// IsAllowedAnimaImageURL 只允许 https 的 donmai.us 域（含子域）。
func IsAllowedAnimaImageURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "donmai.us" || strings.HasSuffix(host, ".donmai.us")
}

func (s *Stores) HandleAnimaImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		storage.SendJSON(w, http.StatusMethodNotAllowed, map[string]any{"success": false, "error": "Method Not Allowed"})
		return
	}

	target := r.URL.Query().Get("url")
	if !IsAllowedAnimaImageURL(target) {
		storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "url must be an https image URL on donmai.us"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": err.Error()})
		return
	}
	// 刻意不带 Sec-Fetch-*：那是浏览器才会发、且会触发 CDN 热链拦截的头
	req.Header.Set("User-Agent", animaImageUserAgent)
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8")

	resp, err := animaImageClient.Do(req)
	if err != nil {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": "Danbooru image HTTP " + strconv.Itoa(resp.StatusCode)})
		return
	}
	// 重定向后的最终地址也必须在白名单内
	if resp.Request == nil || resp.Request.URL == nil || !IsAllowedAnimaImageURL(resp.Request.URL.String()) {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": "redirected to a non-donmai host"})
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": "upstream did not return an image"})
		return
	}
	if resp.ContentLength > maxAnimaImageBytes {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": "image exceeds 20MB"})
		return
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAnimaImageBytes+1))
	if err != nil {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": err.Error()})
		return
	}
	if len(data) > maxAnimaImageBytes {
		storage.SendJSON(w, http.StatusBadGateway, map[string]any{"success": false, "error": "image exceeds 20MB"})
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	// URL 带 md5 文件 key，内容不可变；浏览器缓存一天
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
