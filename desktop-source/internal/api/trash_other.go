//go:build !windows

package api

import "errors"

var errImageTrashUnsupported = errors.New("仅 Windows 支持回收站")

// MoveToRecycleBin 在非 Windows 平台不提供回收站能力：逐条报错，绝不回落永久删除。
func MoveToRecycleBin(paths []string) []FailedFile {
	failed := make([]FailedFile, 0, len(paths))
	for _, path := range paths {
		failed = append(failed, FailedFile{Path: path, Error: errImageTrashUnsupported.Error()})
	}
	return failed
}
