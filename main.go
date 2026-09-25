// ComfyUI XYZ Web —— Go 版单文件应用（任务书-Go单文件exe.md）。
// 默认形态：WebView2 独立桌面窗口（不打开浏览器）；内部 HTTP 服务照旧承载
// embed 前端 dist + 移植 server/*.ts 的中间件 + 两条反代。
// 行为 SSOT 是 server/*.ts 与 vite.config.ts；embed 声明必须在仓库根（见任务书 D2）。
// 降级路径：`--web` 参数 / DSH_WEB=1 / DSH_E2E=1 / WebView2 运行时缺失 → 旧「服务 + 浏览器」模式。
package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/api"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/launcher"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/media"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/mobile"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/proxy"
	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

//go:embed all:dist
var distFS embed.FS

const (
	appTitle = "ComfyUI XYZ Web"
	// 首次启动的默认窗口尺寸（之后以 data/window-state.json 记忆的上次尺寸为准）
	winWidth    = 1600
	winHeight   = 1000
	winMinWidth = 1100
	winMinHight = 700
	// 桌面窗口专用端口：与 dev server（9999）解耦，保证每次启动 origin 稳定（localStorage 不丢）
	appPortBase = "9123"
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		log.Fatalf("invalid URL %q: %v", raw, err)
	}
	return u
}

func main() {
	port := envOr("PORT", "9999")
	comfyTarget := mustParseURL(envOr("COMFYUI_URL", "http://127.0.0.1:8188"))
	// vite.config.ts 的固定目标（翻译 API；签名由前端 crypto-js 完成，服务端纯透传）
	aliyunTarget := mustParseURL("https://mt.cn-hangzhou.aliyuncs.com")

	webMode := flag.Bool("web", false, "以「本地服务 + 系统浏览器」模式运行（默认是独立桌面窗口）")
	flag.Parse()
	if *webMode || os.Getenv("DSH_WEB") == "1" || os.Getenv("DSH_E2E") == "1" {
		runWebMode(port, comfyTarget, aliyunTarget, true)
		return
	}

	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	// 必须在创建任何窗口前声明 DPI 感知，否则系统按 96 DPI 渲染再拉伸到显示缩放比例，整体发糊
	setDPIAware()
	// 单实例保护：前端状态存 localStorage，按「地址+端口」隔离。双开会让第二个实例
	// 拿不到固定端口而漂移到其它端口 → origin 变化 → 状态"重置"。测试模式（DSH_APP_PORT）豁免。
	if os.Getenv("DSH_APP_PORT") == "" && anotherInstanceRunning() {
		return
	}
	dist := embeddedDist()
	mux := buildMux(root, dist, comfyTarget, aliyunTarget)

	// 桌面窗口模式绑定**专用固定端口 9123**（而非 dev 的 9999）：dev/exe 可共存互不干扰，
	// 且每次启动 origin 稳定 → localStorage（预设/面板状态）不会因端口漂移而"重置"。
	// 0.0.0.0 绑定同时覆盖手机联动（http://<局域网IP>:9123）。被占则 9124/9125… 顺延，仍稳定可预期。
	ln, actual := listenStable(envOr("DSH_APP_PORT", appPortBase))
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	// 防火墙规则：手机联动需要入站放行；需管理员权限，失败静默（非阻断）
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "netsh", "advfirewall", "firewall", "add", "rule",
			"name=ComfyUI XYZ Web "+actual, "dir=in", "action=allow", "protocol=TCP", "localport="+actual).Run()
	}()

	base := "http://127.0.0.1:" + actual
	// WebView2 用户数据目录固定到工作目录，避免默认落在 exe 同名目录且不可写时创建失败
	w, ww, hh := newWindow(root)
	if w == nil {
		// WebView2 运行时缺失 → 降级为浏览器模式
		srv.Close()
		runWebMode(port, comfyTarget, aliyunTarget, false)
		return
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	w.SetSize(winMinWidth, winMinHight, webview2.HintMin)
	w.Navigate(base)
	go watchWindowSize(w, filepath.Join(root, "data", "window-state.json"), ww, hh)
	w.Run() // 阻塞到窗口关闭
}

// newWindow 创建 WebView2 桌面窗口；尺寸优先用上次记忆（data/window-state.json），否则用默认值，
// 二者都钳制到主屏大小以内。返回窗口与实际生效的宽高（供尺寸记忆的初始基线）。
func newWindow(root string) (webview2.WebView, int, int) {
	ww, hh := loadWindowSize(filepath.Join(root, "data", "window-state.json"))
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(root, ".webview2"),
		WindowOptions: webview2.WindowOptions{
			Title:  appTitle,
			Width:  uint(ww),
			Height: uint(hh),
			Center: true,
			// rsrc 编译的图标资源组 ID 从 1 开始（scripts/appicon.ico → rsrc_windows_amd64.syso）
			IconId: 1,
		},
	})
	return w, ww, hh
}

type windowState struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

func loadWindowSize(file string) (int, int) {
	w, h := winWidth, winHeight
	if raw, err := os.ReadFile(file); err == nil {
		var st windowState
		if json.Unmarshal(raw, &st) == nil && st.Width >= 400 && st.Height >= 300 {
			w, h = st.Width, st.Height
		}
	}
	// 钳制到主屏（用户可能换过小屏/缩放），留少量余量
	sw, sh := primaryScreenSize()
	if maxW, maxH := sw*95/100, sh*92/100; w > maxW || h > maxH {
		w, h = minInt(w, maxW), minInt(h, maxH)
	}
	return w, h
}

// watchWindowSize 周期采样窗口客户区大小，变化即落盘（关窗时最多丢最近 2 秒的调整，可忽略）。
// 最小化时 GetWindowRect 返回 (-32000,-32000)，跳过不存。
func watchWindowSize(w webview2.WebView, file string, lastW, lastH int) {
	_ = os.MkdirAll(filepath.Dir(file), 0o755)
	user32 := windows.NewLazySystemDLL("user32.dll")
	proc := user32.NewProc("GetWindowRect")
	var last string
	for {
		time.Sleep(2 * time.Second)
		var r struct{ left, top, right, bottom int32 }
		_, _, _ = proc.Call(uintptr(w.Window()), uintptr(unsafe.Pointer(&r)))
		if r.left < -30000 || r.top < -30000 { // 最小化时的坐标是 -32000
			continue
		}
		ww, hh := int(r.right-r.left), int(r.bottom-r.top)
		if ww < 200 || hh < 200 || (ww == lastW && hh == lastH) {
			continue
		}
		key := fmt.Sprintf("%dx%d", ww, hh)
		if key == last {
			continue
		}
		last = key
		lastW, lastH = ww, hh
		_ = storage.AtomicWriteJSON(file, windowState{Width: ww, Height: hh})
	}
}

func primaryScreenSize() (int, int) {
	user32 := windows.NewLazySystemDLL("user32.dll")
	cx, _, _ := user32.NewProc("GetSystemMetrics").Call(0) // SM_CXSCREEN
	cy, _, _ := user32.NewProc("GetSystemMetrics").Call(1) // SM_CYSCREEN
	return int(int32(cx)), int(int32(cy))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// anotherInstanceRunning 用命名互斥体检测是否已有实例在跑。
func anotherInstanceRunning() bool {
	name, _ := windows.UTF16FromString("Local\\ComfyUI-XYZ-Web.SingleInstance")
	_, err := windows.CreateMutex(nil, false, &name[0])
	if err == nil {
		return false // 新建成功，互斥体随进程生命周期持有（不 CloseHandle，正是我们要的）
	}
	// 已有实例：弹一个原生提示框（GUI 无控制台，这是唯一可达的反馈）
	title, _ := windows.UTF16FromString(appTitle)
	msg, _ := windows.UTF16FromString("ComfyUI XYZ Web 已在运行，请使用已打开的窗口。")
	_, _, _ = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(
		0,
		uintptr(unsafe.Pointer(&msg[0])),
		uintptr(unsafe.Pointer(&title[0])),
		0,
	)
	return true
}

// listenStable 从 base 开始逐个 +1 尝试绑定 0.0.0.0（最多 20 个），保证端口可预期；
// 全部被占才退到 127.0.0.1 随机端口（此时 origin 会漂移，但已由单实例保护兜底）。
func listenStable(base string) (net.Listener, string) {
	p, err := strconv.Atoi(base)
	if err == nil {
		for i := 0; i < 20; i++ {
			ln, e := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", p+i))
			if e == nil {
				return ln, fmt.Sprint(p + i)
			}
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("监听失败（基础端口 %s 与随机端口均不可用）: %v", base, err)
	}
	return ln, fmt.Sprint(ln.Addr().(*net.TCPAddr).Port)
}

// runWebMode 是 v1 的运行形态：本地服务 + 自动打开浏览器（E2E 用）。
// windowsgui 构建下控制台不可见，输出仅在有控制台的场景有意义。
func runWebMode(port string, comfyTarget, aliyunTarget *url.URL, openBrowser bool) {
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	dist := embeddedDist()
	mux := buildMux(root, dist, comfyTarget, aliyunTarget)

	addr := "0.0.0.0:" + port
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("端口 %s 监听失败（可能被占用，run.bat 菜单[1]可自动清理）: %v", port, err)
	}

	base := "http://127.0.0.1:" + port
	fmt.Println("==================================================")
	fmt.Println("        ComfyUI XYZ Web (Go 版) 启动成功")
	fmt.Println("==================================================")
	fmt.Printf("  本机访问:   %s\n", base)
	for _, lan := range lanAddresses(port) {
		fmt.Printf("  局域网访问: %s （手机同 Wi-Fi 可用）\n", lan+"/#/mobile-tag")
	}
	fmt.Printf("  ComfyUI:    %s（COMFYUI_URL 可覆盖）\n", comfyTarget)

	// 防火墙规则两种模式都有意义（手机联动需要入站放行）；需管理员权限，失败静默（非阻断）
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = exec.CommandContext(ctx, "netsh", "advfirewall", "firewall", "add", "rule",
			"name=ComfyUI XYZ Web "+port, "dir=in", "action=allow", "protocol=TCP", "localport="+port).Run()
	}()

	// 自动打开浏览器（E2E 通过 DSH_E2E=1 禁用，对齐 vite.config 的 open 逻辑）
	if openBrowser && os.Getenv("DSH_E2E") != "1" {
		go func() {
			// rundll32 不弹额外控制台窗口；失败静默（手动开浏览器即可）
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = exec.CommandContext(ctx, "rundll32", "url.dll,FileProtocolHandler", base).Run()
		}()
	}

	srv := &http.Server{Handler: mux}
	log.Fatal(srv.Serve(ln))
}

func embeddedDist() fs.FS {
	dist, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatalf("embedded dist missing (run `vite build` before `go build`): %v", err)
	}
	return dist
}

// buildMux 汇总全部路由。两种运行形态共用同一套 handler，行为完全一致。
func buildMux(root string, dist fs.FS, comfyTarget, aliyunTarget *url.URL) *http.ServeMux {
	stores := &api.Stores{RepoRoot: root, Queue: storage.NewWriteQueue()}
	comfyBaseURL := envOr("COMFYUI_URL", comfyTarget.String())
	mediaMgr := media.NewManager(comfyBaseURL)
	syncMgr := mobile.NewSyncManager(comfyBaseURL)
	genMgr := mobile.NewGenManager(comfyBaseURL)

	mux := http.NewServeMux()
	// 注意：/api/mobile/gen 必须先于 /api/mobile 命中（对齐 vite 中间件注册顺序约束，见任务书 3.2）。
	// TS 的 startsWith 语义 → 精确路径与前缀路径都指到同一 handler（方法分派在 handler 内）。
	mux.Handle("/api/mobile/gen", http.HandlerFunc(genMgr.Handle))
	mux.Handle("/api/mobile/gen/", http.HandlerFunc(genMgr.Handle))
	mux.Handle("/api/mobile", http.HandlerFunc(syncMgr.Handle))
	mux.Handle("/api/mobile/", http.HandlerFunc(syncMgr.Handle))
	mux.HandleFunc("/api/notes", stores.HandleNotes)
	mux.HandleFunc("/api/notes/", stores.HandleNotes)
	mux.HandleFunc("/api/prompts", stores.HandlePrompts)
	mux.HandleFunc("/api/prompts/", stores.HandlePrompts)
	mux.HandleFunc("/xyz/wildcards", stores.HandleWildcards)
	mux.HandleFunc("/xyz/wildcards/", stores.HandleWildcards)
	mux.HandleFunc("/xyz/fs/folders", stores.HandleFsBrowse)
	mux.HandleFunc("/xyz/fs/folders/", stores.HandleFsBrowse)
	// 外部工具启动器（离线可用，不依赖 ComfyUI）：CRUD + run + 图标提取
	launcherStore := launcher.NewStore(root)
	mux.HandleFunc("/xyz/launcher", launcherStore.Handle)
	mux.HandleFunc("/xyz/launcher/", launcherStore.Handle)
	// TS 版 lora 只注册精确路径；exampleImages 的 startsWith("/xyz/example") 语义 →
	// 三个前缀模式都要挂到同一 handler（"/xyz/example-images/..." 不落在 "/xyz/example/" 之内）
	mux.HandleFunc("/xyz/lora/extract-metadata", mediaMgr.HandleLoraExtractMetadata)
	mux.HandleFunc("/xyz/example", mediaMgr.Handle)
	mux.HandleFunc("/xyz/example/", mediaMgr.Handle)
	mux.HandleFunc("/xyz/example-images", mediaMgr.Handle)
	mux.HandleFunc("/xyz/example-images/", mediaMgr.Handle)
	mux.HandleFunc("/xyz/example-image-files", mediaMgr.Handle)
	mux.Handle("/comfy/", proxy.NewComfy(comfyTarget))
	mux.Handle("/proxy/aliyun/", proxy.NewAliyun(aliyunTarget))
	mux.Handle("/", http.FileServerFS(dist))
	return mux
}

// setDPIAware 声明进程级 DPI 感知，避免 WebView2 内容被系统拉伸发糊。
// 优先 Per-Monitor V2（Win10 1703+），失败逐级降级：Shcore Per-Monitor → System Aware。
// go-webview2 自身不做任何 DPI 声明（模块源码已核实），必须在首个窗口创建前调用。
func setDPIAware() {
	user32 := windows.NewLazySystemDLL("user32.dll")
	if p := user32.NewProc("SetProcessDpiAwarenessContext"); p.Find() == nil {
		// DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4
		if r, _, _ := p.Call(^uintptr(3)); r != 0 {
			return
		}
	}
	if p := windows.NewLazySystemDLL("shcore.dll").NewProc("SetProcessDpiAwareness"); p.Find() == nil {
		if r, _, _ := p.Call(2); r != 0 { // PROCESS_PER_MONITOR_DPI_AWARE
			return
		}
	}
	_, _, _ = user32.NewProc("SetProcessDPIAware").Call()
}

// lanAddresses 列出非回环、非链路本地的 IPv4 地址（对齐 run.bat 的 Get-LanIp 简化版）。
func lanAddresses(port string) []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, fmt.Sprintf("http://%s:%s", ip4, port))
		}
	}
	return out
}
