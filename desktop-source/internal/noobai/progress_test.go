package noobai

import "testing"

// ComfyUI 0.4x 会把所有正在执行的节点都报一遍，非采样节点的 max 恒为 1；
// 这些占位节点不能计入总步数，否则进度会跑到 100% 以上。
func TestProgressStateSkipsPlaceholderNodes(t *testing.T) {
	p := newProgressTracker()
	p.apply("execution_start", []byte(`{"prompt_id":"p1"}`))
	p.apply("progress_state", []byte(`{
		"prompt_id": "p1",
		"nodes": {
			"3": {"value": 0, "max": 28, "state": "running"},
			"9": {"value": 0, "max": 1, "state": "running"}
		}
	}`))

	value, total, node, ok := p.snapshot("p1")
	if !ok || total != 28 || value != 0 || node != "3" {
		t.Fatalf("first progress = %d/%d node=%q ok=%v, want 0/28 node=3", value, total, node, ok)
	}

	p.apply("progress_state", []byte(`{
		"prompt_id": "p1",
		"nodes": {
			"3": {"value": 28, "max": 28, "state": "finished"},
			"9": {"value": 1, "max": 1, "state": "finished"},
			"4": {"value": 5, "max": 12, "state": "running"}
		}
	}`))

	value, total, node, ok = p.snapshot("p1")
	if !ok || total != 40 || value != 33 || node != "4" {
		t.Fatalf("hires progress = %d/%d node=%q ok=%v, want 33/40 node=4", value, total, node, ok)
	}
}

func TestProgressLegacyMessage(t *testing.T) {
	p := newProgressTracker()
	p.apply("progress", []byte(`{"prompt_id":"p2","node":"5","value":7,"max":20}`))

	value, total, _, ok := p.snapshot("p2")
	if !ok || value != 7 || total != 20 {
		t.Fatalf("legacy progress = %d/%d ok=%v, want 7/20", value, total, ok)
	}
	if _, _, _, ok := p.snapshot("other"); ok {
		t.Fatal("snapshot for a different prompt should be ignored")
	}
}

func TestProgressNeverExceedsTotal(t *testing.T) {
	p := newProgressTracker()
	p.apply("progress_state", []byte(`{
		"prompt_id": "p3",
		"nodes": {"3": {"value": 30, "max": 28, "state": "running"}}
	}`))
	value, total, _, ok := p.snapshot("p3")
	if !ok || value != total || value != 28 {
		t.Fatalf("clamped progress = %d/%d, want 28/28", value, total)
	}
}
