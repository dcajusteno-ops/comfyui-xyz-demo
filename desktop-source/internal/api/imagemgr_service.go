// imagemgr_service.go —— 外置图片管理页的独立 HTTP 服务。
//
// 为什么单独起一个端口而不是主应用里的一个 tab：
// 用户要的是「外置网页版」——浏览器打开就是一个只有图片管理器的页面，
// 有自己的地址（http://127.0.0.1:9124/），不加载主应用外壳。
//
// 这个服务只做三件事：发 standalone.html、挂同一套 /xyz/images/* API、挂 /api/ui-state
// （让外置页面和主应用共用主题与「当前目录」状态）。监听 127.0.0.1，不暴露到局域网。
package api

import (
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"sync"
)

const (
	imageServicePortBase = 9124
	imageServicePortMax  = 9133
)

// ImageService 持有外置图片管理页的监听与地址。
type ImageService struct {
	dist    fs.FS
	static  http.Handler
	handler *ImageHandler
	uiState *UiStateStore

	mu       sync.Mutex
	listener net.Listener
	url      string
}

func NewImageService(dist fs.FS, handler *ImageHandler, uiState *UiStateStore) *ImageService {
	var static http.Handler
	if dist != nil {
		// 与主应用同一套缓存头规则（assets immutable / data ETag）
		static = NewStaticHandler(dist)
	}
	return &ImageService{dist: dist, static: static, handler: handler, uiState: uiState}
}

// Start 绑定 127.0.0.1:9124~9133 中第一个可用端口，返回页面地址；全部被占用时返回空串。
func (s *ImageService) Start() string {
	for port := imageServicePortBase; port <= imageServicePortMax; port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			continue
		}
		s.url = fmt.Sprintf("http://127.0.0.1:%d/", port)
		s.mu.Lock()
		s.listener = listener
		s.mu.Unlock()
		go func(ln net.Listener) {
			if err := http.Serve(ln, s.mux()); err != nil {
				log.Printf("image manager service stopped: %v", err)
			}
		}(listener)
		log.Printf("image manager: %s", s.url)
		return s.url
	}
	log.Printf("image manager: 端口 %d-%d 全部被占用，外置页面不可用", imageServicePortBase, imageServicePortMax)
	return ""
}

func (s *ImageService) URL() string { return s.url }

// Stop 关闭监听（测试用；生产进程退出即释放）。
func (s *ImageService) Stop() {
	s.mu.Lock()
	listener := s.listener
	s.listener = nil
	s.mu.Unlock()
	if listener != nil {
		_ = listener.Close()
	}
}

func (s *ImageService) mux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(ImageRoutePrefix+"/config", s.handler.HandleConfig)
	mux.HandleFunc(ImageRoutePrefix+"/browse", s.handler.HandleBrowse)
	mux.HandleFunc(ImageRoutePrefix+"/file", s.handler.HandleFile)
	mux.HandleFunc(ImageRoutePrefix+"/delete", s.handler.HandleDelete)
	if s.uiState != nil {
		mux.HandleFunc("/api/ui-state", s.uiState.Handle)
		mux.HandleFunc("/api/ui-state/", s.uiState.Handle)
	}
	mux.HandleFunc("/", s.serveApp)
	return mux
}

// serveApp：根路径发外置页面，其余按 dist 静态资源处理。
func (s *ImageService) serveApp(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/", "/standalone", "/standalone.html":
		if s.dist == nil {
			http.Error(w, "standalone.html 未打包：请先运行 vite build", http.StatusServiceUnavailable)
			return
		}
		data, err := fs.ReadFile(s.dist, "standalone.html")
		if err != nil {
			http.Error(w, "standalone.html 未打包：请先运行 vite build", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(data)
	default:
		if s.dist == nil || s.static == nil {
			http.NotFound(w, r)
			return
		}
		s.static.ServeHTTP(w, r)
	}
}
