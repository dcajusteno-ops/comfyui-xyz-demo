package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsAllowedAnimaImageURL(t *testing.T) {
	allowed := []string{
		"https://cdn.donmai.us/sample/65/08/a.jpg",
		"https://danbooru.donmai.us/data/a.jpg",
		"https://media.donmai.us/a.webp",
		"https://donmai.us/a.jpg",
	}
	for _, raw := range allowed {
		if !IsAllowedAnimaImageURL(raw) {
			t.Fatalf("expected allowed: %s", raw)
		}
	}

	denied := []string{
		"http://cdn.donmai.us/a.jpg",
		"https://evil.example/a.jpg",
		"https://cdn.donmai.us.evil.example/a.jpg",
		"https://127.0.0.1/a.jpg",
		"file:///etc/passwd",
		"",
	}
	for _, raw := range denied {
		if IsAllowedAnimaImageURL(raw) {
			t.Fatalf("expected denied: %s", raw)
		}
	}
}

func TestHandleAnimaImageRejectsBadInput(t *testing.T) {
	store := &Stores{}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, AnimaImageRoute+"?url=https%3A%2F%2Fcdn.donmai.us%2Fa.jpg", nil)
	store.HandleAnimaImage(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, AnimaImageRoute+"?url=http%3A%2F%2Fcdn.donmai.us%2Fa.jpg", nil)
	store.HandleAnimaImage(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("http url status = %d, want 400", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, AnimaImageRoute+"?url=https%3A%2F%2Fevil.example%2Fa.jpg", nil)
	store.HandleAnimaImage(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("foreign host status = %d, want 400", rec.Code)
	}
}
