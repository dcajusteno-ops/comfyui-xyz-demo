package noobai

import (
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sync"
)

const (
	noobaiServicePortBase = 9135
	noobaiServicePortMax  = 9145
)

// Service 持有 NoobAI 抽取模块的独立服务。
type Service struct {
	server   *Server
	mu       sync.Mutex
	listener net.Listener
	url      string
}

// NewService 创建 NoobAI 服务实例。
func NewService(assets fs.FS, dataRoot, comfyURL, imageManagerURL string) (*Service, error) {
	s, err := New(assets, dataRoot, comfyURL, imageManagerURL)
	if err != nil {
		return nil, err
	}
	return &Service{server: s}, nil
}

// Start 尝试在 127.0.0.1:9135~9145 中绑定第一个可用端口并启动服务。
func (s *Service) Start() string {
	for port := noobaiServicePortBase; port <= noobaiServicePortMax; port++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			continue
		}
		s.url = fmt.Sprintf("http://127.0.0.1:%d/", port)
		s.mu.Lock()
		s.listener = ln
		s.mu.Unlock()
		go func(l net.Listener) {
			if err := http.Serve(l, s.server.Handler()); err != nil && err != http.ErrServerClosed {
				log.Printf("noobai service stopped: %v", err)
			}
		}(ln)
		log.Printf("noobai service: %s", s.url)
		return s.url
	}
	log.Printf("noobai service: 端口 %d-%d 全部被占用", noobaiServicePortBase, noobaiServicePortMax)
	return ""
}

// URL 返回服务监听的地址。
func (s *Service) URL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.url
}

// Close 停止服务。
func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		return s.listener.Close()
	}
	return nil
}
