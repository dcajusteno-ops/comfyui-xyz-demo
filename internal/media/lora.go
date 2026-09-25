package media

// lora.go 移植 server/lora.ts：POST /xyz/lora/extract-metadata。
// 安全边界：仅 .safetensors 头部元数据；路径白名单（XYZ_LORA_ALLOWED_ROOTS 可选）。

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/dcajusteno-ops/comfyui-xyz-demo/internal/storage"
)

// IsAllowedSafetensorsPath 对齐 isAllowedSafetensorsPath：
//   - 硬约束：解析后的扩展名必须是 .safetensors；
//   - 可选约束：XYZ_LORA_ALLOWED_ROOTS（Windows 分号、其余冒号分隔）进一步限定根目录。
func IsAllowedSafetensorsPath(filePath string) bool {
	if filePath == "" || strings.Contains(filePath, "\x00") {
		return false
	}
	resolved, err := filepath.Abs(filePath)
	if err != nil {
		return false
	}
	if strings.ToLower(filepath.Ext(resolved)) != ".safetensors" {
		return false
	}
	roots := allowedRoots()
	if len(roots) == 0 {
		return true
	}
	for _, root := range roots {
		rel, err := filepath.Rel(root, resolved)
		if err != nil {
			continue
		}
		// 对齐 path.relative 语义：rel=="" 或不以 ".." 开头且非绝对路径
		if rel == "" || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)) {
			return true
		}
	}
	return false
}

func allowedRoots() []string {
	env := os.Getenv("XYZ_LORA_ALLOWED_ROOTS")
	if env == "" {
		return nil
	}
	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}
	var roots []string
	for _, root := range strings.Split(env, sep) {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if abs, err := filepath.Abs(root); err == nil {
			roots = append(roots, abs)
		}
	}
	return roots
}

// extractSafetensorsMetadata 对齐 extractSafetensorsMetadata：
// 读 8 字节小端 header 长度（>100MB 拒绝），再读 header JSON 的 __metadata__。
func extractSafetensorsMetadata(filePath string) (map[string]any, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var sizeBuf [8]byte
	if _, err := io.ReadFull(f, sizeBuf[:]); err != nil {
		return nil, fmt.Errorf("read header size: %w", err)
	}
	headerSize := binary.LittleEndian.Uint64(sizeBuf[:])
	if headerSize > 100*1024*1024 {
		return nil, fmt.Errorf("Safetensors header size is too large")
	}
	headerBytes := make([]byte, headerSize)
	if _, err := io.ReadFull(f, headerBytes); err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	var header map[string]json.RawMessage
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, err
	}
	meta, ok := header["__metadata__"]
	if !ok || meta == nil {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(meta, &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

// HandleLoraExtractMetadata 对齐 handleExtractMetadata（POST /xyz/lora/extract-metadata）。
func (m *Manager) HandleLoraExtractMetadata(w http.ResponseWriter, r *http.Request) {
	payload, err := storage.ReadJSONBody(w, r, storage.DefaultBodyLimit)
	if err != nil {
		storage.SendError(w, err, 500)
		return
	}
	filePath, _ := payload["file_path"].(string)
	if filePath == "" {
		storage.SendJSON(w, 400, map[string]any{"success": false, "error": "Missing file_path"})
		return
	}
	if !IsAllowedSafetensorsPath(filePath) {
		storage.SendJSON(w, 403, map[string]any{"success": false, "error": "file_path is not an allowed .safetensors path"})
		return
	}
	metadata, err := extractSafetensorsMetadata(filePath)
	if err != nil {
		storage.SendJSON(w, 500, map[string]any{"success": false, "error": fmt.Sprintf("Failed to extract metadata: %s", err.Error())})
		return
	}
	storage.SendJSON(w, 200, map[string]any{"success": true, "metadata": metadata})
}
