package noobai

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var artistThumbIDRe = regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)

// Server 是 NoobAI 抽取模块。
type Server struct {
	assets   fs.FS
	dataRoot string
	ds       *Dataset
	engine   *Engine

	settingsPath string
	settingsMu   sync.Mutex
	settings     Settings

	comfy           *comfyClient
	imageManagerURL string
	progress        *progressTracker

	genSettingsPath string
	genMu           sync.Mutex
	genSettings     GenerationSettings
	genOptionsMu    sync.Mutex
	genOptions      genOptions
	genOptionsAt    time.Time
	loraMetaMu      sync.Mutex
	loraMetaCache   []LoraMeta
	loraMetaAt      time.Time
	loraWordsMu     sync.Mutex
	loraWordsCache  map[string][]string
	genJob          genJob
	genStop         bool
}

// New 加载词库并创建模块。dataRoot 用于持久化用户状态与面板设置。
func New(assets fs.FS, dataRoot string, comfyURL, imageManagerURL string) (*Server, error) {
	ds, err := loadDataset(assets)
	if err != nil {
		return nil, err
	}
	statePath := filepath.Join(dataRoot, "noobai-state.json")
	state := loadState(statePath)
	settingsPath := filepath.Join(dataRoot, "noobai-settings.json")
	genPath := filepath.Join(dataRoot, "noobai-generation.json")
	server := &Server{
		assets:          assets,
		dataRoot:        dataRoot,
		ds:              ds,
		settingsPath:    settingsPath,
		settings:        loadSettings(settingsPath),
		imageManagerURL: imageManagerURL,
		genSettingsPath: genPath,
		genSettings:     loadGenerationSettings(genPath),
		genJob:          genJob{Status: "idle", Images: []GenImage{}},
	}
	if strings.TrimSpace(comfyURL) != "" {
		server.comfy = newComfyClient(comfyURL)
		server.startProgressWatcher()
	}
	server.engine = NewEngine(ds, state, func(next State) error {
		return saveState(statePath, next)
	})
	return server, nil
}

// Info 供壳首页与后台展示。
func (s *Server) Info() map[string]interface{} {
	totalOptions := 0
	for _, section := range s.ds.Sections {
		for _, field := range section.Fields {
			totalOptions += len(field.Opts)
		}
	}
	return map[string]interface{}{
		"version":      Version,
		"sections":     len(s.ds.Sections),
		"options":      totalOptions,
		"characters":   len(s.ds.Characters),
		"index":        s.ds.IndexCount,
		"artists":      len(s.ds.Artists),
		"artist_index": s.ds.ArtistIndexCount,
		"outfits":      len(s.ds.Outfits),
		"scenes":       len(s.ds.Scenes),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/pools", s.handlePools)
	mux.HandleFunc("/api/characters", s.handleCharacters)
	mux.HandleFunc("/api/character_search", s.handleCharacterSearch)
	mux.HandleFunc("/api/artists", s.handleArtists)
	mux.HandleFunc("/api/artist_search", s.handleArtistSearch)
	mux.HandleFunc("/api/artist_random", s.handleArtistRandom)
	mux.HandleFunc("/api/artist_thumb", s.handleArtistThumb)
	mux.HandleFunc("/api/outfits", s.handleOutfits)
	mux.HandleFunc("/api/scenes", s.handleScenes)
	mux.HandleFunc("/api/state", s.handleState)
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/roll", s.handleRoll)
	mux.HandleFunc("/api/assemble", s.handleAssemble)
	mux.HandleFunc("/api/gen/options", s.handleGenOptions)
	mux.HandleFunc("/api/gen/loras", s.handleGenLoras)
	mux.HandleFunc("/api/gen/lora-preview", s.handleGenLoraPreview)
	mux.HandleFunc("/api/gen/lora-words", s.handleGenLoraWords)
	mux.HandleFunc("/api/gen/settings", s.handleGenSettings)
	mux.HandleFunc("/api/gen/start", s.handleGenStart)
	mux.HandleFunc("/api/gen/job", s.handleGenJob)
	mux.HandleFunc("/api/gen/interrupt", s.handleGenInterrupt)
	mux.HandleFunc("/api/gen/image", s.handleGenImage)
	mux.HandleFunc("/api/gen/open-images", s.handleGenOpenImages)
	mux.HandleFunc("/theme.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, themeJS)
	})
	mux.HandleFunc("/__comfy/wallpaper", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	payload := s.ds.healthPayload()
	payload["_meta"] = map[string]interface{}{
		"settings": s.currentSettings(),
	}
	writeJSON(w, payload)
}

func (s *Server) handlePools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ds.poolsPayload())
}

func (s *Server) handleCharacters(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ds.charactersPayload())
}

func (s *Server) handleCharacterSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	work := r.URL.Query().Get("work")
	limit := 80
	offset := 0
	if value := r.URL.Query().Get("limit"); value != "" {
		limit = atoi(value, 80)
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		offset = atoi(value, 0)
	}
	writeJSON(w, s.ds.searchCharacters(query, work, limit, offset))
}

func (s *Server) handleArtists(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ds.artistsPayload())
}

func (s *Server) handleArtistSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	style := r.URL.Query().Get("style")
	sort := r.URL.Query().Get("sort")
	scope := r.URL.Query().Get("scope")
	limit := 80
	offset := 0
	if value := r.URL.Query().Get("limit"); value != "" {
		limit = atoi(value, 80)
	}
	if value := r.URL.Query().Get("offset"); value != "" {
		offset = atoi(value, 0)
	}
	writeJSON(w, s.ds.searchArtists(q, style, sort, scope, limit, offset))
}

func (s *Server) handleArtistRandom(w http.ResponseWriter, r *http.Request) {
	scope := r.URL.Query().Get("scope")
	style := r.URL.Query().Get("style")
	a := s.ds.randomArtist(scope, style)
	if a == nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "未找到符合条件的画师"})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "artist": a})
}

func (s *Server) handleArtistThumb(w http.ResponseWriter, r *http.Request) {
	aid := strings.TrimSpace(r.URL.Query().Get("id"))
	variant := strings.TrimSpace(r.URL.Query().Get("v"))
	if aid == "" || !artistThumbIDRe.MatchString(aid) {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}
	if variant != "p2" {
		variant = "p1"
	}
	filename := fmt.Sprintf("%s-%s.webp", aid, variant)
	assetPath := path.Join("presets", "artist_thumbs", filename)

	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")

	// 1. Embedded asset
	if raw, err := fs.ReadFile(s.assets, assetPath); err == nil && len(raw) > 0 {
		_, _ = w.Write(raw)
		return
	}

	// 2. Disk cache
	diskDir := filepath.Join(s.dataRoot, "artist_thumbs")
	diskPath := filepath.Join(diskDir, filename)
	if info, err := os.Stat(diskPath); err == nil && info.Size() > 500 {
		http.ServeFile(w, r, diskPath)
		return
	}

	// 3. Fallback CDN
	_ = os.MkdirAll(diskDir, 0755)
	commit := "1c4bf5bde9acba5b54396f0bdc9807f09b68bf9c"
	urls := []string{
		fmt.Sprintf("https://cdn.jsdelivr.net/gh/nregret/AnimaTags-DB@%s/images/artist/%s", commit, filename),
		fmt.Sprintf("https://raw.githubusercontent.com/nregret/AnimaTags-DB/%s/images/artist/%s", commit, filename),
	}
	client := &http.Client{Timeout: 10 * time.Second}
	for _, u := range urls {
		resp, err := client.Get(u)
		if err == nil && resp.StatusCode == http.StatusOK {
			data, readErr := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if readErr == nil && len(data) > 500 {
				_ = os.WriteFile(diskPath, data, 0644)
				_, _ = w.Write(data)
				return
			}
		}
		if resp != nil {
			_ = resp.Body.Close()
		}
	}

	http.Error(w, "Not Found", http.StatusNotFound)
}

func (s *Server) handleOutfits(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ds.outfitsPayload(s.engine.State()))
}

func (s *Server) handleScenes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.ds.scenesPayload())
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]interface{}{"ok": true, "state": s.engine.State()})
	case http.MethodPost:
		var patch map[string]interface{}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&patch); err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
			return
		}
		state, err := s.engine.UpdateState(patch)
		if err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]interface{}{
			"ok":      true,
			"state":   state,
			"outfits": s.ds.outfitsPayload(state),
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) currentSettings() Settings {
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	return s.settings
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, map[string]interface{}{"ok": true, "settings": s.currentSettings()})
	case http.MethodPost:
		var incoming Settings
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&incoming); err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
			return
		}
		incoming = normalizeSettings(incoming)
		s.settingsMu.Lock()
		s.settings = incoming
		s.settingsMu.Unlock()
		if err := saveSettings(s.settingsPath, incoming); err != nil {
			writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, map[string]interface{}{"ok": true, "settings": incoming})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// rollParams 把面板设置作为默认值，再用请求体覆盖。
func (s *Server) rollParams(body map[string]interface{}) map[string]interface{} {
	settings := s.currentSettings()
	params := map[string]interface{}{
		"nsfw_level":        settings.NsfwLevel,
		"seed":              settings.Seed,
		"tag_cap":           settings.TagCap,
		"base_prob":         settings.BaseProb,
		"quality_profile":   settings.QualityProfile,
		"extra_body":        settings.ExtraBody,
		"outfit_style":      settings.OutfitStyle,
		"artist_style":      settings.ArtistStyle,
		"artist_pick":       settings.ArtistPick,
		"selected_artists":  settings.SelectedArtists,
		"force_artist":      settings.ForceArtist,
		"artist_scope":      settings.ArtistScope,
		"appearance_follow": settings.AppearanceFollow,
		"role_pick":         settings.RolePick,
		"scene_pick":        settings.ScenePick,
		"pick_pool_mode":    settings.PickPoolMode,
		"pick_pool_ids":     settings.PickPoolIDs,
		"appearance_mode":   settings.AppearanceMode,
		"negative_profile":  settings.NegativeProfile,
		"negative_extra":    settings.NegativeExtra,
		"rating_tag":        settings.RatingTag,
		"outfit_prob":       settings.OutfitProb,
		"avoid_repeat":      settings.AvoidRepeat,
		"selected_roles":    settings.SelectedRoles,
		"weights_json":      settings.WeightsJSON,
		"lock_fields":       settings.LockFields,
		"disabled_sections": settings.DisabledSections,
	}
	for key, value := range body {
		params[key] = value
	}
	return params
}

func (s *Server) handleRoll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body map[string]interface{}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&body); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
		return
	}
	result := s.engine.Roll(s.rollParams(body))
	payload := map[string]interface{}{"ok": true}
	for key, value := range result {
		payload[key] = value
	}
	writeJSON(w, payload)
}

func (s *Server) handleAssemble(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Main       string `json:"main"`
		Supplement string `json:"supplement"`
		Mode       string `json:"mode"`
		MaxLevel   string `json:"max_level"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&body); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "请求格式无效: " + err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{
		"ok":   true,
		"text": s.engine.Assemble(body.Main, body.Supplement, body.Mode, body.MaxLevel),
	})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	reqPath := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))
	rel := strings.TrimPrefix(reqPath, "/")
	if rel == "" {
		rel = "index.html"
	}
	if rel == "presets" || strings.HasPrefix(rel, "presets/") {
		http.NotFound(w, r)
		return
	}
	content, err := fs.ReadFile(s.assets, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := strings.ToLower(path.Ext(rel))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		switch ext {
		case ".js":
			contentType = "application/javascript; charset=utf-8"
		case ".css":
			contentType = "text/css; charset=utf-8"
		case ".html":
			contentType = "text/html; charset=utf-8"
		default:
			contentType = "application/octet-stream"
		}
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(content)
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(payload)
}

func atoi(value string, fallback int) int {
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil {
		return fallback
	}
	return parsed
}

// themeJS 与壳的深浅主题 / 壁纸桥接；token 用于整窗主题切换动画对齐。
const themeJS = `(function () {
  if (window.__noobaiThemeBridge) return;
  window.__noobaiThemeBridge = true;
  var html = document.documentElement;

  function readInitial() {
    var match = /[?&]theme=(light|dark)/.exec(location.search);
    return match ? match[1] : 'dark';
  }
  function apply(theme) {
    var value = theme === 'light' ? 'light' : 'dark';
    html.dataset.theme = value;
    html.style.colorScheme = value;
  }
  function applyWallpaper(config) {
    if (!config || !config.enabled || !config.url) {
      html.dataset.comfyWallpaper = 'off';
      ['--comfy-wp-image', '--comfy-wp-fit', '--comfy-wp-dim', '--comfy-wp-blur'].forEach(function (name) {
        html.style.removeProperty(name);
      });
      return;
    }
    html.dataset.comfyWallpaper = 'on';
    html.style.setProperty('--comfy-wp-image', 'url("' + config.url + '")');
    html.style.setProperty('--comfy-wp-fit', config.fit === 'contain' ? 'contain' : 'cover');
    html.style.setProperty('--comfy-wp-dim', String(Math.max(0, Math.min(1, Number(config.dim) || 0))));
    html.style.setProperty('--comfy-wp-blur', config.blur ? '12px' : '0px');
  }
  function ack(token) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          window.parent.postMessage({ type: 'comfy-theme-applied', token: token }, '*');
        } catch (error) { /* 忽略 */ }
        setTimeout(function () { html.classList.remove('comfy-theme-snapshot'); }, 120);
      });
    });
  }

  apply(readInitial());

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data) return;
    if (data.type === 'comfy-theme') {
      if (data.token) html.classList.add('comfy-theme-snapshot');
      apply(data.theme);
      if (data.token) ack(data.token);
    }
    if (data.type === 'comfy-wallpaper') applyWallpaper(data.config);
  });
})();`
