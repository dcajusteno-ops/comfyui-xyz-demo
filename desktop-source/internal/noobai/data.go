// Package noobai 把 NoobAI_lib 提示词随机生成器整合为 Comfy Studio 的独立模块：
// 词库权重、角色 / 服装 / 场景库、档位抽取、画质与负向词、词库字典。
//
// 数据与交互沿用 NoobAI_lib v1.4（GPL-3.0），引擎用 Go 重写，运行时零联网。
package noobai

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"math/rand"
	"sort"
	"strings"
	"sync"

	"golang.org/x/text/encoding/simplifiedchinese"
)

//go:embed all:assets
var embeddedAssets embed.FS

// EmbeddedFS 返回嵌入的 assets 目录子文件系统。
func EmbeddedFS() (fs.FS, error) {
	return fs.Sub(embeddedAssets, "assets")
}

const Version = "1.4.0"

// ── 档位 ────────────────────────────────────────────────────────────────
var LevelChoices = []string{"sfw", "suggestive", "explicit", "hardcore", "extreme", "any"}

var LevelNum = map[string]int{
	"sfw": 0, "suggestive": 1, "explicit": 2, "hardcore": 3, "extreme": 4, "any": 99,
}

var LevelLabels = map[int]string{0: "全年龄", 1: "暗示", 2: "成人", 3: "硬核", 4: "极限", 99: "不限"}

var TagCapChoices = []string{"自动", "24", "32", "40", "48", "56", "64", "80"}

// qualityProfile 保序的画质预设，前端直接按顺序渲染。
type qualityProfile struct {
	Name string `json:"name"`
	Tags string `json:"tags"`
}

var QualityProfiles = []qualityProfile{
	{"NoobAI 标准", "masterpiece, best quality, very aesthetic, absurdres"},
	{"NoobAI 精细", "masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest"},
	{"Illustrious 标准", "masterpiece, best quality, amazing quality, very aesthetic, absurdres"},
	{"新番动画 (Modern Anime)", "masterpiece, best quality, very aesthetic, absurdres, anime screencap, vibrant colors, clean lineart, sharp focus"},
	{"胶片厚涂 (Film & Impasto)", "masterpiece, best quality, very aesthetic, absurdres, oil painting (medium), impasto, rich texture, film grain, cinematic lighting"},
	{"90年代复古日漫 (90s Retro)", "masterpiece, best quality, very aesthetic, 1990s (style), retro anime, cel shading, vintage color, soft chromatic aberration"},
	{"黑白精细漫画 (Detailed Manga)", "masterpiece, best quality, very aesthetic, absurdres, manga, monochrome, comic, screentone, fine lineart, detailed hatching"},
	{"赛博霓虹 (Cyberpunk Neon)", "masterpiece, best quality, very aesthetic, absurdres, cyberpunk, neon lighting, rim light, volumetric lighting, futuristic, glowing edges"},
	{"柔光梦幻 (Ethereal Dreamy)", "masterpiece, best quality, very aesthetic, absurdres, dreamlike, soft light, pastel colors, soft bloom, light particles, ethereal atmosphere"},
	{"NoobAI V-Pred", "masterpiece, best quality, newest, absurdres, highres, safe"},
	{"WAI Illustrious", "masterpiece, best quality, amazing quality"},
	{"极简", "best quality"},
	{"不加画质串", ""},
}

func qualityTags(name string) (string, bool) {
	for _, profile := range QualityProfiles {
		if profile.Name == name {
			return profile.Tags, true
		}
	}
	return "", false
}

var OutfitStyles = []string{
	"随机", "不限", "日常", "校园", "职业", "传统", "礼服",
	"居家", "泳装", "战斗", "主题扮演", "丝袜", "运动", "哥特", "NSFW",
}

var StyleCat = map[string]string{
	"日常": "casual", "校园": "school", "职业": "office", "传统": "traditional",
	"礼服": "formal", "居家": "home", "泳装": "swim", "战斗": "combat",
	"主题扮演": "cosplay", "丝袜": "hosiery", "运动": "sport", "哥特": "gothic",
	"NSFW": "nsfw_outfit",
}

var SectionOrder = []string{
	"quality", "count", "artist", "hair", "face", "body", "makeup",
	"outfit", "outfit_nsfw", "pose", "pose_nsfw",
	"scene", "lighting", "camera", "style",
}

var PoolFiles = []string{
	"pools_appearance.json", "pools_outfit.json",
	"pools_pose_scene.json", "pools_camera_style.json",
}

const (
	CharacterFile      = "characters.json"
	CharacterIndexFile = "characters_index.json"
	OutfitFile         = "outfits.json"
	SceneFile          = "scenes.json"
	ArtistFile         = "artists.json"
	ArtistIndexFile    = "artists_index.json"
)

var ArtistStyles = []string{
	"随机", "不限", "唯美厚涂", "二次元萌系", "轻小说插画", "赛博机械", "经典复古", "水彩梦幻",
}

// ── 数据类型 ────────────────────────────────────────────────────────────
type Option struct {
	Zh    string
	Tags  string
	Level int
}

func (o *Option) UnmarshalJSON(raw []byte) error {
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return err
	}
	if len(arr) > 0 {
		_ = json.Unmarshal(arr[0], &o.Zh)
	}
	if len(arr) > 1 {
		_ = json.Unmarshal(arr[1], &o.Tags)
	}
	if len(arr) > 2 {
		_ = json.Unmarshal(arr[2], &o.Level)
	}
	return nil
}

func (o Option) MarshalJSON() ([]byte, error) {
	return json.Marshal([]interface{}{o.Zh, o.Tags, o.Level})
}

type Field struct {
	Key  string   `json:"key"`
	Lab  string   `json:"lab"`
	Type string   `json:"type"`
	Req  bool     `json:"req"`
	Prob float64  `json:"prob"`
	Slot string   `json:"slot"`
	Min  int      `json:"min"`
	Max  int      `json:"max"`
	Opts []Option `json:"opts"`
}

type Section struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	Name   string  `json:"name,omitempty"`
	Floor  int     `json:"floor"`
	Weight float64 `json:"weight"`
	Fields []Field `json:"fields"`
	Order  int     `json:"-"`
}

type Character struct {
	Tag        string   `json:"tag"`
	Zh         string   `json:"zh"`
	Work       string   `json:"work"`
	WorkZh     string   `json:"work_zh"`
	Level      int      `json:"level"`
	Appearance []string `json:"appearance"`
	Outfit     []string `json:"outfit"`
	Core       string   `json:"core"`
	PinyinAbbr string   `json:"pinyin_abbr,omitempty"`
	Aliases    []string `json:"aliases,omitempty"`
}

type Outfit struct {
	ID    string            `json:"id"`
	Zh    string            `json:"zh"`
	Cat   string            `json:"cat"`
	Level int               `json:"level"`
	Tags  map[string]string `json:"tags"`
}

type Scene struct {
	ID    string            `json:"id"`
	Zh    string            `json:"zh"`
	Group string            `json:"group"`
	Level int               `json:"level"`
	Tags  map[string]string `json:"tags"`
	Extra string            `json:"extra"`
}

type Category struct {
	ID string `json:"id"`
	Zh string `json:"zh"`
}

type Group struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Desc  string `json:"desc,omitempty"`
}

type WorkItem struct {
	Work   string `json:"work"`
	WorkZh string `json:"work_zh"`
	Count  int    `json:"count"`
}

type searchRow struct {
	blob string
	char *Character
}

type Artist struct {
	Tag        string   `json:"tag"`
	Zh         string   `json:"zh,omitempty"`
	Style      string   `json:"style,omitempty"`
	Desc       string   `json:"desc,omitempty"`
	PostCount  int      `json:"post_count,omitempty"`
	ID         string   `json:"id,omitempty"`
	PinyinAbbr string   `json:"pinyin_abbr,omitempty"`
	Aliases    []string `json:"aliases,omitempty"`
	Curated    bool     `json:"curated,omitempty"`
	HasThumb   bool     `json:"has_thumb,omitempty"`
}

type artistSearchRow struct {
	blob    string
	tokens  []string
	artist  *Artist
	curated bool
}

// Dataset 是启动时加载的只读词库。
type Dataset struct {
	Sections []Section

	Characters []Character
	Works      []WorkItem

	IndexRows   []*Character
	IndexByTag  map[string]*Character
	IndexBase   map[string]*Character
	IndexSearch []searchRow
	IndexCount  int

	Artists            []Artist
	ArtistStyles       []string
	ArtistIndexRows    []*Artist
	ArtistIndexByTag   map[string]*Artist
	ArtistSearch       []artistSearchRow
	ArtistCount        int
	ArtistIndexCount   int
	ArtistCuratedCount int
	ArtistThumbs       map[string]bool

	Outfits     []Outfit
	OutfitCats  []Category
	Scenes      []Scene
	SceneGroups []Group

	TagLevels  map[string]int
	TagFields  map[string]map[string]bool
	HairColors map[string]bool
	hairLength map[string]bool
}

type poolsFile struct {
	Sections []Section `json:"sections"`
}

type charactersFile struct {
	Characters []Character `json:"characters"`
}

type artistsFile struct {
	Artists    []Artist `json:"artists"`
	Styles     []string `json:"styles"`
	Count      int      `json:"count"`
	TotalIndex int      `json:"total_index"`
}

type artistIndexFile struct {
	Count   int      `json:"count"`
	Artists []Artist `json:"artists"`
}

type outfitsMeta struct {
	Categories []Category `json:"categories"`
}

type scenesFile struct {
	Scenes []Scene `json:"scenes"`
	Groups []Group `json:"groups"`
}

type indexFile struct {
	Characters []Character `json:"characters"`
}

// loadDataset 读取并索引 presets/*.json。
func loadDataset(fsys fs.FS) (*Dataset, error) {
	ds := &Dataset{
		IndexByTag:       map[string]*Character{},
		IndexBase:        map[string]*Character{},
		ArtistIndexByTag: map[string]*Artist{},
		ArtistThumbs:     map[string]bool{},
		TagLevels:        map[string]int{},
		TagFields:        map[string]map[string]bool{},
		HairColors:       map[string]bool{},
		hairLength:       map[string]bool{},
		OutfitCats:       []Category{},
		SceneGroups:      []Group{},
	}

	for _, name := range PoolFiles {
		raw, err := fs.ReadFile(fsys, "presets/"+name)
		if err != nil {
			return nil, fmt.Errorf("读取词库 %s 失败: %w", name, err)
		}
		var file poolsFile
		if err := json.Unmarshal(raw, &file); err != nil {
			return nil, fmt.Errorf("解析词库 %s 失败: %w", name, err)
		}
		for _, section := range file.Sections {
			if section.Weight == 0 {
				section.Weight = 1
			}
			ds.Sections = append(ds.Sections, section)
		}
	}
	order := map[string]int{}
	for index, id := range SectionOrder {
		order[id] = index
	}
	sort.SliceStable(ds.Sections, func(i, j int) bool {
		return order[ds.Sections[i].ID] < order[ds.Sections[j].ID]
	})
	for index := range ds.Sections {
		ds.Sections[index].Order = index
		if ds.Sections[index].Name == "" {
			ds.Sections[index].Name = ds.Sections[index].Title
		}
	}

	raw, err := fs.ReadFile(fsys, "presets/"+CharacterFile)
	if err != nil {
		return nil, fmt.Errorf("读取角色库失败: %w", err)
	}
	var chars charactersFile
	if err := json.Unmarshal(raw, &chars); err != nil {
		return nil, fmt.Errorf("解析角色库失败: %w", err)
	}
	works := map[string]*WorkItem{}
	for _, char := range chars.Characters {
		if strings.TrimSpace(char.Tag) == "" {
			continue
		}
		char.Tag = normTag(char.Tag)
		char.PinyinAbbr = pinyinInitials(char.Zh)
		char.Aliases = characterAliases(char.Tag, char.Zh)
		ds.Characters = append(ds.Characters, char)
		if char.Work == "" {
			continue
		}
		item := works[char.Work]
		if item == nil {
			workZh := char.WorkZh
			if workZh == "" {
				workZh = char.Work
			}
			item = &WorkItem{Work: char.Work, WorkZh: workZh}
			works[char.Work] = item
		}
		item.Count++
	}
	for _, item := range works {
		ds.Works = append(ds.Works, *item)
	}
	sort.Slice(ds.Works, func(i, j int) bool {
		if ds.Works[i].Count != ds.Works[j].Count {
			return ds.Works[i].Count > ds.Works[j].Count
		}
		return ds.Works[i].Work < ds.Works[j].Work
	})

	raw, err = fs.ReadFile(fsys, "presets/"+OutfitFile)
	if err != nil {
		return nil, fmt.Errorf("读取服装库失败: %w", err)
	}
	var outfitRaw struct {
		Outfits []Outfit    `json:"outfits"`
		Meta    outfitsMeta `json:"_meta"`
	}
	if err := json.Unmarshal(raw, &outfitRaw); err != nil {
		return nil, fmt.Errorf("解析服装库失败: %w", err)
	}
	ds.Outfits = outfitRaw.Outfits
	ds.OutfitCats = outfitRaw.Meta.Categories

	raw, err = fs.ReadFile(fsys, "presets/"+SceneFile)
	if err != nil {
		return nil, fmt.Errorf("读取场景库失败: %w", err)
	}
	var scenes scenesFile
	if err := json.Unmarshal(raw, &scenes); err != nil {
		return nil, fmt.Errorf("解析场景库失败: %w", err)
	}
	ds.Scenes = scenes.Scenes
	ds.SceneGroups = scenes.Groups

	ds.buildTagIndexes()

	raw, err = fs.ReadFile(fsys, "presets/"+CharacterIndexFile)
	if err != nil {
		return nil, fmt.Errorf("读取全量角色索引失败: %w", err)
	}
	var index indexFile
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, fmt.Errorf("解析全量角色索引失败: %w", err)
	}
	ds.buildCharacterIndex(index.Characters)

	if entries, err := fs.ReadDir(fsys, "presets/artist_thumbs"); err == nil {
		for _, e := range entries {
			name := e.Name()
			if strings.HasSuffix(name, "-p1.webp") {
				aid := strings.TrimSuffix(name, "-p1.webp")
				ds.ArtistThumbs[aid] = true
			}
		}
	}

	raw, err = fs.ReadFile(fsys, "presets/"+ArtistFile)
	if err == nil {
		var artists artistsFile
		if err := json.Unmarshal(raw, &artists); err == nil {
			ds.Artists = artists.Artists
			if len(artists.Styles) > 0 {
				ds.ArtistStyles = artists.Styles
			} else {
				ds.ArtistStyles = ArtistStyles[2:]
			}
		}
	}

	var artistIndex artistIndexFile
	raw, err = fs.ReadFile(fsys, "presets/"+ArtistIndexFile)
	if err == nil {
		_ = json.Unmarshal(raw, &artistIndex)
	}
	ds.buildArtistIndex(artistIndex.Artists)

	return ds, nil
}

func isCoreField(key string) bool {
	return coreFieldKeys[key]
}

func (ds *Dataset) buildTagIndexes() {
	for _, section := range ds.Sections {
		for _, field := range section.Fields {
			for _, option := range field.Opts {
				tags := splitTags(option.Tags)
				for _, tag := range tags {
					if level, ok := ds.TagLevels[tag]; !ok || option.Level > level {
						ds.TagLevels[tag] = option.Level
					}
					if isCoreField(field.Key) {
						key := field.Key
						if field.Key == "hair.length" && styleishRe.MatchString(tag) {
							key = "hair.style"
						}
						if ds.TagFields[tag] == nil {
							ds.TagFields[tag] = map[string]bool{}
						}
						ds.TagFields[tag][key] = true
					}
				}
				if field.Key == "hair.color" {
					for _, tag := range tags {
						ds.HairColors[tag] = true
					}
				}
				if field.Key == "hair.length" {
					for _, tag := range tags {
						ds.hairLength[tag] = true
					}
				}
			}
		}
	}
	for _, char := range ds.Characters {
		values := append([]string{char.Tag}, char.Appearance...)
		values = append(values, char.Outfit...)
		for _, value := range values {
			for _, tag := range splitTags(value) {
				if _, ok := ds.TagLevels[tag]; !ok {
					ds.TagLevels[tag] = char.Level
				}
			}
		}
		if char.Work != "" {
			for _, tag := range splitTags(char.Work) {
				if _, ok := ds.TagLevels[tag]; !ok {
					ds.TagLevels[tag] = 0
				}
			}
		}
	}
	for _, outfit := range ds.Outfits {
		for _, value := range outfit.Tags {
			for _, tag := range splitTags(value) {
				if _, ok := ds.TagLevels[tag]; !ok {
					ds.TagLevels[tag] = outfit.Level
				}
			}
		}
	}
	for _, scene := range ds.Scenes {
		for _, value := range scene.Tags {
			for _, tag := range splitTags(value) {
				if _, ok := ds.TagLevels[tag]; !ok {
					ds.TagLevels[tag] = scene.Level
				}
			}
		}
		for _, tag := range splitTags(scene.Extra) {
			if _, ok := ds.TagLevels[tag]; !ok {
				ds.TagLevels[tag] = scene.Level
			}
		}
	}
}

func (ds *Dataset) buildCharacterIndex(rows []Character) {
	byTag := map[string]*Character{}
	baseHits := map[string][]*Character{}
	var search []searchRow

	addRow := func(char Character) {
		tag := normTag(char.Tag)
		if tag == "" {
			return
		}
		if _, exists := byTag[tag]; exists {
			return
		}
		char.Tag = tag
		if char.PinyinAbbr == "" {
			char.PinyinAbbr = pinyinInitials(char.Zh)
		}
		if char.Aliases == nil {
			char.Aliases = characterAliases(tag, char.Zh)
		}
		stored := char
		ptr := &stored
		byTag[tag] = ptr
		base := normTag(parentheticalRe.ReplaceAllString(tag, " "))
		if base != "" {
			baseHits[base] = append(baseHits[base], ptr)
		}
		parts := []string{normTag(ptr.Tag), normTag(ptr.Zh), normTag(ptr.Work), normTag(ptr.WorkZh)}
		if ptr.PinyinAbbr != "" {
			parts = append(parts, ptr.PinyinAbbr)
		}
		for _, alias := range ptr.Aliases {
			parts = append(parts, normTag(alias))
		}
		search = append(search, searchRow{blob: strings.Join(nonEmpty(parts), " "), char: ptr})
	}

	for _, char := range ds.Characters {
		addRow(char)
	}
	for _, char := range rows {
		if strings.TrimSpace(char.Tag) != "" {
			addRow(char)
		}
	}

	baseIndex := map[string]*Character{}
	for base, hits := range baseHits {
		if len(hits) == 1 {
			baseIndex[base] = hits[0]
		}
	}
	ds.IndexByTag = byTag
	ds.IndexBase = baseIndex
	ds.IndexSearch = search
	ds.IndexCount = len(byTag)
	for _, char := range byTag {
		ds.IndexRows = append(ds.IndexRows, char)
	}
}

func (ds *Dataset) buildArtistIndex(indexArtists []Artist) {
	byTag := map[string]*Artist{}
	var search []artistSearchRow

	for i := range ds.Artists {
		a := &ds.Artists[i]
		tag := normTag(a.Tag)
		if tag == "" {
			continue
		}
		a.Tag = tag
		a.Curated = true
		if a.ID != "" && ds.ArtistThumbs[a.ID] {
			a.HasThumb = true
		}
		if a.PinyinAbbr == "" {
			a.PinyinAbbr = pinyinInitials(a.Zh)
			if a.PinyinAbbr == "" {
				a.PinyinAbbr = pinyinInitials(a.Tag)
			}
		}
		tagL := strings.ToLower(tag)
		byTag[tagL] = a

		parts := []string{tagL, normTag(a.Zh), normTag(a.Style), a.PinyinAbbr}
		for _, alias := range a.Aliases {
			parts = append(parts, normTag(alias))
		}
		blob := strings.ToLower(strings.Join(nonEmpty(parts), " "))
		search = append(search, artistSearchRow{
			blob:    blob,
			tokens:  strings.Fields(blob),
			artist:  a,
			curated: true,
		})
	}

	for i := range indexArtists {
		a := indexArtists[i]
		tag := normTag(a.Tag)
		if tag == "" {
			continue
		}
		tagL := strings.ToLower(tag)
		if _, exists := byTag[tagL]; exists {
			continue
		}
		a.Tag = tag
		a.Curated = false
		if a.ID != "" && ds.ArtistThumbs[a.ID] {
			a.HasThumb = true
		}
		if a.PinyinAbbr == "" {
			a.PinyinAbbr = pinyinInitials(a.Zh)
			if a.PinyinAbbr == "" {
				a.PinyinAbbr = pinyinInitials(a.Tag)
			}
		}
		stored := a
		ptr := &stored
		byTag[tagL] = ptr

		parts := []string{tagL, normTag(ptr.Zh), normTag(ptr.Style), ptr.PinyinAbbr}
		for _, alias := range ptr.Aliases {
			parts = append(parts, normTag(alias))
		}
		blob := strings.ToLower(strings.Join(nonEmpty(parts), " "))
		search = append(search, artistSearchRow{
			blob:    blob,
			tokens:  strings.Fields(blob),
			artist:  ptr,
			curated: false,
		})
	}

	allRows := make([]*Artist, 0, len(byTag))
	for _, ptr := range byTag {
		allRows = append(allRows, ptr)
	}
	sort.Slice(allRows, func(i, j int) bool {
		return allRows[i].PostCount > allRows[j].PostCount
	})

	ds.ArtistIndexRows = allRows
	ds.ArtistIndexByTag = byTag
	ds.ArtistSearch = search
	ds.ArtistCount = len(ds.Artists)
	ds.ArtistCuratedCount = len(ds.Artists)
	ds.ArtistIndexCount = len(byTag)
}

// ── 基础工具 ───────────────────────────────────────────────────────────
func normTag(tag string) string {
	replaced := strings.ToLower(strings.TrimSpace(tag))
	replaced = strings.ReplaceAll(replaced, "_", " ")
	return strings.Join(strings.Fields(replaced), " ")
}

func splitTags(value string) []string {
	out := []string{}
	for _, piece := range tagSplitRe.Split(value, -1) {
		tag := normTag(piece)
		if tag != "" {
			out = append(out, tag)
		}
	}
	return out
}

func nonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func dedupe(tags []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		t := normTag(tag)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

func levelNum(value interface{}) int {
	switch v := value.(type) {
	case int:
		if v < 0 {
			return 0
		}
		if v > 99 {
			return 99
		}
		return v
	case float64:
		return levelNum(int(v))
	case string:
		if level, ok := LevelNum[v]; ok {
			return level
		}
		return 0
	default:
		return 0
	}
}

func levelLabel(num int) string {
	if num >= 99 {
		return LevelLabels[99]
	}
	if num < 0 {
		num = 0
	}
	if num > 4 {
		num = 4
	}
	return LevelLabels[num]
}

func resolveTagCap(value interface{}, tier int) int {
	text := strings.TrimSpace(asString(value, "自动"))
	valid := false
	for _, choice := range TagCapChoices {
		if choice == text {
			valid = true
			break
		}
	}
	if !valid {
		text = "自动"
	}
	if text == "自动" {
		if tier >= 99 {
			return 60
		}
		cap := 44 + tier*2
		if cap > 60 {
			cap = 60
		}
		return cap
	}
	valueInt := asInt(text, 40)
	if valueInt < 8 {
		valueInt = 8
	}
	return valueInt
}

// ── 拼音 ────────────────────────────────────────────────────────────────
var pinyinExtra = map[rune]string{
	'伽': "j", '傩': "n", '冢': "z", '咲': "x", '喰': "c", '坂': "b", '堇': "j", '妃': "f",
	'妲': "d", '娅': "y", '幡': "f", '彗': "h", '昙': "t", '曜': "y", '柊': "z", '柚': "y",
	'栉': "z", '梓': "z", '椛': "h", '楯': "s", '榛': "z", '槻': "g", '樋': "t", '橘': "j",
	'毬': "q", '泷': "l", '澪': "l", '濑': "l", '燐': "l", '珀': "p", '珂': "k", '琥': "h",
	'琪': "q", '瑠': "l", '璐': "l", '町': "d", '祢': "n", '禅': "c", '穹': "q", '笠': "l",
	'糸': "s", '绫': "l", '缇': "t", '芙': "f", '芮': "r", '茉': "m", '茜': "x", '茱': "z",
	'萃': "c", '薇': "w", '诃': "h", '诹': "z", '遐': "x", '骥': "j", '骧': "x", '魈': "x",
	'鵺': "y", '鸢': "y", '鹭': "l", '黛': "d", '什': "s",
}

var (
	pinyinCache   = map[rune]string{}
	pinyinCacheMu sync.Mutex
	gbkEncoder    = simplifiedchinese.GBK.NewEncoder()
)

func pinyinCharInitial(char rune) string {
	if initial, ok := pinyinExtra[char]; ok {
		return initial
	}
	pinyinCacheMu.Lock()
	defer pinyinCacheMu.Unlock()
	if cached, ok := pinyinCache[char]; ok {
		return cached
	}

	initial := ""
	encoded, err := gbkEncoder.Bytes([]byte(string(char)))
	if err == nil {
		if len(encoded) == 1 {
			b := encoded[0]
			if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') {
				initial = strings.ToLower(string(b))
			}
		} else if len(encoded) >= 2 {
			value := int(encoded[0])*256 + int(encoded[1])
			switch {
			case value >= 0xB0A1 && value <= 0xB0C4:
				initial = "a"
			case value >= 0xB0C5 && value <= 0xB2C0:
				initial = "b"
			case value >= 0xB2C1 && value <= 0xB4ED:
				initial = "c"
			case value >= 0xB4EE && value <= 0xB6E9:
				initial = "d"
			case value >= 0xB6EA && value <= 0xB7A1:
				initial = "e"
			case value >= 0xB7A2 && value <= 0xB8C0:
				initial = "f"
			case value >= 0xB8C1 && value <= 0xB9FD:
				initial = "g"
			case value >= 0xB9FE && value <= 0xBBF6:
				initial = "h"
			case value >= 0xBBF7 && value <= 0xBFA5:
				initial = "j"
			case value >= 0xBFA6 && value <= 0xC0AB:
				initial = "k"
			case value >= 0xC0AC && value <= 0xC2E7:
				initial = "l"
			case value >= 0xC2E8 && value <= 0xC4C2:
				initial = "m"
			case value >= 0xC4C3 && value <= 0xC5B5:
				initial = "n"
			case value >= 0xC5B6 && value <= 0xC5BD:
				initial = "o"
			case value >= 0xC5BE && value <= 0xC6D9:
				initial = "p"
			case value >= 0xC6DA && value <= 0xC8BA:
				initial = "q"
			case value >= 0xC8BB && value <= 0xC8F5:
				initial = "r"
			case value >= 0xC8F6 && value <= 0xCBF9:
				initial = "s"
			case value >= 0xCBFA && value <= 0xCDD9:
				initial = "t"
			case value >= 0xCDDA && value <= 0xCEF3:
				initial = "w"
			case value >= 0xCEF4 && value <= 0xD1B8:
				initial = "x"
			case value >= 0xD1B9 && value <= 0xD4D0:
				initial = "y"
			case value >= 0xD4D1 && value <= 0xD7F9:
				initial = "z"
			}
		}
	}
	pinyinCache[char] = initial
	return initial
}

func pinyinInitials(text string) string {
	var builder strings.Builder
	for _, char := range text {
		builder.WriteString(pinyinCharInitial(char))
	}
	return builder.String()
}

// characterAliases 是 ACG 常用俗称 / 别名映射。
var characterAliasesTable = map[string][]string{
	"zhongli":        {"钟离", "帝君", "岩王帝君", "摩拉克斯", "zl", "zhongli"},
	"raiden":         {"雷电将军", "将军", "影", "雷电影", "煮饭婆", "巴尔泽布", "raiden", "ei"},
	"nahida":         {"纳西妲", "草神", "小草神", "布耶尔", "草王", "nahida"},
	"venti":          {"温迪", "风神", "巴巴托斯", "摸鱼王", "卖唱的", "venti"},
	"furina":         {"芙宁娜", "水神", "芙芙", "芙卡洛斯", "furina"},
	"hu tao":         {"胡桃", "堂主", "往生堂堂主", "ht", "hu tao"},
	"kamisato ayaka": {"神里绫华", "白鹭公主", "绫华", "龟龟", "ayaka"},
	"kamisato ayato": {"神里绫人", "绫人", "家主", "ayato"},
	"tartaglia":      {"达达利亚", "公子", "达达鸭", "鸭鸭", "childe", "tartaglia"},
	"wanderer":       {"流浪者", "散兵", "大炮", "国崩", "斯卡拉姆齐", "scaramouche", "wanderer"},
	"kazuha":         {"枫原万叶", "叶天帝", "万叶", "kazuha"},
	"alhaitham":      {"艾尔海森", "海哥", "书记官", "alhaitham"},
	"keqing":         {"刻晴", "阿晴", "屁斜剑法", "keqing"},
	"yoimiya":        {"宵宫", "火花骑士", "yoimiya"},
	"yae miko":       {"八重神子", "屑狐狸", "八重", "神子", "yae", "yae miko"},
	"shenhe":         {"申鹤", "小姨", "shenhe"},
	"yelan":          {"夜兰", "夜天后", "yelan"},
	"diluc":          {"迪卢克", "卢姥爷", "正义人", "diluc"},
	"wriothesley":    {"莱欧斯利", "典狱长", "公爵", "wriothesley"},
	"neuvillette":    {"那维莱特", "那维", "水龙", "水龙王", "大审判官", "neuvillette"},
	"ganyu":          {"甘雨", "椰羊", "王小美", "ganyu"},
	"klee":           {"可莉", "火花骑士", "小太阳", "klee"},
	"xiao":           {"魈", "降魔大圣", "金鹏", "xiao"},
	"navia":          {"娜维娅", "刺玫会会长", "大小姐", "navia"},
	"arlecchino":     {"阿蕾奇诺", "仆人", "父亲", "arlecchino", "father"},
	"clorinde":       {"克洛琳德", "决斗代理人", "clorinde"},
	"xianyun":        {"闲云", "留云借风真君", "留云", "xianyun"},
	"kafka":          {"卡芙卡", "妈咪", "卡妈", "kafka"},
	"acheron":        {"黄泉", "雷电忘川守芽衣", "acheron"},
	"firefly":        {"流萤", "萨姆", "格拉默铁骑", "firefly", "sam"},
	"ruan mei":       {"阮·梅", "阮梅", "梅姐", "ruan mei"},
	"silver wolf":    {"银狼", "骇客", "silver wolf", "sw"},
	"blade":          {"刃", "点刀哥", "阿刃", "blade"},
	"jing yuan":      {"景元", "神君", "将军", "闭目将军", "jing yuan"},
	"dan heng":       {"丹恒", "冷面小青龙", "饮月", "饮月君", "dan heng"},
	"feixiao":        {"飞霄", "天击将军", "大捷将军", "feixiao"},
	"aventurine":     {"砂金", "孔雀", "总监", "aventurine"},
	"sunday":         {"星期日", "周日哥", "sunday"},
	"robin":          {"知更鸟", "鸟妹", "robin"},
	"sparkle":        {"花火", "小花火", "欢愉", "sparkle", "hanabi"},
	"fu xuan":        {"符玄", "太卜", "法姐", "fu xuan"},
	"jingliu":        {"镜流", "师祖", "白发魔女", "jingliu"},
	"seele":          {"希儿", "蝴蝶", "seele"},
	"bronya":         {"布洛妮娅", "鸭鸭", "大鸭鸭", "大守护者", "板鸭", "bronya"},
	"gallagher":      {"加拉赫", "加宝", "调酒师", "gallagher"},
	"march 7th":      {"三月七", "三月", "看板娘", "march 7th"},
	"ellen":          {"艾莲·乔", "艾莲", "鲨鱼妹", "ellen", "ellen joe"},
	"zhu yuan":       {"朱鸢", "治安官", "zhu yuan"},
	"jane":           {"简·杜", "简杜", "鼠鼠", "简", "jane doe"},
	"nicole":         {"妮可·德玛拉", "妮可", "狡兔屋老大", "nicole"},
	"miyabi":         {"星见雅", "雅", "对魔导六课课长", "miyabi"},
	"artoria":        {"阿尔托莉雅·潘德拉贡", "阿尔托莉雅", "吾王", "呆毛王", "saber", "棉被王", "蓝呆", "artoria"},
	"saber":          {"吾王", "呆毛王", "saber", "阿尔托莉雅"},
	"gilgamesh":      {"吉尔伽美什", "金闪闪", "闪闪", "英雄王", "金皮卡", "gilgamesh"},
	"emiya":          {"卫宫", "英灵卫宫", "红A", "家政夫", "emiya", "archer"},
	"cu chulainn":    {"库·丘林", "大狗", "枪哥", "汪酱", "cu chulainn", "lancer"},
	"tohsaka":        {"远坂凛", "红色恶魔", "凛", "tohsaka rin", "rin"},
	"mash":           {"玛修·基列莱特", "玛修", "学妹", "小茄子", "盾娘", "mash"},
	"jeanne":         {"贞德", "村姑", "贞德", "黑贞", "jalter", "jeanne"},
	"morgan":         {"摩根", "妻君", "救世主", "女王摩根", "morgan"},
	"melusine":       {"梅露莘", "妖精骑士兰斯洛特", "小火龙", "melusine"},
	"nero":           {"尼禄·克劳狄乌斯", "尼禄", "红Saber", "陛下", "nero"},
	"scathach":       {"斯卡哈", "师匠", "紫发美少女", "scathach"},
	"okita":          {"冲田总司", "冲田小姐", "樱Saber", "okita"},
	"tamamo":         {"玉藻前", "小玉", "狐狸", "c狐", "tamamo"},
	"gojo":           {"五条悟", "5t5", "最强", "五条老师", "gojo"},
	"toji":           {"伏黑甚尔", "甚尔", "天与暴君", "爹咪", "toji"},
	"nanami":         {"七海建人", "七海", "娜娜米", "加班人", "nanami"},
	"sukuna":         {"两面宿傩", "宿傩", "大爷", "sukuna"},
	"geto":           {"夏油杰", "夏油", "教祖", "geto"},
	"levi":           {"利威尔·阿克曼", "利威尔", "兵长", "一米六", "人类最强", "levi"},
	"eren":           {"艾伦·耶格尔", "艾伦", "艾指导", "进击的巨人", "eren"},
	"mikasa":         {"三笠·阿克曼", "三笠", "三爷", "mikasa"},
	"gotou hitori":   {"后藤一里", "波奇酱", "小波奇", "社恐吉他手", "bocchi", "gotou hitori"},
	"hitori":         {"后藤一里", "波奇酱", "小波奇", "bocchi"},
	"nijika":         {"伊地知虹夏", "虹夏", "下北泽大天使", "nijika"},
	"ryo":            {"山田凉", "凉", "吃草", "ryo"},
	"kita":           {"喜多郁代", "喜多", "喜多喜多", "喜多酱", "kita"},
	"yor":            {"约尔·福杰", "约尔", "荆棘公主", "约尔太太", "yor"},
	"anya":           {"阿尼亚·福杰", "阿尼亚", "读心萝莉", "瓜神", "anya"},
	"hoshino ai":     {"星野爱", "爱", "爱咪", "ai hoshino"},
	"akane":          {"黑川茜", "茜", "侧写大师", "akane"},
	"kana":           {"有马加奈", "加奈", "帽子", "舔小苏打", "kana"},
	"chisato":        {"锦木千束", "千束", "chisato"},
	"takina":         {"井之上泷奈", "泷奈", "takina"},
	"miku":           {"初音未来", "初音", "公主殿下", "世界第一公主殿下", "miku", "葱娘"},
	"frieren":        {"芙莉莲", "葬送的芙莉莲", "老登", "frieren"},
	"fern":           {"费伦", "菲伦", "肥伦", "ferun", "ferren", "fern"},
	"rem":            {"蕾姆", "雷姆", "rem"},
	"kurumi":         {"时崎狂三", "狂三", "三三", "kurumi"},
	"misaka":         {"御坂美琴", "美琴", "炮姐", "超电磁炮", "bilibili", "misaka"},
	"haibara":        {"灰原哀", "小哀", "哀酱", "雪莉", "haibara"},
	"marin":          {"喜多川海梦", "海梦", "辣妹", "marin"},
	"reimu":          {"博丽灵梦", "灵梦", "红白", "城管", "reimu"},
	"marisa":         {"雾雨魔理沙", "魔理沙", "黑白", "marisa"},
	"sakuya":         {"十六夜咲夜", "咲夜", "pad长", "女仆长", "sakuya"},
}

func characterAliases(tag, zh string) []string {
	tagLower := strings.ToLower(normTag(tag))
	zhLower := strings.ToLower(normTag(zh))
	result := map[string]bool{}
	for pattern, aliases := range characterAliasesTable {
		pat := strings.ToLower(normTag(pattern))
		if pat != "" && (strings.Contains(tagLower, pat) || (zhLower != "" && strings.Contains(zhLower, pat))) {
			for _, alias := range aliases {
				result[alias] = true
			}
		}
	}
	out := make([]string, 0, len(result))
	for alias := range result {
		out = append(out, alias)
	}
	sort.Strings(out)
	return out
}

// ── 查询 payload ───────────────────────────────────────────────────────
func (ds *Dataset) levelsContract() []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(LevelChoices))
	for _, key := range LevelChoices {
		num := LevelNum[key]
		out = append(out, map[string]interface{}{"key": key, "num": num, "label": LevelLabels[num]})
	}
	return out
}

func (ds *Dataset) poolsPayload() map[string]interface{} {
	totalFields := 0
	totalOptions := 0
	for _, section := range ds.Sections {
		totalFields += len(section.Fields)
		for _, field := range section.Fields {
			totalOptions += len(field.Opts)
		}
	}
	return map[string]interface{}{
		"sections":         ds.Sections,
		"levels":           ds.levelsContract(),
		"quality_profiles": QualityProfiles,
		"outfit_styles":    OutfitStyles,
		"artist_styles":    ArtistStyles,
		"tag_cap_choices":  TagCapChoices,
		"version":          Version,
		"_meta": map[string]interface{}{
			"schema":  "noobai-lib/pools@1",
			"version": Version,
			"counters": map[string]int{
				"sections": len(ds.Sections),
				"fields":   totalFields,
				"options":  totalOptions,
			},
		},
	}
}

func (ds *Dataset) artistsPayload() map[string]interface{} {
	return map[string]interface{}{
		"artists":           ds.Artists,
		"styles":            ds.ArtistStyles,
		"count":             len(ds.Artists),
		"total_index":       ds.ArtistIndexCount,
		"total_index_count": ds.ArtistIndexCount,
		"version":           Version,
		"_meta": map[string]interface{}{
			"schema":            "noobai-lib/artists@1",
			"version":           Version,
			"count":             len(ds.Artists),
			"total_index_count": ds.ArtistIndexCount,
			"styles":            len(ds.ArtistStyles),
		},
	}
}

func (ds *Dataset) charactersPayload() map[string]interface{} {
	return map[string]interface{}{
		"characters": ds.Characters,
		"works":      ds.Works,
		"count":      len(ds.Characters),
		"version":    Version,
		"_meta": map[string]interface{}{
			"schema":  "noobai-lib/characters@1",
			"version": Version,
			"count":   len(ds.Characters),
			"works":   len(ds.Works),
		},
	}
}

func (ds *Dataset) outfitsPayload(state State) map[string]interface{} {
	return map[string]interface{}{
		"outfits":    ds.Outfits,
		"categories": ds.OutfitCats,
		"count":      len(ds.Outfits),
		"version":    Version,
		"_meta": map[string]interface{}{
			"schema":    "noobai-lib/outfits@1",
			"version":   Version,
			"count":     len(ds.Outfits),
			"active":    state.ActiveOutfit,
			"overrides": state.Overrides,
		},
	}
}

func (ds *Dataset) scenesPayload() map[string]interface{} {
	return map[string]interface{}{
		"scenes":  ds.Scenes,
		"groups":  ds.SceneGroups,
		"count":   len(ds.Scenes),
		"version": Version,
		"_meta": map[string]interface{}{
			"schema":  "noobai-lib/scenes@1",
			"version": Version,
			"count":   len(ds.Scenes),
		},
	}
}

func (ds *Dataset) healthPayload() map[string]interface{} {
	totalOptions := 0
	for _, section := range ds.Sections {
		for _, field := range section.Fields {
			totalOptions += len(field.Opts)
		}
	}
	return map[string]interface{}{
		"ok":      true,
		"name":    "NoobAI_lib",
		"version": Version,
		"counts": map[string]int{
			"sections":        len(ds.Sections),
			"options":         totalOptions,
			"characters":      len(ds.Characters),
			"character_index": ds.IndexCount,
			"artists":         len(ds.Artists),
			"artist_index":    ds.ArtistIndexCount,
			"outfits":         len(ds.Outfits),
			"scenes":          len(ds.Scenes),
		},
	}
}

func (ds *Dataset) searchCharacters(query, work string, limit, offset int) map[string]interface{} {
	q := normTag(query)
	workKey := normTag(work)
	score := func(row searchRow) int {
		char := row.char
		if char.PinyinAbbr == q {
			return 100
		}
		for _, alias := range char.Aliases {
			if strings.ToLower(alias) == q {
				return 100
			}
		}
		if strings.HasPrefix(char.Tag, q) || strings.HasPrefix(char.Zh, q) {
			return 80
		}
		for _, token := range strings.Fields(row.blob) {
			if token == q {
				return 60
			}
		}
		if strings.Contains(row.blob, q) {
			return 10
		}
		return 0
	}

	type hit struct {
		row searchRow
		pos int
	}
	var hits []hit
	for _, row := range ds.IndexSearch {
		if q != "" {
			if s := score(row); s > 0 {
				hits = append(hits, hit{row: row, pos: s})
			}
		} else {
			hits = append(hits, hit{row: row, pos: 0})
		}
	}
	if workKey != "" {
		filtered := hits[:0]
		for _, item := range hits {
			if normTag(item.row.char.Work) == workKey {
				filtered = append(filtered, item)
			}
		}
		hits = filtered
	}
	if q != "" {
		sort.SliceStable(hits, func(i, j int) bool { return hits[i].pos > hits[j].pos })
	}
	total := len(hits)
	if offset < 0 {
		offset = 0
	}
	if limit < 1 {
		limit = 80
	}
	if limit > 200 {
		limit = 200
	}
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	page := make([]*Character, 0, end-start)
	for _, item := range hits[start:end] {
		page = append(page, item.row.char)
	}
	return map[string]interface{}{
		"ok":          true,
		"total":       total,
		"count":       len(page),
		"offset":      offset,
		"index_count": ds.IndexCount,
		"characters":  page,
	}
}

func (ds *Dataset) searchArtists(query, style, sortKey, scope string, limit, offset int) map[string]interface{} {
	q := strings.ToLower(normTag(query))
	styleKey := normTag(style)
	sortKey = strings.ToLower(sortKey)
	if sortKey == "" {
		sortKey = "hot"
	}
	scopeKey := strings.ToLower(scope)
	if scopeKey == "" {
		scopeKey = "all"
	}

	var baseRows []*Artist
	var searchEntries []artistSearchRow

	if scopeKey == "curated" {
		for _, a := range ds.ArtistIndexRows {
			if a.Curated {
				baseRows = append(baseRows, a)
			}
		}
		for _, r := range ds.ArtistSearch {
			if r.curated {
				searchEntries = append(searchEntries, r)
			}
		}
	} else {
		baseRows = ds.ArtistIndexRows
		searchEntries = ds.ArtistSearch
	}

	scoreFn := func(row artistSearchRow) int {
		a := row.artist
		py := strings.ToLower(a.PinyinAbbr)
		tag := strings.ToLower(a.Tag)
		zh := strings.ToLower(a.Zh)
		if py == q || tag == q {
			return 100
		}
		for _, alias := range a.Aliases {
			if strings.ToLower(alias) == q {
				return 100
			}
		}
		if strings.HasPrefix(tag, q) || (zh != "" && strings.HasPrefix(zh, q)) {
			return 80
		}
		for _, tok := range row.tokens {
			if tok == q {
				return 60
			}
		}
		if strings.Contains(row.blob, q) {
			return 10
		}
		return 0
	}

	type hitItem struct {
		artist *Artist
		score  int
	}
	var hits []*Artist

	if q != "" {
		var scored []hitItem
		for _, row := range searchEntries {
			s := scoreFn(row)
			if s > 0 {
				scored = append(scored, hitItem{artist: row.artist, score: s})
			}
		}
		if sortKey == "name" {
			sort.SliceStable(scored, func(i, j int) bool {
				if scored[i].score != scored[j].score {
					return scored[i].score > scored[j].score
				}
				nameI := scored[i].artist.Zh
				if nameI == "" {
					nameI = scored[i].artist.Tag
				}
				nameJ := scored[j].artist.Zh
				if nameJ == "" {
					nameJ = scored[j].artist.Tag
				}
				return strings.ToLower(nameI) < strings.ToLower(nameJ)
			})
		} else {
			sort.SliceStable(scored, func(i, j int) bool {
				if scored[i].score != scored[j].score {
					return scored[i].score > scored[j].score
				}
				return scored[i].artist.PostCount > scored[j].artist.PostCount
			})
		}
		for _, it := range scored {
			hits = append(hits, it.artist)
		}
	} else {
		hits = append(hits, baseRows...)
		if sortKey == "name" {
			sort.SliceStable(hits, func(i, j int) bool {
				nameI := hits[i].Zh
				if nameI == "" {
					nameI = hits[i].Tag
				}
				nameJ := hits[j].Zh
				if nameJ == "" {
					nameJ = hits[j].Tag
				}
				return strings.ToLower(nameI) < strings.ToLower(nameJ)
			})
		} else if sortKey == "hot" {
			sort.SliceStable(hits, func(i, j int) bool {
				return hits[i].PostCount > hits[j].PostCount
			})
		}
	}

	if styleKey != "" && styleKey != "全部" && styleKey != "不限" && styleKey != "随机" {
		filtered := make([]*Artist, 0, len(hits))
		for _, a := range hits {
			if normTag(a.Style) == styleKey {
				filtered = append(filtered, a)
			}
		}
		hits = filtered
	}

	total := len(hits)
	if offset < 0 {
		offset = 0
	}
	if limit < 1 {
		limit = 80
	}
	if limit > 200 {
		limit = 200
	}
	start := offset
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	page := hits[start:end]

	return map[string]interface{}{
		"ok":            true,
		"total":         total,
		"count":         len(page),
		"offset":        offset,
		"index_count":   ds.ArtistIndexCount,
		"curated_count": ds.ArtistCuratedCount,
		"artists":       page,
	}
}

func (ds *Dataset) randomArtist(scope, style string) *Artist {
	scopeKey := strings.ToLower(scope)
	var pool []*Artist
	if scopeKey == "curated" {
		for i := range ds.Artists {
			pool = append(pool, &ds.Artists[i])
		}
	} else {
		pool = ds.ArtistIndexRows
	}
	styleKey := normTag(style)
	if styleKey != "" && styleKey != "全部" && styleKey != "随机" && styleKey != "不限" {
		var filtered []*Artist
		for _, a := range pool {
			if normTag(a.Style) == styleKey {
				filtered = append(filtered, a)
			}
		}
		pool = filtered
	}
	if len(pool) == 0 {
		return nil
	}
	return pool[rand.Intn(len(pool))]
}
