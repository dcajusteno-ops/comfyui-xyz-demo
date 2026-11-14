package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

type recordedRequest struct {
	method string
	path   string
	body   map[string]any
}

type fakeComfy struct {
	mu       sync.Mutex
	requests []recordedRequest
}

func (f *fakeComfy) push(r recordedRequest) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r)
}

func (f *fakeComfy) all() []recordedRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recordedRequest(nil), f.requests...)
}

func newFakeComfy(t *testing.T) (*fakeComfy, *httptest.Server) {
	t.Helper()
	fake := &fakeComfy{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		fake.push(recordedRequest{method: r.Method, path: r.URL.Path, body: body})
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	return fake, server
}

func newProxy(t *testing.T, server *httptest.Server) http.Handler {
	t.Helper()
	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse target: %v", err)
	}
	return NewComfy(target)
}

func TestInterruptClearsPendingThenStopsAll(t *testing.T) {
	fake, comfy := newFakeComfy(t)
	proxy := newProxy(t, comfy)

	req := httptest.NewRequest(http.MethodPost, "/comfy/api/interrupt", strings.NewReader(`{"prompt_id":"abc"}`))
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got := fake.all()
	if len(got) != 2 {
		t.Fatalf("comfy requests = %d, want 2: %#v", len(got), got)
	}
	if got[0].path != "/queue" || got[0].body["clear"] != true {
		t.Fatalf("first request = %#v, want clear queue", got[0])
	}
	if got[1].path != "/interrupt" || len(got[1].body) != 0 {
		t.Fatalf("second request = %#v, want global interrupt", got[1])
	}
}

func TestLegacyQueueClearPayloadIsConverted(t *testing.T) {
	fake, comfy := newFakeComfy(t)
	proxy := newProxy(t, comfy)

	req := httptest.NewRequest(http.MethodPost, "/comfy/api/queue", strings.NewReader(`{"queue_running":[],"queue_pending":[]}`))
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got := fake.all()
	if len(got) != 1 || got[0].path != "/api/queue" || got[0].body["clear"] != true {
		t.Fatalf("requests = %#v, want POST /api/queue {clear:true}", got)
	}
}

func TestQueueDeleteIsForwardedAsPost(t *testing.T) {
	fake, comfy := newFakeComfy(t)
	proxy := newProxy(t, comfy)

	req := httptest.NewRequest(http.MethodDelete, "/comfy/api/queue", strings.NewReader(`{"delete":["a"]}`))
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got := fake.all()
	if len(got) != 1 || got[0].method != http.MethodPost || got[0].path != "/api/queue" {
		t.Fatalf("requests = %#v, want POST /api/queue", got)
	}
	deleted, _ := got[0].body["delete"].([]any)
	if len(deleted) != 1 || deleted[0] != "a" {
		t.Fatalf("delete body = %#v", got[0].body)
	}
}
