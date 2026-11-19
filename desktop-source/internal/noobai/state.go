package noobai

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const (
	recentMax = 12
	favMax    = 400
)

// State 是跨工作流需要一致的全局状态（启用服装、单件覆盖、收藏与最近使用）。
type State struct {
	ActiveOutfit    string                 `json:"active_outfit"`
	Overrides       map[string]string      `json:"overrides"`
	CharFavorites   []string               `json:"char_favorites"`
	ArtistFavorites []string               `json:"artist_favorites"`
	OutfitFavorites []string               `json:"outfit_favorites"`
	SceneFavorites  []string               `json:"scene_favorites"`
	RecentChars     []string               `json:"recent_chars"`
	RecentArtists   []string               `json:"recent_artists"`
	RecentOutfits   []string               `json:"recent_outfits"`
	RecentScenes    []string               `json:"recent_scenes"`
	UI              map[string]interface{} `json:"ui"`
}

func DefaultState() State {
	return State{
		Overrides:       map[string]string{"top": "", "bottom": ""},
		CharFavorites:   []string{},
		ArtistFavorites: []string{},
		OutfitFavorites: []string{},
		SceneFavorites:  []string{},
		RecentChars:     []string{},
		RecentArtists:   []string{},
		RecentOutfits:   []string{},
		RecentScenes:    []string{},
		UI:              map[string]interface{}{},
	}
}

func (s State) clone() State {
	out := s
	out.Overrides = map[string]string{"top": "", "bottom": ""}
	for key, value := range s.Overrides {
		out.Overrides[key] = value
	}
	out.CharFavorites = append([]string{}, s.CharFavorites...)
	out.ArtistFavorites = append([]string{}, s.ArtistFavorites...)
	out.OutfitFavorites = append([]string{}, s.OutfitFavorites...)
	out.SceneFavorites = append([]string{}, s.SceneFavorites...)
	out.RecentChars = append([]string{}, s.RecentChars...)
	out.RecentArtists = append([]string{}, s.RecentArtists...)
	out.RecentOutfits = append([]string{}, s.RecentOutfits...)
	out.RecentScenes = append([]string{}, s.RecentScenes...)
	out.UI = map[string]interface{}{}
	for key, value := range s.UI {
		out.UI[key] = value
	}
	return out
}

func coerceState(raw []byte) State {
	state := DefaultState()
	if len(raw) == 0 {
		return state
	}
	var stored State
	if err := json.Unmarshal(raw, &stored); err != nil {
		return state
	}
	state.ActiveOutfit = stored.ActiveOutfit
	if stored.Overrides != nil {
		state.Overrides["top"] = stored.Overrides["top"]
		state.Overrides["bottom"] = stored.Overrides["bottom"]
	}
	state.CharFavorites = limitList(stored.CharFavorites, favMax)
	state.ArtistFavorites = limitList(stored.ArtistFavorites, favMax)
	state.OutfitFavorites = limitList(stored.OutfitFavorites, favMax)
	state.SceneFavorites = limitList(stored.SceneFavorites, favMax)
	state.RecentChars = limitList(stored.RecentChars, recentMax)
	state.RecentArtists = limitList(stored.RecentArtists, recentMax)
	state.RecentOutfits = limitList(stored.RecentOutfits, recentMax)
	state.RecentScenes = limitList(stored.RecentScenes, recentMax)
	if stored.UI != nil {
		state.UI = stored.UI
	}
	return state
}

func limitList(items []string, limit int) []string {
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
		if len(out) >= limit {
			break
		}
	}
	return out
}

func loadState(path string) State {
	raw, err := os.ReadFile(path)
	if err != nil {
		return DefaultState()
	}
	return coerceState(raw)
}

func saveState(path string, state State) error {
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, raw)
}

func writeAtomic(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0644); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// ── 面板设置（替代 ComfyUI 节点控件） ──────────────────────────────────
type Settings struct {
	NsfwLevel        string  `json:"nsfw_level"`
	Seed             int     `json:"seed"`
	TagCap           string  `json:"tag_cap"`
	BaseProb         float64 `json:"base_prob"`
	QualityProfile   string  `json:"quality_profile"`
	ExtraBody        string  `json:"extra_body"`
	OutfitStyle      string  `json:"outfit_style"`
	AppearanceFollow bool    `json:"appearance_follow"`
	RolePick         bool    `json:"role_pick"`
	ScenePick        bool    `json:"scene_pick"`
	PickPoolMode     string  `json:"pick_pool_mode"`
	PickPoolIDs      string  `json:"pick_pool_ids"`
	AppearanceMode   string  `json:"appearance_mode"`
	NegativeProfile  string  `json:"negative_profile"`
	NegativeExtra    string  `json:"negative_extra"`
	RatingTag        bool    `json:"rating_tag"`
	OutfitProb       int     `json:"outfit_prob"`
	AvoidRepeat      bool    `json:"avoid_repeat"`
	ArtistPick       bool    `json:"artist_pick"`
	ArtistStyle      string  `json:"artist_style"`
	SelectedArtists  string  `json:"selected_artists"`
	ForceArtist      string  `json:"force_artist"`
	ArtistScope      string  `json:"artist_scope"`
	SelectedRoles    string  `json:"selected_roles"`
	WeightsJSON      string  `json:"weights_json"`
	LockFields       string  `json:"lock_fields"`
	DisabledSections string  `json:"disabled_sections"`
}

func DefaultSettings() Settings {
	return Settings{
		NsfwLevel:        "sfw",
		Seed:             -1,
		TagCap:           "自动",
		BaseProb:         0.6,
		QualityProfile:   "NoobAI 标准",
		OutfitStyle:      "随机",
		ArtistStyle:      "随机",
		ArtistScope:      "curated",
		AppearanceFollow: true,
		AppearanceMode:   "完整核心",
		NegativeProfile:  "自动（按档位）",
		RatingTag:        true,
		OutfitProb:       60,
	}
}

func loadSettings(path string) Settings {
	settings := DefaultSettings()
	raw, err := os.ReadFile(path)
	if err != nil {
		return settings
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return DefaultSettings()
	}
	return normalizeSettings(settings)
}

func normalizeSettings(settings Settings) Settings {
	defaults := DefaultSettings()
	if _, ok := LevelNum[settings.NsfwLevel]; !ok {
		settings.NsfwLevel = defaults.NsfwLevel
	}
	if settings.TagCap == "" {
		settings.TagCap = defaults.TagCap
	}
	if settings.BaseProb < 0 {
		settings.BaseProb = 0
	}
	if settings.BaseProb > 1 {
		settings.BaseProb = 1
	}
	if settings.QualityProfile == "" {
		settings.QualityProfile = defaults.QualityProfile
	}
	if settings.OutfitStyle == "" {
		settings.OutfitStyle = defaults.OutfitStyle
	}
	if settings.ArtistStyle == "" {
		settings.ArtistStyle = defaults.ArtistStyle
	}
	if settings.ArtistScope == "" {
		settings.ArtistScope = defaults.ArtistScope
	}
	if settings.AppearanceMode == "" {
		settings.AppearanceMode = defaults.AppearanceMode
	}
	if settings.NegativeProfile == "" {
		settings.NegativeProfile = defaults.NegativeProfile
	}
	if settings.OutfitProb < 0 {
		settings.OutfitProb = 0
	}
	if settings.OutfitProb > 100 {
		settings.OutfitProb = 100
	}
	return settings
}

func saveSettings(path string, settings Settings) error {
	raw, err := json.MarshalIndent(normalizeSettings(settings), "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, raw)
}
