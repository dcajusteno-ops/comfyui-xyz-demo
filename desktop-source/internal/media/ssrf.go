// Package media 移植 server/lora.ts 与 server/exampleImages.ts。
// 本文件是 SSRF 双层防护（对齐 exampleImages.ts 的 isPrivateIp / isAllowedMediaUrl / assertPublicMediaHost）。
package media

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var ipv4MappedRe = regexp.MustCompile(`^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$`)

// IsPrivateIP 对齐 isPrivateIp：
// IPv6（::/::1/fe80 link-local/fc-fd unique local/::ffff: 映射 IPv4）与 IPv4 私网段。
// 注意：非法 IPv4（段数不对/超范围）按私有处理（fail-closed）。
func IsPrivateIP(ip string) bool {
	if strings.Contains(ip, ":") {
		lower := strings.ToLower(ip)
		if lower == "::" || lower == "::1" {
			return true
		}
		if strings.HasPrefix(lower, "fe80") { // link-local
			return true
		}
		if strings.HasPrefix(lower, "fc") || strings.HasPrefix(lower, "fd") { // unique local
			return true
		}
		if m := ipv4MappedRe.FindStringSubmatch(lower); m != nil {
			return IsPrivateIP(m[1])
		}
		return false
	}
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return true
	}
	var nums [4]int
	for i, p := range parts {
		n := 0
		if p == "" || len(p) > 3 {
			return true
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return true
			}
			n = n*10 + int(c-'0')
		}
		if n > 255 {
			return true
		}
		nums[i] = n
	}
	a, b := nums[0], nums[1]
	if a == 0 || a == 10 || a == 127 {
		return true
	}
	if a == 169 && b == 254 { // link-local
		return true
	}
	if a == 172 && b >= 16 && b <= 31 {
		return true
	}
	if a == 192 && b == 168 {
		return true
	}
	if a == 100 && b >= 64 && b <= 127 { // CGNAT
		return true
	}
	return false
}

// IsAllowedMediaURL 对齐 isAllowedMediaUrl：
// 仅 http/https；拒绝 localhost/.localhost/.local/.internal 主机名；
// IP 字面量必须非私网；域名放行（下载前再做 DNS 复查）。
func IsAllowedMediaURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(u.Hostname()), "["), "]")
	if host == "" {
		return false
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return false
	}
	if net.ParseIP(host) == nil {
		return true // 域名交由 DNS 复查
	}
	return !IsPrivateIP(host)
}

// AssertPublicMediaHost 对齐 assertPublicMediaHost：
// 域名形态的媒体 URL 在 fetch 前做 DNS 解析复查，任一解析结果落在私网/回环即拒绝。
func AssertPublicMediaHost(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	host := strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(u.Hostname()), "["), "]")
	if net.ParseIP(host) != nil {
		return nil // IP 字面量已在 IsAllowedMediaURL 校验过
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("DNS lookup failed for %s: %w", host, err)
	}
	for _, addr := range addresses {
		ip := addr.IP.String()
		// Go 会把 IPv4-mapped 展开为点分形式，与 TS 的 isPrivateIp 判定等价
		if IsPrivateIP(ip) {
			return fmt.Errorf("Blocked media host resolving to a private address: %s → %s", host, ip)
		}
	}
	return nil
}

// MediaFetchClient 下载媒体用的公共 client（超时对齐浏览器侧合理上限）。
var MediaFetchClient = &http.Client{Timeout: 60 * time.Second}
