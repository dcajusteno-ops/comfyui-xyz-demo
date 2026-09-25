// Package launcher 移植 server/launcher.ts（外部工具启动器，复刻自 comfyui-demo-main）。
// SSOT 是 server/launcher.ts：命令构造、错误文案、图标缓存键都与其逐条对齐，勿单边改动。
// 功能不依赖 ComfyUI——离线（未连接服务）时照常可用。
package launcher

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// Store 挂在仓库/工作目录根上，数据落在 <root>/data/。
type Store struct {
	RepoRoot string
	Queue    *storage.WriteQueue
}

func NewStore(repoRoot string) *Store {
	return &Store{RepoRoot: repoRoot, Queue: storage.NewWriteQueue()}
}

type Tool struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
	Args string `json:"args,omitempty"`
	Icon string `json:"icon,omitempty"`
}

func (s *Store) toolsFile() string { return filepath.Join(s.RepoRoot, "data", "launcher-tools.json") }
func (s *Store) iconsDir() string  { return filepath.Join(s.RepoRoot, "data", "icons") }

// SplitLaunchArgs 对齐 TS splitLaunchArgs（strings.Fields 语义）。
func SplitLaunchArgs(argsString string) []string {
	return strings.Fields(argsString)
}

// ResolveLaunchCommand 对齐 TS buildLaunchCommand：
// http(s):// 网址 → cmd /c start ""（交给默认浏览器，无存在性检查）；
// .bat/.cmd/.html/.htm/.url → `cmd /c start "" <path> <args...>`，其余直接以目标路径启动；
// 工作目录 = 目标文件所在目录（网址为空 = 进程工作目录，对齐 TS ROOT 语义）。
// 扩展名分派大小写不敏感（对齐 path.extname().toLowerCase()）。
// isWebURL 对齐 TS isWebUrl：http(s):// 网址（大小写不敏感）。
// 网址无文件可 stat，运行时跳过存在性检查。
func isWebURL(targetPath string) bool {
	lower := strings.ToLower(targetPath)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func ResolveLaunchCommand(targetPath, argsString string) (file string, args []string, cwd string) {
	args = SplitLaunchArgs(argsString)
	if isWebURL(targetPath) {
		// 网址交给默认浏览器；无「所在目录」概念，cwd 为空 = 进程工作目录（对齐 TS ROOT 语义）
		cmdArgs := append([]string{"/c", "start", "", targetPath}, args...)
		return "cmd.exe", cmdArgs, ""
	}
	ext := strings.ToLower(filepath.Ext(targetPath))
	if ext == ".bat" || ext == ".cmd" || ext == ".html" || ext == ".htm" || ext == ".url" {
		cmdArgs := append([]string{"/c", "start", "", targetPath}, args...)
		return "cmd.exe", cmdArgs, filepath.Dir(targetPath)
	}
	return targetPath, args, filepath.Dir(targetPath)
}

// Handle 挂载 /xyz/launcher 与 /xyz/launcher/*，按后缀与方法分派（对齐 TS 路由）。
func (s *Store) Handle(w http.ResponseWriter, r *http.Request) {
	pathname := r.URL.Path
	method := strings.ToUpper(r.Method)

	switch {
	case strings.HasSuffix(pathname, "/run"):
		if method != http.MethodPost {
			storage.SendJSON(w, http.StatusMethodNotAllowed, map[string]any{"success": false, "error": "Method Not Allowed"})
			return
		}
		s.handleRun(w, r)
		return
	case strings.HasSuffix(pathname, "/icon"):
		if method != http.MethodPost {
			storage.SendJSON(w, http.StatusMethodNotAllowed, map[string]any{"success": false, "error": "Method Not Allowed"})
			return
		}
		s.handleExtractIcon(w, r)
		return
	}

	switch method {
	case http.MethodGet:
		tools, err := s.readTools()
		if err != nil {
			storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
			return
		}
		storage.SendJSON(w, http.StatusOK, map[string]any{"success": true, "tools": tools})

	case http.MethodPost:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, http.StatusInternalServerError)
			return
		}
		tool, ok := sanitizeToolInput(payload)
		if !ok {
			storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "缺少 name 或 path 字段"})
			return
		}
		tool.ID = uuidv4()
		err = s.Queue.Do(s.toolsFile(), func() error {
			tools, _ := s.readTools()
			tools = append(tools, tool)
			return s.writeTools(tools)
		})
		if err != nil {
			storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
			return
		}
		storage.SendJSON(w, http.StatusOK, map[string]any{"success": true, "tool": tool})

	case http.MethodPut:
		payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
		if err != nil {
			storage.SendError(w, err, http.StatusInternalServerError)
			return
		}
		id, _ := payload["id"].(string)
		tool, ok := sanitizeToolInput(payload)
		if id == "" || !ok {
			storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "缺少 id 或 name/path 字段"})
			return
		}
		tool.ID = id
		updated := false
		err = s.Queue.Do(s.toolsFile(), func() error {
			tools, _ := s.readTools()
			for i := range tools {
				if tools[i].ID == id {
					tools[i] = tool
					updated = true
					break
				}
			}
			if !updated {
				return nil
			}
			return s.writeTools(tools)
		})
		if err != nil {
			storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
			return
		}
		if !updated {
			storage.SendJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": "tool not found"})
			return
		}
		storage.SendJSON(w, http.StatusOK, map[string]any{"success": true})

	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if id == "" {
			payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
			if err == nil {
				id, _ = payload["id"].(string)
			}
		}
		if id == "" {
			storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "缺少 id 参数"})
			return
		}
		removed := false
		err := s.Queue.Do(s.toolsFile(), func() error {
			tools, _ := s.readTools()
			next := tools[:0:0]
			for _, t := range tools {
				if t.ID == id {
					removed = true
					continue
				}
				next = append(next, t)
			}
			if !removed {
				return nil
			}
			return s.writeTools(next)
		})
		if err != nil {
			storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
			return
		}
		if !removed {
			storage.SendJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": "tool not found"})
			return
		}
		storage.SendJSON(w, http.StatusOK, map[string]any{"success": true})

	default:
		storage.SendJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": "Unknown launcher endpoint"})
	}
}

func (s *Store) readTools() ([]Tool, error) {
	raw, err := os.ReadFile(s.toolsFile())
	if err != nil {
		return []Tool{}, nil // 不存在或损坏 → 空列表（对齐 TS readJsonFile → null → []）
	}
	var tools []Tool
	if err := json.Unmarshal(raw, &tools); err != nil {
		return []Tool{}, nil
	}
	return tools, nil
}

func (s *Store) writeTools(tools []Tool) error {
	if err := os.MkdirAll(filepath.Dir(s.toolsFile()), 0o755); err != nil {
		return err
	}
	return storage.AtomicWriteJSON(s.toolsFile(), tools)
}

func sanitizeToolInput(payload map[string]any) (Tool, bool) {
	name := strings.TrimSpace(stringField(payload, "name"))
	toolPath := strings.TrimSpace(stringField(payload, "path"))
	if name == "" || toolPath == "" {
		return Tool{}, false
	}
	return Tool{
		Name: name,
		Path: toolPath,
		Args: strings.TrimSpace(stringField(payload, "args")),
		Icon: stringField(payload, "icon"),
	}, true
}

func stringField(payload map[string]any, key string) string {
	v, _ := payload[key].(string)
	return v
}

func (s *Store) handleRun(w http.ResponseWriter, r *http.Request) {
	payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
	if err != nil {
		storage.SendError(w, err, http.StatusInternalServerError)
		return
	}
	id, _ := payload["id"].(string)
	tools, _ := s.readTools()
	var tool *Tool
	for i := range tools {
		if tools[i].ID == id {
			tool = &tools[i]
			break
		}
	}
	if tool == nil {
		storage.SendJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": "tool not found"})
		return
	}
	targetPath := strings.TrimSpace(tool.Path)
	if targetPath == "" {
		storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "tool path is empty"})
		return
	}
	// 网址无文件可查，跳过存在性检查（本地路径仍要求存在，防拼错路径静默起不来）
	if !isWebURL(targetPath) {
		if _, err := os.Stat(targetPath); err != nil {
			if os.IsNotExist(err) {
				storage.SendJSON(w, http.StatusNotFound, map[string]any{"success": false, "error": "tool file not found"})
				return
			}
			storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
			return
		}
	}

	file, args, cwd := ResolveLaunchCommand(targetPath, tool.Args)
	// 对齐 TS：detached + stdio ignore + windowsHide（仅 CREATE_NO_WINDOW 抑制控制台，
	// 不隐藏被启动 GUI 程序的主窗口——HideWindow 字段会传 SW_HIDE，已踩坑移除）
	cmd := exec.Command(file, args...)
	cmd.Dir = cwd
	cmd.SysProcAttr = hideWindow()
	if err := cmd.Start(); err != nil {
		storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	go func() { _, _ = cmd.Process.Wait() }() // 回收句柄，不阻塞请求
	storage.SendJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Store) handleExtractIcon(w http.ResponseWriter, r *http.Request) {
	payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
	if err != nil {
		storage.SendError(w, err, http.StatusInternalServerError)
		return
	}
	targetPath := strings.TrimSpace(stringField(payload, "path"))
	if targetPath == "" || !strings.EqualFold(filepath.Ext(targetPath), ".exe") {
		storage.SendJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "仅支持从 .exe 提取图标"})
		return
	}
	icon, err := s.extractExeIcon(targetPath)
	if err != nil {
		storage.SendJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": err.Error()})
		return
	}
	storage.SendJSON(w, http.StatusOK, map[string]any{"success": true, "icon": icon})
}

// extractExeIcon 对齐 TS extractExeIcon：PowerShell ExtractAssociatedIcon →
// data/icons/<md5(path)>.png 缓存 → base64 data URL。
func (s *Store) extractExeIcon(targetPath string) (string, error) {
	if err := os.MkdirAll(s.iconsDir(), 0o755); err != nil {
		return "", err
	}
	hash := md5.Sum([]byte(targetPath))
	iconPath := filepath.Join(s.iconsDir(), hex.EncodeToString(hash[:])+".png")

	if _, err := os.Stat(iconPath); os.IsNotExist(err) {
		// PowerShell 单引号串的转义是成对单引号（对齐 TS 的 replace(/'/g, "''")）
		psPath := strings.ReplaceAll(targetPath, "'", "''")
		psIconPath := strings.ReplaceAll(iconPath, "'", "''")
		script := "Add-Type -AssemblyName System.Drawing;" +
			"$icon = [System.Drawing.Icon]::ExtractAssociatedIcon('" + psPath + "');" +
			"if ($icon) { $b = $icon.ToBitmap(); $b.Save('" + psIconPath + "', [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); $icon.Dispose() }"
		cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
		cmd.SysProcAttr = hideWindow()
		if out, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("图标提取失败: %v: %s", err, strings.TrimSpace(string(out)))
		}
	}

	bytes, err := os.ReadFile(iconPath)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(bytes), nil
}

func uuidv4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
