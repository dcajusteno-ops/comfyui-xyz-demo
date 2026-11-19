package noobai

import (
	"encoding/json"
	"math/rand"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// ── 正则 ────────────────────────────────────────────────────────────────
var (
	tagSplitRe      = regexp.MustCompile(`\s*,\s*`)
	parentheticalRe = regexp.MustCompile(`\([^)]*\)`)
	roleSplitRe     = regexp.MustCompile(`\s*[|,]\s*`)

	levelPatterns = []struct {
		level int
		re    *regexp.Regexp
	}{
		{4, regexp.MustCompile(`\b(gangbang|group sex|orgy|double penetration|extreme|bestiality|mind break|ryona|guro|amputee|vore)\b`)},
		{3, regexp.MustCompile(`\b(sex|fellatio|paizuri|handjob|masturbation|bondage|shibari|bdsm|sex toy|dildo|vibrator|onahole|cum|creampie|cunnilingus|anilingus|anal|vaginal|penetration|handcuffs|ball gag|leash|collar|blindfold|spread legs|legs up|straddling|fingering|deepthroat|irrumatio|after sex|used condom|condom)\b`)},
		{2, regexp.MustCompile(`\b(nude|naked|topless|bottomless|nipples?|areolae?|exposed breasts|no bra|no panties|undressing|panties pull|cameltoe|bare buttocks|completely nude|shirt lift|apron only|micro bikini|see-through|wet clothes|wet shirt|panties aside)\b`)},
		{1, regexp.MustCompile(`\b(bikini|swimsuit|lingerie|underwear|panties|bra|cleavage|underboob|sideboob|midriff|garter belt|thigh strap|bare shoulders|off-shoulder|short shorts|miniskirt|hot pants|slingshot swimsuit)\b`)},
	}

	coreSFWDeny = map[string]bool{
		"cleavage": true, "large breasts": true, "huge breasts": true, "gigantic breasts": true,
		"sideboob": true, "underboob": true, "thighs": true, "bare shoulders": true, "midriff": true,
		"navel": true, "panties": true, "bra": true, "lingerie": true, "bikini": true,
		"see-through": true, "wet clothes": true, "no bra": true, "no panties": true,
		"small breasts": true, "medium breasts": true, "flat chest": true,
	}

	outfitStrongRe = regexp.MustCompile(`\b(uniform|serafuku|dress|kimono|yukata|hanfu|qipao|cheongsam|armor|bodysuit|leotard|swimsuit|maid|suit)\b`)
	outfitAnyRe    = regexp.MustCompile(`\b(shirt|blouse|sweater|cardigan|hoodie|jacket|coat|blazer|skirt|pants|shorts|jeans|socks|thighhighs|stockings|pantyhose|boots|shoes|sandals|footwear|gloves|scarf|necktie|ribbon|bow|apron|vest|cape|cloak|uniform|serafuku|dress|kimono|yukata|hanfu|qipao|cheongsam|armor|bodysuit|leotard|swimsuit|bikini|lingerie|bra|panties|maid|suit|obi|gauntlets|sleeves|cuffs|capelet|shawl|beret|cap|veil|robe|turtleneck|camisole|sarong|headband|headwear|hat|corset|belt|sash|tassel|earrings|necklace|choker|armband|armlet|fishnets|garter|suspender|headphones)\b`)
	outfitTopRe    = regexp.MustCompile(`\b(shirt|blouse|sweater|cardigan|hoodie|jacket|coat|blazer|top|sleeves|vest|crop top|tank top|camisole|turtleneck|capelet|robe)\b`)
	outfitBottomRe = regexp.MustCompile(`\b(skirt|pants|shorts|jeans|trousers|bloomers|leggings|sarong)\b`)
	countTagRe     = regexp.MustCompile(`^(1girl|1boy|1other|[2-9]\+?girls|[2-9]\+?boys|solo|multiple girls|multiple boys|couple|group|male focus|female focus)$`)
	styleishRe     = regexp.MustCompile(`\b(twintails?|ponytail|braid|braids|bun|buns|updo|odango|bob cut|pixie cut|hime cut|drills?|ringlets|intakes|flaps|wolf cut|mullet|undercut|bowl cut|shaggy|spiked|antenna|bangs|sidelocks|ahoge|hair behind ear|hair over one eye|hair between eyes|hair spread out|swept back|side part|middle part)\b`)
	hairLengthRe   = regexp.MustCompile(`^(very short|short|medium|long|very long|absurdly long|floor-length|shoulder-length|chin-length) hair$`)
	hairColorRe    = regexp.MustCompile(`^(black|brown|blonde|white|grey|gray|blue|purple|pink|red|green|orange|silver|aqua|teal|yellow|gold|platinum|ash|light|dark|navy|turquoise|beige|lavender|lilac|violet|crimson|mint|rose|honey|strawberry|peach|olive|multicolored|two-tone|gradient|streaked|colored) hair$`)
	eyeColorRe     = regexp.MustCompile(`^(black|brown|blonde|white|grey|gray|blue|purple|pink|red|green|orange|silver|aqua|teal|yellow|gold|amber|hazel|violet|lilac|crimson|multicolored|gradient|glowing|heterochromia) eyes$`)
	hairAccRe      = regexp.MustCompile(`(hair bow|hair ribbon|hairband|headband|hairclip|hairpin|hair ornament|hair flower|kanzashi|maid headdress|nurse cap|beret|mini hat|halo|animal ears|cat ears|fox ears|rabbit ears|wolf ears|horns|pointy ears|flower crown|tiara|crown|santa hat)`)
	featureRe      = regexp.MustCompile(`\b(fang|sharp teeth|freckles|dimples|mole|heterochromia|tail|wings|tattoo|scar|eyepatch|bandaid|stitches|spikes|single horn)\b`)

	topWordsRe    = regexp.MustCompile(`\b(shirt|blouse|sweater|cardigan|hoodie|jacket|coat|cape|cloak|vest|uniform|serafuku|sailor shirt|tank top|crop top|tube top|camisole|bra)\b`)
	bottomWordsRe = regexp.MustCompile(`\b(skirt|pants|jeans|shorts|slacks|leggings|bloomers|hakama|panties|bikini bottom|swimsuit bottom)\b`)
	dressWordsRe  = regexp.MustCompile(`\b(dress|gown|qipao|cheongsam|hanfu|kimono|yukata|sari|toga|overalls)\b`)
	footwearRe    = regexp.MustCompile(`\b(boots|shoes|high heels|sandals|sneakers|loafers|pumps|mary janes|slippers|flip-flops|geta|zori)\b`)
	openEyesRe    = regexp.MustCompile(`\b(wide-eyed|wide eyes|open eyes|staring|wide opened eyes)\b`)

	nudeRe       = regexp.MustCompile(`\b(nude|naked|completely nude)\b`)
	toplessRe    = regexp.MustCompile(`\btopless\b`)
	bottomlessRe = regexp.MustCompile(`\bbottomless\b`)
)

var coreFieldOrder = []string{"hair.length", "hair.color", "face.eye_color", "hair.style", "hair.texture", "hair.acc", "face.feature"}
var coreMultiFields = map[string]bool{"hair.style": true, "hair.texture": true, "hair.acc": true, "face.feature": true}
var coreFieldKeys = map[string]bool{
	"hair.length": true, "hair.color": true, "hair.style": true, "hair.texture": true,
	"hair.acc": true, "face.eye_color": true, "face.feature": true,
}

var negativeProfiles = map[string]string{
	"自动（按档位）": "",
	"NoobAI 官方": "nsfw, worst quality, old, early, low quality, lowres, signature, username, " +
		"logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, " +
		"feral, semi-anthro",
	"NoobAI 官方（不含 nsfw）": "worst quality, old, early, low quality, lowres, signature, username, logo, " +
		"bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, " +
		"semi-anthro",
	"WAI 官方": "bad quality, worst quality, worst detail, sketch, censor",
	"不加负面":   "",
	"自定义追加":  "",
}

var ratingNoobAI = map[string]string{
	"sfw": "safe", "suggestive": "sensitive", "explicit": "nsfw",
	"hardcore": "nsfw", "extreme": "explicit",
}

var ratingWAI = map[string]string{
	"sfw": "general", "suggestive": "sensitive", "explicit": "nsfw",
	"hardcore": "nsfw", "extreme": "explicit",
}

const tokenLimit = 75

// ── 参数辅助 ───────────────────────────────────────────────────────────
func asString(value interface{}, fallback string) string {
	if value == nil {
		return fallback
	}
	switch v := value.(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case float64:
		return jsonNumber(v)
	case int:
		return jsonNumber(float64(v))
	default:
		return fallback
	}
}

func jsonNumber(value float64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func asFloat(value interface{}, fallback float64) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case json.Number:
		f, err := v.Float64()
		if err != nil {
			return fallback
		}
		return f
	case string:
		var f float64
		if err := json.Unmarshal([]byte(v), &f); err != nil {
			return fallback
		}
		return f
	default:
		return fallback
	}
}

func asInt(value interface{}, fallback int) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		i, err := v.Int64()
		if err != nil {
			return fallback
		}
		return int(i)
	case string:
		var f float64
		if err := json.Unmarshal([]byte(v), &f); err != nil {
			return fallback
		}
		return int(f)
	default:
		return fallback
	}
}

func asBool(value interface{}, fallback bool) bool {
	if v, ok := value.(bool); ok {
		return v
	}
	return fallback
}

// ── 权重 ───────────────────────────────────────────────────────────────
type weights struct {
	Sections map[string]float64
	Fields   map[string]float64
	Options  map[string]float64
	Tags     map[string]float64
}

func parseWeights(raw interface{}) *weights {
	out := &weights{
		Sections: map[string]float64{}, Fields: map[string]float64{},
		Options: map[string]float64{}, Tags: map[string]float64{},
	}
	var data map[string]interface{}
	switch v := raw.(type) {
	case map[string]interface{}:
		data = v
	case string:
		if strings.TrimSpace(v) != "" {
			_ = json.Unmarshal([]byte(v), &data)
		}
	}
	if data == nil {
		return out
	}
	read := func(key string, target map[string]float64) {
		table, ok := data[key].(map[string]interface{})
		if !ok {
			return
		}
		for name, value := range table {
			target[name] = asFloat(value, 1)
		}
	}
	read("sections", out.Sections)
	read("fields", out.Fields)
	read("options", out.Options)
	read("tags", out.Tags)
	return out
}

func (ds *Dataset) sectionWeight(w *weights, section Section) float64 {
	value, ok := w.Sections[section.ID]
	if !ok {
		value = section.Weight
	}
	if value < 0 {
		return 0
	}
	return value
}

func (w *weights) fieldWeight(key string) float64 {
	value, ok := w.Fields[key]
	if !ok {
		return 1
	}
	if value < 0 {
		return 0
	}
	return value
}

func (w *weights) optionWeight(key, tags string) float64 {
	if value, ok := w.Options[key+"|"+tags]; ok {
		if value < 0 {
			return 0
		}
		return value
	}
	if value, ok := w.Options[key+"|"+normTag(tags)]; ok {
		if value < 0 {
			return 0
		}
		return value
	}
	return 1
}

func (w *weights) tagWeight(tag string) float64 {
	value, ok := w.Tags[tag]
	if !ok {
		return 1
	}
	if value < 0 {
		return 0
	}
	return value
}

type weightedItem struct {
	option Option
	weight float64
}

func weightedPick(rng *rand.Rand, items []weightedItem) *Option {
	pool := make([]weightedItem, 0, len(items))
	total := 0.0
	for _, item := range items {
		if item.weight > 0 {
			pool = append(pool, item)
			total += item.weight
		}
	}
	if len(pool) == 0 {
		return nil
	}
	if total <= 0 {
		chosen := pool[rng.Intn(len(pool))]
		return &chosen.option
	}
	value := rng.Float64() * total
	for _, item := range pool {
		value -= item.weight
		if value <= 0 {
			chosen := item.option
			return &chosen
		}
	}
	chosen := pool[len(pool)-1].option
	return &chosen
}

// ── 引擎 ───────────────────────────────────────────────────────────────
type Engine struct {
	ds *Dataset

	mu         sync.Mutex
	state      State
	lastOutfit string
	lastScene  string
	onSave     func(State) error
}

func NewEngine(ds *Dataset, state State, save func(State) error) *Engine {
	if state.Overrides == nil {
		state.Overrides = map[string]string{"top": "", "bottom": ""}
	}
	return &Engine{ds: ds, state: state, onSave: save}
}

func (e *Engine) State() State {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.state.clone()
}

// UpdateState 合并白名单字段并持久化。
func (e *Engine) UpdateState(patch map[string]interface{}) (State, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	current := e.state
	if value, ok := patch["active_outfit"]; ok {
		current.ActiveOutfit = asString(value, "")
	}
	if overrides, ok := patch["overrides"].(map[string]interface{}); ok {
		if current.Overrides == nil {
			current.Overrides = map[string]string{}
		}
		for _, key := range []string{"top", "bottom"} {
			if value, exists := overrides[key]; exists {
				current.Overrides[key] = asString(value, "")
			}
		}
	}
	applyList := func(key string, target *[]string, limit int) {
		value, ok := patch[key]
		if !ok {
			return
		}
		items, ok := value.([]interface{})
		if !ok {
			return
		}
		*target = cleanList(items, limit)
	}
	applyList("char_favorites", &current.CharFavorites, favMax)
	applyList("outfit_favorites", &current.OutfitFavorites, favMax)
	applyList("scene_favorites", &current.SceneFavorites, favMax)
	applyList("recent_chars", &current.RecentChars, recentMax)
	applyList("recent_outfits", &current.RecentOutfits, recentMax)
	applyList("recent_scenes", &current.RecentScenes, recentMax)
	if ui, ok := patch["ui"].(map[string]interface{}); ok {
		current.UI = ui
	}
	current = current.clone()
	e.state = current
	if e.onSave != nil {
		if err := e.onSave(current.clone()); err != nil {
			return current, err
		}
	}
	return current.clone(), nil
}

func cleanList(items []interface{}, limit int) []string {
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		text := strings.TrimSpace(asString(item, ""))
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		out = append(out, text)
		if len(out) >= limit {
			break
		}
	}
	return out
}

type pickedField struct {
	Key    string
	Zh     []string
	Tags   []string
	Level  int
	Slot   string
	Forced bool
}

type chunk struct {
	ID       string
	Zh       []string
	Tags     []string
	Level    int
	Required bool
	Priority float64
	Keep     bool
	NoCap    bool
	Fields   []string
}

type slotValue struct {
	Zh    string
	Tags  string
	Level int
}

func (e *Engine) tagLevel(tag string) int {
	normalized := normTag(tag)
	if normalized == "" {
		return 0
	}
	base := e.ds.TagLevels[normalized]
	for _, pattern := range levelPatterns {
		if pattern.re.MatchString(normalized) {
			if pattern.level > base {
				return pattern.level
			}
			return base
		}
	}
	return base
}

func (e *Engine) tagIsHairColor(tag string) bool {
	return e.ds.HairColors[normTag(tag)]
}

func (e *Engine) tagIsEyeColor(tag string) bool {
	return strings.HasSuffix(normTag(tag), " eyes")
}

func (e *Engine) splitRoles(value string) []string {
	parts := roleSplitRe.Split(value, -1)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			out = append(out, part)
		}
	}
	return out
}

func (e *Engine) matchCharacters(values []string) ([]*Character, []string) {
	index := map[string]*Character{}
	baseHits := map[string][]*Character{}
	for i := range e.ds.Characters {
		char := &e.ds.Characters[i]
		for _, key := range []string{char.Tag, char.Zh, char.Work, char.WorkZh} {
			normalized := normTag(key)
			if normalized != "" {
				if _, exists := index[normalized]; !exists {
					index[normalized] = char
				}
			}
		}
		base := normTag(parentheticalRe.ReplaceAllString(char.Tag, " "))
		if base != "" {
			baseHits[base] = append(baseHits[base], char)
		}
	}
	baseIndex := map[string]*Character{}
	for base, hits := range baseHits {
		if len(hits) == 1 {
			baseIndex[base] = hits[0]
		}
	}
	found := []*Character{}
	unknown := []string{}
	for _, raw := range values {
		key := normTag(raw)
		hit := index[key]
		if hit == nil {
			hit = baseIndex[key]
		}
		if hit == nil && key != "" {
			hit = e.ds.IndexByTag[key]
			if hit == nil {
				hit = e.ds.IndexBase[key]
			}
		}
		if hit != nil {
			duplicated := false
			for _, existing := range found {
				if existing.Tag == hit.Tag {
					duplicated = true
					break
				}
			}
			if !duplicated {
				found = append(found, hit)
			}
		} else if key != "" {
			duplicated := false
			for _, item := range unknown {
				if item == key {
					duplicated = true
					break
				}
			}
			if !duplicated {
				unknown = append(unknown, key)
			}
		}
	}
	return found, unknown
}

func (e *Engine) countSubjectLabels() map[string]bool {
	out := map[string]bool{}
	for _, section := range e.ds.Sections {
		if section.ID != "count" {
			continue
		}
		for _, field := range section.Fields {
			if field.Key == "count.subject" {
				for _, option := range field.Opts {
					out[option.Zh] = true
				}
			}
		}
	}
	return out
}

func (e *Engine) countSubjectTags() map[string]bool {
	out := map[string]bool{}
	for _, section := range e.ds.Sections {
		if section.ID != "count" {
			continue
		}
		for _, field := range section.Fields {
			if field.Key == "count.subject" {
				for _, option := range field.Opts {
					for _, tag := range splitTags(option.Tags) {
						out[tag] = true
					}
				}
			}
		}
	}
	return out
}

func (e *Engine) resolveScene(rng *rand.Rand, tier int, scenePick bool, pickPoolIDs, avoidID string) *Scene {
	ids := []string{}
	if strings.TrimSpace(pickPoolIDs) != "" {
		for _, part := range roleSplitRe.Split(pickPoolIDs, -1) {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				ids = append(ids, trimmed)
			}
		}
	}
	candidates := []*Scene{}
	if len(ids) > 0 {
		wanted := map[string]bool{}
		for _, id := range ids {
			wanted[id] = true
		}
		for i := range e.ds.Scenes {
			scene := &e.ds.Scenes[i]
			if wanted[scene.ID] && scene.Level <= tier {
				candidates = append(candidates, scene)
			}
		}
	} else if scenePick {
		for i := range e.ds.Scenes {
			scene := &e.ds.Scenes[i]
			if scene.Level <= tier && scene.Group != "near" && scene.Group != "art" {
				candidates = append(candidates, scene)
			}
		}
	}
	if avoidID != "" && len(candidates) > 1 {
		filtered := make([]*Scene, 0, len(candidates))
		for _, scene := range candidates {
			if scene.ID != avoidID {
				filtered = append(filtered, scene)
			}
		}
		if len(filtered) > 0 {
			candidates = filtered
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	return candidates[rng.Intn(len(candidates))]
}

func (e *Engine) resolveOutfit(rng *rand.Rand, tier int, outfitStyle string, state State, prob float64, avoidID string) *Outfit {
	if state.ActiveOutfit != "" {
		for i := range e.ds.Outfits {
			outfit := &e.ds.Outfits[i]
			if outfit.ID == state.ActiveOutfit && outfit.Level <= tier {
				return outfit
			}
		}
	}
	style := outfitStyle
	if style == "" {
		style = "随机"
	}
	if style == "不限" {
		return nil
	}
	eligible := make([]*Outfit, 0, len(e.ds.Outfits))
	for i := range e.ds.Outfits {
		if e.ds.Outfits[i].Level <= tier {
			eligible = append(eligible, &e.ds.Outfits[i])
		}
	}
	if len(eligible) == 0 {
		return nil
	}
	if style == "随机" {
		if prob <= 0 {
			return nil
		}
		if prob < 1 && rng.Float64() >= prob {
			return nil
		}
		pool := eligible
		if avoidID != "" {
			filtered := make([]*Outfit, 0, len(eligible))
			for _, outfit := range eligible {
				if outfit.ID != avoidID {
					filtered = append(filtered, outfit)
				}
			}
			if len(filtered) > 0 {
				pool = filtered
			}
		}
		return pool[rng.Intn(len(pool))]
	}
	cat, ok := StyleCat[style]
	if !ok {
		return nil
	}
	pool := make([]*Outfit, 0, len(eligible))
	for _, outfit := range eligible {
		if outfit.Cat == cat {
			pool = append(pool, outfit)
		}
	}
	if len(pool) == 0 {
		pool = eligible
	}
	if avoidID != "" && len(pool) > 1 {
		filtered := make([]*Outfit, 0, len(pool))
		for _, outfit := range pool {
			if outfit.ID != avoidID {
				filtered = append(filtered, outfit)
			}
		}
		if len(filtered) > 0 {
			pool = filtered
		}
	}
	return pool[rng.Intn(len(pool))]
}

func (e *Engine) pickField(rng *rand.Rand, field Field, tier int, w *weights,
	forcedSlots map[string]slotValue, suppressedSlots map[string]bool,
	baseProb, sectionWeight float64, suppressedFields map[string]bool) *pickedField {

	slot := field.Slot
	if slot != "" {
		if value, ok := forcedSlots[slot]; ok {
			tags := splitTags(value.Tags)
			if len(tags) == 0 {
				return nil
			}
			return &pickedField{
				Key: field.Key, Zh: []string{value.Zh}, Tags: tags,
				Level: value.Level, Slot: slot, Forced: true,
			}
		}
		if suppressedSlots[slot] {
			return nil
		}
	}
	if suppressedFields[field.Key] {
		return nil
	}

	key := field.Key
	fieldWeight := w.fieldWeight(key)
	required := field.Req
	if !required {
		if fieldWeight <= 0 {
			return nil
		}
		if fieldWeight < 3 {
			effectiveBase := baseProb
			if tier >= 1 && (strings.Contains(key, "_nsfw") || strings.HasPrefix(key, "outfit_nsfw") || strings.HasPrefix(key, "pose_nsfw")) {
				if effectiveBase < 0.9 {
					effectiveBase = 0.9
				}
			}
			limit := sectionWeight
			if limit > 3 {
				limit = 3
			}
			p := effectiveBase * limit * fieldWeight
			if p > 1 {
				p = 1
			}
			if p < 0 {
				p = 0
			}
			if rng.Float64() > p {
				return nil
			}
		}
	}

	candidates := []weightedItem{}
	for _, option := range field.Opts {
		if option.Level > tier {
			continue
		}
		optionWeight := w.optionWeight(key, option.Tags)
		if optionWeight <= 0 {
			continue
		}
		candidates = append(candidates, weightedItem{option: option, weight: optionWeight})
	}
	if len(candidates) == 0 {
		return nil
	}

	forced := []weightedItem{}
	for _, candidate := range candidates {
		if candidate.weight >= 3 {
			forced = append(forced, candidate)
		}
	}
	chosen := []Option{}

	if field.Type == "multi" {
		maxCount := field.Max
		if maxCount < 1 {
			maxCount = 1
		}
		if maxCount > len(candidates) {
			maxCount = len(candidates)
		}
		minCount := field.Min
		if minCount < 0 {
			minCount = 0
		}
		if minCount > maxCount {
			minCount = maxCount
		}
		if len(forced) > 0 {
			limit := maxCount
			if len(forced) < limit {
				limit = len(forced)
			}
			for _, item := range forced[:limit] {
				chosen = append(chosen, item.option)
			}
		}
		rest := []weightedItem{}
		for _, candidate := range candidates {
			exists := false
			for _, picked := range chosen {
				if picked.Tags == candidate.option.Tags && picked.Zh == candidate.option.Zh {
					exists = true
					break
				}
			}
			if !exists {
				rest = append(rest, candidate)
			}
		}
		target := minCount
		if maxCount > minCount {
			target = minCount + rng.Intn(maxCount-minCount+1)
		}
		if target < len(chosen) {
			target = len(chosen)
		}
		for len(chosen) < target && len(rest) > 0 {
			pick := weightedPick(rng, rest)
			if pick == nil {
				break
			}
			chosen = append(chosen, *pick)
			filtered := make([]weightedItem, 0, len(rest))
			for _, item := range rest {
				if item.option.Tags != pick.Tags || item.option.Zh != pick.Zh {
					filtered = append(filtered, item)
				}
			}
			rest = filtered
		}
	} else {
		pool := candidates
		if len(forced) > 0 {
			pool = forced
		}
		pick := weightedPick(rng, pool)
		if pick == nil {
			return nil
		}
		chosen = append(chosen, *pick)
	}

	tags := []string{}
	zh := []string{}
	level := 0
	for _, option := range chosen {
		tags = append(tags, splitTags(option.Tags)...)
		if option.Zh != "" {
			zh = append(zh, option.Zh)
		}
		if option.Level > level {
			level = option.Level
		}
	}
	if len(tags) == 0 {
		return nil
	}
	return &pickedField{Key: key, Zh: zh, Tags: tags, Level: level, Slot: slot}
}

func (e *Engine) processSection(rng *rand.Rand, section Section, tier int, w *weights,
	forcedSlots map[string]slotValue, suppressedSlots map[string]bool,
	baseProb float64, disabled map[string]bool, suppressedFields map[string]bool) *chunk {

	if disabled[section.ID] {
		return nil
	}
	if section.Floor > tier {
		return nil
	}
	hasRequired := false
	for _, field := range section.Fields {
		if field.Req {
			hasRequired = true
			break
		}
	}
	sectionWeight := e.ds.sectionWeight(w, section)
	if sectionWeight <= 0 && !hasRequired {
		return nil
	}

	tags := []string{}
	zh := []string{}
	level := 0
	usedFields := []string{}
	localSuppressed := map[string]bool{}
	for key := range suppressedSlots {
		localSuppressed[key] = true
	}
	for _, field := range section.Fields {
		result := e.pickField(rng, field, tier, w, forcedSlots, localSuppressed,
			baseProb, sectionWeight, suppressedFields)
		if result == nil {
			continue
		}
		tags = append(tags, result.Tags...)
		for _, item := range result.Zh {
			if item != "" {
				zh = append(zh, item)
			}
		}
		if result.Level > level {
			level = result.Level
		}
		usedFields = append(usedFields, result.Key)
		if result.Slot == "dress" {
			localSuppressed["top"] = true
			localSuppressed["bottom"] = true
		}
	}
	if len(tags) == 0 && len(zh) == 0 {
		return nil
	}
	return &chunk{
		ID: section.ID, Zh: zh, Tags: tags, Level: level,
		Required: hasRequired, Priority: float64(section.Order), Fields: usedFields,
	}
}

func applyMutex(tags []string) []string {
	norm := dedupe(tags)
	lower := strings.Join(norm, " ")
	drop := map[string]bool{}

	if nudeRe.MatchString(lower) {
		for _, tag := range norm {
			if topWordsRe.MatchString(tag) || bottomWordsRe.MatchString(tag) || dressWordsRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	if toplessRe.MatchString(lower) {
		for _, tag := range norm {
			if topWordsRe.MatchString(tag) || dressWordsRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	if bottomlessRe.MatchString(lower) {
		for _, tag := range norm {
			if bottomWordsRe.MatchString(tag) || dressWordsRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	has := func(value string) bool {
		for _, tag := range norm {
			if tag == value {
				return true
			}
		}
		return false
	}
	if has("towel") || has("apron only") || has("naked apron") {
		for _, tag := range norm {
			if strings.Contains(tag, "apron") {
				continue
			}
			if topWordsRe.MatchString(tag) || bottomWordsRe.MatchString(tag) || dressWordsRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	if has("barefoot") {
		for _, tag := range norm {
			if footwearRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	if has("closed eyes") {
		for _, tag := range norm {
			if openEyesRe.MatchString(tag) {
				drop[tag] = true
			}
		}
	}
	if has("short hair") {
		for _, tag := range norm {
			if tag == "long hair" || tag == "very long hair" || tag == "hair down to floor" {
				drop[tag] = true
			}
		}
	}

	framing := map[string]bool{"full body": true, "cowboy shot": true, "upper body": true, "portrait": true}
	kept := []string{}
	seenFraming := false
	for _, tag := range norm {
		if drop[tag] {
			continue
		}
		if framing[tag] {
			if seenFraming {
				continue
			}
			seenFraming = true
		}
		kept = append(kept, tag)
	}
	return kept
}

func (e *Engine) filterByTier(tags []string, tier int) ([]string, []string) {
	kept := []string{}
	dropped := []string{}
	for _, tag := range tags {
		if tier >= 99 || e.tagLevel(tag) <= tier {
			kept = append(kept, tag)
		} else {
			dropped = append(dropped, tag)
		}
	}
	return kept, dropped
}

func chunkTokens(chunks []*chunk) []string {
	out := []string{}
	for _, item := range chunks {
		out = append(out, item.Tags...)
	}
	return out
}

func applyCap(chunks []*chunk, cap int, dropped *[]string) []*chunk {
	count := func(items []*chunk) int {
		total := 0
		for _, item := range items {
			if !item.NoCap {
				total += len(item.Tags)
			}
		}
		return total
	}
	for count(chunks) > cap {
		var target *chunk
		for index := len(chunks) - 1; index >= 0; index-- {
			item := chunks[index]
			if item.Required || item.NoCap || item.Keep {
				continue
			}
			if len(item.Tags) == 0 {
				continue
			}
			target = item
			break
		}
		if target == nil {
			break
		}
		*dropped = append(*dropped, target.Tags[len(target.Tags)-1])
		target.Tags = target.Tags[:len(target.Tags)-1]
		if len(target.Tags) == 0 {
			filtered := make([]*chunk, 0, len(chunks))
			for _, item := range chunks {
				if item != target {
					filtered = append(filtered, item)
				}
			}
			chunks = filtered
		}
	}
	for count(chunks) > cap {
		trimmed := false
		for index := len(chunks) - 1; index >= 0; index-- {
			item := chunks[index]
			if item.NoCap || item.Keep {
				continue
			}
			if len(item.Tags) > 1 {
				*dropped = append(*dropped, item.Tags[len(item.Tags)-1])
				item.Tags = item.Tags[:len(item.Tags)-1]
				trimmed = true
				break
			}
			if !item.Required && len(item.Tags) > 0 {
				*dropped = append(*dropped, item.Tags...)
				filtered := make([]*chunk, 0, len(chunks))
				for _, other := range chunks {
					if other != item {
						filtered = append(filtered, other)
					}
				}
				chunks = filtered
				trimmed = true
				break
			}
		}
		if !trimmed {
			break
		}
	}
	return chunks
}

func (e *Engine) coreFieldOf(tag string) string {
	normalized := normTag(tag)
	if fields, ok := e.ds.TagFields[normalized]; ok && len(fields) > 0 {
		best := ""
		bestIndex := 99
		for field := range fields {
			index := 99
			for i, name := range coreFieldOrder {
				if name == field {
					index = i
					break
				}
			}
			if index < bestIndex {
				bestIndex = index
				best = field
			}
		}
		return best
	}
	if hairLengthRe.MatchString(normalized) {
		return "hair.length"
	}
	if hairColorRe.MatchString(normalized) {
		return "hair.color"
	}
	if eyeColorRe.MatchString(normalized) {
		return "face.eye_color"
	}
	if styleishRe.MatchString(normalized) {
		return "hair.style"
	}
	if hairAccRe.MatchString(normalized) {
		return "hair.acc"
	}
	if featureRe.MatchString(normalized) {
		return "face.feature"
	}
	return ""
}

func isOutfitTag(tag string) bool {
	return outfitAnyRe.MatchString(tag)
}

func (e *Engine) coreCandidates(char *Character, tier int) []string {
	raw := []string{}
	for _, piece := range tagSplitRe.Split(char.Core, -1) {
		tag := normTag(piece)
		if tag != "" && !countTagRe.MatchString(tag) {
			raw = append(raw, tag)
		}
	}
	kept, _ := e.filterByTier(raw, tier)
	if tier <= 0 {
		filtered := []string{}
		for _, tag := range kept {
			if !coreSFWDeny[tag] {
				filtered = append(filtered, tag)
			}
		}
		kept = filtered
	}
	return dedupe(kept)
}

func (e *Engine) applyCore(roleChars []*Character, tier int, mode string, state State,
	suppressedFields map[string]bool, disabled map[string]bool, notes *[]string,
	locked map[string]bool, outfitStyle string, w *weights) *chunk {

	if mode != "完整核心" || len(roleChars) == 0 {
		return nil
	}
	var chosenChar *Character
	var chosenTags []string
	for _, char := range roleChars {
		tags := e.coreCandidates(char, tier)
		if len(tags) > 0 {
			chosenChar = char
			chosenTags = tags
			break
		}
	}
	if chosenChar == nil {
		*notes = append(*notes, "角色没有 core_tags，回退到发色/瞳色外观")
		return nil
	}

	explicitStyle := outfitStyle != "" && outfitStyle != "随机"
	userOutfit := state.ActiveOutfit != "" || state.Overrides["top"] != "" ||
		state.Overrides["bottom"] != "" || explicitStyle

	fullOutfits := []string{}
	for _, tag := range chosenTags {
		if outfitStrongRe.MatchString(tag) {
			fullOutfits = append(fullOutfits, tag)
		}
	}
	hasCharOutfit := len(fullOutfits) > 0
	for _, tag := range chosenTags {
		if isOutfitTag(tag) {
			hasCharOutfit = true
			break
		}
	}
	useOutfit := hasCharOutfit && !userOutfit
	chosenFull := ""
	if len(fullOutfits) > 0 {
		chosenFull = fullOutfits[0]
	}

	buckets := map[string][]string{}
	outfitTags := []string{}
	extra := []string{}
	for _, tag := range chosenTags {
		field := e.coreFieldOf(tag)
		if field != "" && locked[field] {
			continue
		}
		if w.tagWeight(tag) <= 0 {
			continue
		}
		if field != "" && w.fieldWeight(field) <= 0 {
			continue
		}
		if userOutfit && isOutfitTag(tag) {
			continue
		}
		if state.Overrides["top"] != "" && outfitTopRe.MatchString(tag) {
			continue
		}
		if state.Overrides["bottom"] != "" && outfitBottomRe.MatchString(tag) {
			continue
		}

		if field != "" {
			limit := 1
			if coreMultiFields[field] {
				limit = 2
			}
			if len(buckets[field]) < limit {
				buckets[field] = append(buckets[field], tag)
			} else {
				extra = append(extra, tag)
			}
			continue
		}
		if isOutfitTag(tag) {
			if useOutfit {
				if chosenFull != "" && outfitStrongRe.MatchString(tag) && tag != chosenFull {
					continue
				}
				outfitTags = append(outfitTags, tag)
			}
		} else {
			extra = append(extra, tag)
		}
	}

	for _, other := range roleChars {
		if other == chosenChar {
			continue
		}
		for _, tag := range e.coreCandidates(other, tier) {
			if e.coreFieldOf(tag) != "" || isOutfitTag(tag) {
				continue
			}
			if w.tagWeight(tag) <= 0 {
				continue
			}
			exists := false
			for _, item := range extra {
				if item == tag {
					exists = true
					break
				}
			}
			if !exists {
				extra = append(extra, tag)
			}
		}
	}

	ordered := []string{}
	for _, field := range coreFieldOrder {
		ordered = append(ordered, buckets[field]...)
	}
	ordered = append(ordered, outfitTags...)
	ordered = append(ordered, extra...)
	ordered = dedupe(ordered)
	if len(ordered) == 0 {
		return nil
	}

	for field := range buckets {
		if !locked[field] && w.fieldWeight(field) > 0 {
			suppressedFields[field] = true
		}
	}

	if useOutfit && len(outfitTags) > 0 {
		disabled["outfit"] = true
		disabled["outfit_nsfw"] = true
		*notes = append(*notes, "角色官方服饰接管，服装库已跳过")
	} else if userOutfit && hasCharOutfit {
		*notes = append(*notes, "已启用服装库覆盖，跳过角色官方服饰")
	}

	level := 0
	for _, tag := range ordered {
		if value := e.tagLevel(tag); value > level {
			level = value
		}
	}
	zhName := chosenChar.Zh
	if zhName == "" {
		zhName = chosenChar.Tag
	}
	return &chunk{
		ID: "__character_core__", Zh: []string{zhName}, Tags: ordered,
		Level: level, Required: true, Priority: 2.4, Keep: true,
	}
}

func trimCoreToCap(chunks []*chunk, cap int, suppressedFields map[string]bool, dropped *[]string, e *Engine) []*chunk {
	var core *chunk
	for _, item := range chunks {
		if item.ID == "__character_core__" {
			core = item
			break
		}
	}
	if core == nil {
		return chunks
	}
	prefixIDs := map[string]bool{
		"__quality__": true, "__rating__": true, "count": true,
		"__character__": true, "__artist__": true, "__character_core__": true,
	}
	total := func() int {
		sum := 0
		for _, item := range chunks {
			if prefixIDs[item.ID] || item.Keep {
				sum += len(item.Tags)
			}
		}
		return sum
	}
	for total() > cap && len(core.Tags) > 0 {
		tag := core.Tags[len(core.Tags)-1]
		core.Tags = core.Tags[:len(core.Tags)-1]
		*dropped = append(*dropped, tag)
		field := e.coreFieldOf(tag)
		if field != "" {
			still := false
			for _, rest := range core.Tags {
				if e.coreFieldOf(rest) == field {
					still = true
					break
				}
			}
			if !still {
				delete(suppressedFields, field)
			}
		}
	}
	if len(core.Tags) == 0 {
		filtered := make([]*chunk, 0, len(chunks))
		for _, item := range chunks {
			if item != core {
				filtered = append(filtered, item)
			}
		}
		chunks = filtered
	}
	for total() > cap {
		var target *chunk
		for index := len(chunks) - 1; index >= 0; index-- {
			item := chunks[index]
			if item.ID == "outfit" && len(item.Tags) > 0 {
				target = item
				break
			}
		}
		if target == nil {
			break
		}
		*dropped = append(*dropped, target.Tags[len(target.Tags)-1])
		target.Tags = target.Tags[:len(target.Tags)-1]
		if len(target.Tags) == 0 {
			filtered := make([]*chunk, 0, len(chunks))
			for _, item := range chunks {
				if item != target {
					filtered = append(filtered, item)
				}
			}
			chunks = filtered
		}
	}
	return chunks
}

func estimateTokens(text string) int {
	return maxInt(1, (len([]rune(text))+3)/4)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func splitTokenChunks(tags []string, limit int) [][]string {
	chunks := [][]string{}
	current := []string{}
	used := 0
	for _, tag := range tags {
		cost := (len([]rune(tag)) + 3) / 4
		if cost < 1 {
			cost = 1
		}
		if len(current) > 0 {
			cost++
		}
		if len(current) > 0 && used+cost > limit {
			chunks = append(chunks, current)
			current = []string{tag}
			used = (len([]rune(tag)) + 3) / 4
			if used < 1 {
				used = 1
			}
		} else {
			current = append(current, tag)
			used += cost
		}
	}
	if len(current) > 0 {
		chunks = append(chunks, current)
	}
	if len(chunks) == 0 {
		return [][]string{{}}
	}
	return chunks
}

func negativeFor(profile string, tier int, extra string) string {
	key := profile
	if key == "" {
		key = "自动（按档位）"
	}
	if key == "自动（按档位）" {
		if tier < 2 {
			key = "NoobAI 官方"
		} else {
			key = "NoobAI 官方（不含 nsfw）"
		}
	}
	base := negativeProfiles[key]
	tail := strings.Trim(strings.TrimSpace(extra), ",")
	if base != "" && tail != "" {
		return base + ", " + tail
	}
	if base != "" {
		return base
	}
	return tail
}

func ratingFor(levelKey, qualityName string) string {
	if levelKey == "any" {
		return ""
	}
	table := ratingNoobAI
	if strings.Contains(qualityName, "WAI") {
		table = ratingWAI
	}
	return table[levelKey]
}

// Roll 按档位抽取一段提示词。
func (e *Engine) Roll(params map[string]interface{}) map[string]interface{} {
	e.mu.Lock()
	defer e.mu.Unlock()

	levelKey := asString(params["nsfw_level"], "sfw")
	if _, ok := LevelNum[levelKey]; !ok {
		levelKey = "sfw"
	}
	tier := LevelNum[levelKey]

	rawSeed := asInt(params["seed"], -1)
	var seed int
	var rng *rand.Rand
	seedAuto := false
	if rawSeed < 0 {
		seed = int(time.Now().UnixNano()%2147483645) + 1
		rng = rand.New(rand.NewSource(int64(seed)))
		seedAuto = true
	} else {
		seed = rawSeed
		rng = rand.New(rand.NewSource(int64(seed)))
	}

	baseProb := asFloat(params["base_prob"], 0.6)
	if baseProb < 0 {
		baseProb = 0
	}
	if baseProb > 1 {
		baseProb = 1
	}
	appearanceMode := asString(params["appearance_mode"], "完整核心")
	if appearanceMode != "完整核心" && appearanceMode != "仅发色瞳色" && appearanceMode != "关闭" {
		appearanceMode = "完整核心"
	}
	if !asBool(params["appearance_follow"], true) {
		appearanceMode = "关闭"
	}
	outfitProb := float64(asInt(params["outfit_prob"], 60)) / 100
	if outfitProb < 0 {
		outfitProb = 0
	}
	if outfitProb > 1 {
		outfitProb = 1
	}
	avoidRepeat := asBool(params["avoid_repeat"], false)
	negativeProfile := asString(params["negative_profile"], "自动（按档位）")
	negativeExtra := asString(params["negative_extra"], "")
	ratingOn := asBool(params["rating_tag"], true)
	avoidOutfit := ""
	avoidScene := ""
	if avoidRepeat {
		avoidOutfit = e.lastOutfit
		avoidScene = e.lastScene
	}
	tagCap := resolveTagCap(params["tag_cap"], tier)
	w := parseWeights(params["weights_json"])

	disabled := map[string]bool{}
	for _, item := range strings.Split(asString(params["disabled_sections"], ""), ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			disabled[trimmed] = true
		}
	}
	lockFields := map[string]bool{}
	for _, item := range strings.Split(asString(params["lock_fields"], ""), ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			lockFields[trimmed] = true
			if _, exists := w.Fields[trimmed]; !exists {
				w.Fields[trimmed] = 3
			}
		}
	}

	notes := []string{}
	dropped := []string{}
	forcedSlots := map[string]slotValue{}
	suppressedSlots := map[string]bool{}
	suppressedFields := map[string]bool{}
	chunkMap := map[string]*chunk{}

	roleInputs := e.splitRoles(asString(params["selected_roles"], ""))
	if len(roleInputs) == 0 {
		roleInputs = e.splitRoles(asString(params["force_role"], ""))
	}
	roleChars := []*Character{}
	unknownRoles := []string{}
	if len(roleInputs) > 0 {
		roleChars, unknownRoles = e.matchCharacters(roleInputs)
	}
	if len(roleChars) == 0 && len(unknownRoles) == 0 && asBool(params["role_pick"], false) {
		pool := make([]*Character, 0, len(e.ds.Characters))
		works := map[string]bool{}
		for _, item := range e.splitRoles(asString(params["role_works"], "")) {
			works[normTag(item)] = true
		}
		for i := range e.ds.Characters {
			char := &e.ds.Characters[i]
			if len(works) > 0 && !works[normTag(char.Work)] && !works[normTag(char.WorkZh)] {
				continue
			}
			if char.Level <= tier {
				pool = append(pool, char)
			}
		}
		if len(pool) > 0 {
			roleChars = []*Character{pool[rng.Intn(len(pool))]}
		}
	}
	if len(roleChars) > 2 {
		roleChars = roleChars[:2]
		notes = append(notes, "角色超过 2 位，已截断")
	}

	roleTags := []string{}
	roleZh := []string{}
	appearanceTags := []string{}
	for _, char := range roleChars {
		roleTags = append(roleTags, splitTags(char.Tag)...)
		if char.Work != "" {
			roleTags = append(roleTags, splitTags(char.Work)...)
		}
		name := char.Zh
		if name == "" {
			name = char.Tag
		}
		roleZh = append(roleZh, name)
	}
	for _, raw := range unknownRoles {
		roleTags = append(roleTags, splitTags(raw)...)
		roleZh = append(roleZh, raw)
	}

	state := e.state.clone()
	if value, ok := params["active_outfit"]; ok {
		state.ActiveOutfit = asString(value, "")
	}
	if overrides, ok := params["overrides"].(map[string]interface{}); ok {
		if state.Overrides == nil {
			state.Overrides = map[string]string{}
		}
		for _, key := range []string{"top", "bottom"} {
			if value, exists := overrides[key]; exists {
				state.Overrides[key] = asString(value, "")
			}
		}
	}

	for _, char := range roleChars {
		if strings.Contains(char.Core, "1boy") {
			suppressedFields["body.breasts"] = true
			suppressedFields["makeup.lips"] = true
			suppressedFields["makeup.eyes"] = true
			suppressedFields["makeup.detail"] = true
			break
		}
	}
	var coreChunk *chunk
	if len(roleChars) > 0 && appearanceMode == "完整核心" {
		coreChunk = e.applyCore(roleChars, tier, appearanceMode, state, suppressedFields,
			disabled, &notes, lockFields, asString(params["outfit_style"], "随机"), w)
	}
	if len(roleChars) > 0 && coreChunk == nil && appearanceMode != "关闭" {
		for _, char := range roleChars {
			for _, tag := range char.Appearance {
				normalized := normTag(tag)
				if normalized == "" {
					continue
				}
				if e.tagIsHairColor(normalized) {
					if _, exists := forcedSlots["hair.color"]; !exists {
						forcedSlots["hair.color"] = slotValue{Zh: char.Zh, Tags: normalized, Level: char.Level}
					}
				} else if e.tagIsEyeColor(normalized) {
					if _, exists := forcedSlots["face.eye_color"]; !exists {
						forcedSlots["face.eye_color"] = slotValue{Zh: char.Zh, Tags: normalized, Level: char.Level}
					}
				} else {
					appearanceTags = append(appearanceTags, splitTags(normalized)...)
				}
			}
			for _, tag := range char.Outfit {
				appearanceTags = append(appearanceTags, splitTags(tag)...)
			}
		}
	}

	scene := e.resolveScene(rng, tier, asBool(params["scene_pick"], false),
		asString(params["pick_pool_ids"], ""), avoidScene)
	sceneZh := ""
	sceneExtra := []string{}
	sceneTagSet := map[string]bool{}
	if scene != nil {
		sceneZh = scene.Zh
		if sceneZh == "" {
			sceneZh = scene.ID
		}
		for slot, value := range scene.Tags {
			if slot == "extra" {
				sceneExtra = append(sceneExtra, splitTags(value)...)
				continue
			}
			forcedSlots[slot] = slotValue{Zh: sceneZh, Tags: value, Level: scene.Level}
			for _, tag := range splitTags(value) {
				sceneTagSet[tag] = true
			}
		}
		sceneExtra = append(sceneExtra, splitTags(scene.Extra)...)
		for _, tag := range sceneExtra {
			sceneTagSet[tag] = true
		}
	}

	var outfit *Outfit
	if !disabled["outfit"] {
		outfit = e.resolveOutfit(rng, tier, asString(params["outfit_style"], "随机"),
			state, outfitProb, avoidOutfit)
	}
	outfitZh := ""
	outfitTagSet := map[string]bool{}
	outfitCoreSet := map[string]bool{}
	if outfit != nil {
		outfitZh = outfit.Zh
		if outfitZh == "" {
			outfitZh = outfit.ID
		}
		for slot, value := range outfit.Tags {
			forcedSlots[slot] = slotValue{Zh: outfitZh, Tags: value, Level: outfit.Level}
			for _, tag := range splitTags(value) {
				outfitTagSet[tag] = true
			}
			if slot == "top" || slot == "bottom" || slot == "dress" || slot == "outer" {
				for _, tag := range splitTags(value) {
					outfitCoreSet[tag] = true
				}
			}
		}
		if _, exists := outfit.Tags["dress"]; exists {
			suppressedSlots["top"] = true
			suppressedSlots["bottom"] = true
		} else if _, top := outfit.Tags["top"]; top {
			suppressedSlots["dress"] = true
		} else if _, bottom := outfit.Tags["bottom"]; bottom {
			suppressedSlots["dress"] = true
		}
	}
	if state.Overrides["top"] != "" {
		forcedSlots["top"] = slotValue{Zh: "上装覆盖", Tags: state.Overrides["top"], Level: e.tagLevel(state.Overrides["top"])}
		suppressedSlots["dress"] = true
	}
	if state.Overrides["bottom"] != "" {
		forcedSlots["bottom"] = slotValue{Zh: "下装覆盖", Tags: state.Overrides["bottom"], Level: e.tagLevel(state.Overrides["bottom"])}
		suppressedSlots["dress"] = true
	}

	// lazypos 是 Lazy Embedding 的正向质量词（Illustrious / NoobAI / SDXL 通用），
	// 固定放在正向词最前面；无论画质预设怎么选（包括「不加画质串」）都保留。
	chunkMap["__lazypos__"] = &chunk{
		ID: "__lazypos__", Zh: []string{"lazypos 必加"}, Tags: []string{"lazypos"},
		Required: true, Keep: true, NoCap: true,
	}

	qualityName := asString(params["quality_profile"], "NoobAI 标准")
	qualityText, ok := qualityTags(qualityName)
	if !ok {
		qualityText = QualityProfiles[0].Tags
	}
	qualityTagsList := splitTags(qualityText)
	if len(qualityTagsList) > 0 {
		zh := []string{}
		if qualityName != "不加画质串" {
			zh = []string{qualityName}
		}
		chunkMap["__quality__"] = &chunk{
			ID: "__quality__", Zh: zh, Tags: qualityTagsList, Level: 0,
			Required: true, Priority: -100, Keep: true,
		}
	}

	ratingTag := ""
	if ratingOn {
		ratingTag = ratingFor(levelKey, qualityName)
	}
	if ratingTag != "" {
		chunkMap["__rating__"] = &chunk{
			ID: "__rating__", Zh: []string{}, Tags: []string{ratingTag},
			Level: e.tagLevel(ratingTag), Required: true, Priority: -99, Keep: true,
		}
	}

	var countOverride *slotValue
	if len(roleChars) >= 2 {
		males := 0
		for _, char := range roleChars {
			if strings.Contains(char.Core, "1boy") {
				males++
			}
		}
		if males == len(roleChars) {
			countOverride = &slotValue{Zh: "双男", Tags: "2boys"}
		} else if males > 0 {
			countOverride = &slotValue{Zh: "一男一女", Tags: "1boy, 1girl"}
		} else {
			countOverride = &slotValue{Zh: "双女", Tags: "2girls"}
		}
	}

	for _, section := range e.ds.Sections {
		result := e.processSection(rng, section, tier, w, forcedSlots, suppressedSlots,
			baseProb, disabled, suppressedFields)
		if result == nil {
			continue
		}
		if section.ID == "outfit" {
			result.Keep = true
		}
		chunkMap[section.ID] = result
	}

	subjectZh := e.countSubjectLabels()
	subjectTags := e.countSubjectTags()
	if countOverride != nil {
		base := chunkMap["count"]
		if base == nil {
			base = &chunk{ID: "count", Required: true, Priority: 1}
		}
		keep := []string{}
		for _, tag := range base.Tags {
			if !subjectTags[tag] {
				keep = append(keep, tag)
			}
		}
		zhKeep := []string{}
		for _, zh := range base.Zh {
			if !subjectZh[zh] {
				zhKeep = append(zhKeep, zh)
			}
		}
		chunkMap["count"] = &chunk{
			ID: "count", Tags: append(splitTags(countOverride.Tags), keep...),
			Zh: append([]string{countOverride.Zh}, zhKeep...), Level: 0,
			Required: true, Priority: base.Priority, Keep: true, NoCap: base.NoCap,
			Fields: base.Fields,
		}
	} else if len(roleChars) > 0 {
		base := chunkMap["count"]
		if base != nil {
			isMale := false
			for _, char := range roleChars {
				if strings.Contains(char.Core, "1boy") {
					isMale = true
					break
				}
			}
			countTag := "1girl"
			countZh := "单人少女"
			if isMale {
				countTag = "1boy"
				countZh = "单人男主"
			}
			keep := []string{}
			for _, tag := range base.Tags {
				if !subjectTags[tag] {
					keep = append(keep, tag)
				}
			}
			zhKeep := []string{}
			for _, zh := range base.Zh {
				if !subjectZh[zh] {
					zhKeep = append(zhKeep, zh)
				}
			}
			chunkMap["count"] = &chunk{
				ID: "count", Tags: append([]string{countTag, "solo"}, keep...),
				Zh: append([]string{countZh}, zhKeep...), Level: 0,
				Required: true, Priority: base.Priority, Keep: true, NoCap: base.NoCap,
				Fields: base.Fields,
			}
		}
	}

	if len(roleTags) > 0 {
		chunkMap["__character__"] = &chunk{
			ID: "__character__", Zh: roleZh, Tags: dedupe(roleTags), Level: 0,
			Required: true, Priority: 1.5, Keep: true,
		}
	}

	// 画师块（紧随角色块之后，优先级 1.8）
	artistInputs := e.splitRoles(asString(params["selected_artists"], ""))
	if len(artistInputs) == 0 {
		artistInputs = e.splitRoles(asString(params["force_artist"], ""))
	}
	var artistItems []map[string]string
	if len(artistInputs) > 0 {
		for _, raw := range artistInputs {
			rawL := strings.ToLower(normTag(raw))
			if hit, ok := e.ds.ArtistIndexByTag[rawL]; ok {
				artistItems = append(artistItems, map[string]string{
					"tag": hit.Tag,
					"zh":  hit.Zh,
				})
			} else {
				artistItems = append(artistItems, map[string]string{
					"tag": raw,
					"zh":  raw,
				})
			}
		}
	} else if asBool(params["artist_pick"], false) {
		artistScope := strings.ToLower(asString(params["artist_scope"], "curated"))
		var artistPool []*Artist
		if artistScope == "all" {
			artistPool = e.ds.ArtistIndexRows
		} else {
			for i := range e.ds.Artists {
				artistPool = append(artistPool, &e.ds.Artists[i])
			}
		}
		artStyle := asString(params["artist_style"], "随机")
		if artStyle != "" && artStyle != "随机" && artStyle != "不限" && artStyle != "全部" {
			var filtered []*Artist
			for _, a := range artistPool {
				if a.Style == artStyle {
					filtered = append(filtered, a)
				}
			}
			if len(filtered) > 0 {
				artistPool = filtered
			}
		}
		if len(artistPool) > 0 {
			chosen := artistPool[rng.Intn(len(artistPool))]
			artistItems = append(artistItems, map[string]string{
				"tag": chosen.Tag,
				"zh":  chosen.Zh,
			})
		}
	}

	var artistTags []string
	var artistZh []string
	for _, a := range artistItems {
		artistTags = append(artistTags, splitTags(a["tag"])...)
		zh := a["zh"]
		if zh == "" {
			zh = a["tag"]
		}
		artistZh = append(artistZh, zh)
	}

	if len(artistTags) > 0 {
		var zhList []string
		for _, z := range artistZh {
			zhList = append(zhList, "画师: "+z)
		}
		chunkMap["__artist__"] = &chunk{
			ID:       "__artist__",
			Zh:       zhList,
			Tags:     dedupe(artistTags),
			Level:    0,
			Required: true,
			Priority: 1.8,
			Keep:     true,
			Fields:   []string{},
			NoCap:    false,
		}
		delete(chunkMap, "artist")
	}

	if coreChunk != nil {
		chunkMap["__character_core__"] = coreChunk
	}
	if len(appearanceTags) > 0 {
		appearanceTags = dedupe(appearanceTags)
		level := 0
		for _, tag := range appearanceTags {
			if value := e.tagLevel(tag); value > level {
				level = value
			}
		}
		chunkMap["__appearance__"] = &chunk{
			ID: "__appearance__", Zh: []string{}, Tags: appearanceTags,
			Level: level, Required: true, Priority: 2.5,
		}
	}
	if len(sceneExtra) > 0 {
		level := 0
		zh := []string{}
		if scene != nil {
			level = scene.Level
			if sceneZh != "" {
				zh = []string{sceneZh}
			}
		}
		chunkMap["__scene_extra__"] = &chunk{
			ID: "__scene_extra__", Zh: zh, Tags: dedupe(sceneExtra),
			Level: level, Priority: 10.5,
		}
	}

	extraTags := splitTags(asString(params["extra_body"], ""))
	if len(extraTags) > 0 {
		kept, removed := e.filterByTier(extraTags, tier)
		if len(removed) > 0 {
			dropped = append(dropped, removed...)
			notes = append(notes, "extra_body 有 "+itoa(len(removed))+" 个标签超出档位，已剔除")
		}
		if len(kept) > 0 {
			level := 0
			for _, tag := range kept {
				if value := e.tagLevel(tag); value > level {
					level = value
				}
			}
			chunkMap["__extra__"] = &chunk{
				ID: "__extra__", Zh: []string{}, Tags: kept, Level: level,
				Required: true, Priority: 99, NoCap: true,
			}
		}
	}

	order := []string{
		"__lazypos__", "__quality__", "__rating__", "quality", "count", "__character__",
		"__artist__", "artist",
		"__character_core__", "hair", "face", "body",
		"makeup", "outfit", "outfit_nsfw", "pose", "__appearance__", "pose_nsfw",
		"scene", "__scene_extra__", "lighting", "camera", "style", "__extra__",
	}
	chunks := []*chunk{}
	used := map[string]bool{}
	for _, key := range order {
		if item, ok := chunkMap[key]; ok {
			chunks = append(chunks, item)
			used[key] = true
		}
	}
	leftovers := []string{}
	for key := range chunkMap {
		if !used[key] {
			leftovers = append(leftovers, key)
		}
	}
	sort.Strings(leftovers)
	for _, key := range leftovers {
		chunks = append(chunks, chunkMap[key])
	}

	chunks = trimCoreToCap(chunks, tagCap, suppressedFields, &dropped, e)

	cleanChunks := []*chunk{}
	for _, item := range chunks {
		kept, removed := e.filterByTier(item.Tags, tier)
		if len(removed) > 0 {
			if item.Required {
				notes = append(notes, item.ID+" 含 "+itoa(len(removed))+" 个超档标签，已剔除")
			}
			dropped = append(dropped, removed...)
		}
		if len(kept) > 0 {
			item.Tags = kept
			cleanChunks = append(cleanChunks, item)
		}
	}

	flat := applyMutex(chunkTokens(cleanChunks))
	remaining := append([]string{}, flat...)
	for _, item := range cleanChunks {
		newTags := []string{}
		for _, tag := range item.Tags {
			normalized := normTag(tag)
			for index, rest := range remaining {
				if rest == normalized {
					newTags = append(newTags, normalized)
					remaining = append(remaining[:index], remaining[index+1:]...)
					break
				}
			}
		}
		item.Tags = dedupe(newTags)
	}
	filteredChunks := make([]*chunk, 0, len(cleanChunks))
	for _, item := range cleanChunks {
		if len(item.Tags) > 0 {
			filteredChunks = append(filteredChunks, item)
		}
	}
	cleanChunks = filteredChunks

	cleanChunks = applyCap(cleanChunks, tagCap, &dropped)

	tags := dedupe(chunkTokens(cleanChunks))
	text := strings.Join(tags, ", ")

	tokensEst := estimateTokens(text)
	tokenChunks := splitTokenChunks(tags, tokenLimit)
	tokenWarn := tokensEst > tokenLimit
	if tokenWarn {
		notes = append(notes, "提示词约 "+itoa(tokensEst)+" token，超过 75，已分 "+
			itoa(len(tokenChunks))+" 段")
	}
	negative := negativeFor(negativeProfile, tier, negativeExtra)
	if avoidRepeat {
		e.lastOutfit = ""
		e.lastScene = ""
		if outfit != nil {
			e.lastOutfit = outfit.ID
		}
		if scene != nil {
			e.lastScene = scene.ID
		}
	}

	realLevel := 0
	for _, item := range cleanChunks {
		if item.Level > realLevel {
			realLevel = item.Level
		}
	}
	for _, tag := range tags {
		if value := e.tagLevel(tag); value > realLevel {
			realLevel = value
		}
	}
	if realLevel > tier && tier < 99 {
		notes = append(notes, "成品档位 "+levelLabel(realLevel)+" 高于目标 "+levelLabel(tier))
	}

	checks := []map[string]interface{}{
		{"id": "quality", "ok": chunkMap["__quality__"] != nil, "msg": "画质串"},
		{"id": "count", "ok": chunkMap["count"] != nil, "msg": "人数与取景"},
		{"id": "dedupe", "ok": len(tags) == len(uniqueStrings(tags)), "msg": "重复标签"},
		{"id": "level", "ok": realLevel <= tier || tier >= 99,
			"msg": "落档 " + levelLabel(realLevel) + " / 目标 " + levelLabel(tier)},
		{"id": "cap", "ok": len(tags) <= tagCap || anyNoCap(cleanChunks),
			"msg": "标签 " + itoa(len(tags)) + " / 上限 " + itoa(tagCap)},
		{"id": "conflict", "ok": true, "msg": "互斥"},
	}
	okCount := 0
	for _, check := range checks {
		if check["ok"].(bool) {
			okCount++
		}
	}

	sectionsUsed := []string{}
	for _, item := range cleanChunks {
		if !strings.HasPrefix(item.ID, "__") {
			sectionsUsed = append(sectionsUsed, item.ID)
		}
	}
	coreUsed := false
	for _, item := range cleanChunks {
		if item.ID == "__character_core__" {
			coreUsed = true
			break
		}
	}
	coreDropped := 0
	for _, tag := range dropped {
		if e.coreFieldOf(tag) != "" {
			coreDropped++
		}
	}

	report := map[string]interface{}{
		"target_level":     levelKey,
		"target_num":       tier,
		"real_level":       realLevel,
		"level_label":      levelLabel(realLevel),
		"n":                len(tags),
		"sections_used":    sectionsUsed,
		"checks":           checks,
		"ok_f":             okCount,
		"total_f":          len(checks),
		"seed":             seed,
		"seed_auto":        seedAuto,
		"tag_cap":          tagCap,
		"dropped":          dedupe(dropped),
		"notes":            notes,
		"core_mode":        appearanceMode,
		"core_used":        coreUsed,
		"core_dropped":     coreDropped,
		"rating":           ratingTag,
		"negative_profile": negativeProfile,
		"tokens_est":       tokensEst,
		"token_warn":       tokenWarn,
		"chunks_n":         len(tokenChunks),
		"outfit_prob":      int(outfitProb*100 + 0.5),
		"outfit_id":        outfitID(outfit),
		"scene_id":         sceneID(scene),
		"avoid_repeat":     avoidRepeat,
		"avoid_hit":        avoidRepeat && (avoidOutfit != "" || avoidScene != ""),
		"version":          Version,
	}

	picked := map[string][]string{}
	for _, item := range cleanChunks {
		picked[item.ID] = item.Fields
	}

	cnSummary := e.summary(cleanChunks, roleZh, sceneZh, outfitZh, sceneTagSet, outfitTagSet, tags)
	if outfitZh != "" && len(outfitCoreSet) > 0 {
		hit := false
		for tag := range outfitCoreSet {
			if containsString(tags, tag) {
				hit = true
				break
			}
		}
		if !hit {
			cnSummary = strings.Replace(cnSummary, outfitZh+" · ", "", 1)
			cnSummary = strings.Replace(cnSummary, " · "+outfitZh, "", 1)
		}
	}

	chunksText := []string{}
	for _, item := range tokenChunks {
		chunksText = append(chunksText, strings.Join(item, ", "))
	}

	return map[string]interface{}{
		"text":        text,
		"report":      report,
		"level":       levelKey,
		"cn_summary":  cnSummary,
		"tags":        tags,
		"picked":      picked,
		"negative":    negative,
		"chunks":      tokenChunks,
		"chunks_text": strings.Join(chunksText, "\n"),
	}
}

func (e *Engine) summary(chunks []*chunk, roleZh []string, sceneZh, outfitZh string,
	sceneTags, outfitTags map[string]bool, finalTags []string) string {

	finalSet := map[string]bool{}
	for _, tag := range finalTags {
		finalSet[tag] = true
	}
	if outfitZh != "" && len(outfitTags) > 0 {
		hit := false
		for tag := range outfitTags {
			if finalSet[tag] {
				hit = true
				break
			}
		}
		if !hit {
			outfitZh = ""
		}
	}
	if sceneZh != "" && len(sceneTags) > 0 {
		hit := false
		for tag := range sceneTags {
			if finalSet[tag] {
				hit = true
				break
			}
		}
		if !hit {
			sceneZh = ""
		}
	}
	items := []string{}
	for _, value := range roleZh {
		if value != "" {
			items = append(items, value)
		}
	}
	if outfitZh != "" {
		items = append(items, outfitZh)
	}
	if sceneZh != "" {
		items = append(items, sceneZh)
	}
	for _, item := range chunks {
		for _, zh := range item.Zh {
			if zh != "" && !containsString(items, zh) {
				items = append(items, zh)
			}
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		if seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	if len(out) > 14 {
		out = out[:14]
	}
	return strings.Join(out, " · ")
}

// Assemble 拼接台：随机正文 + 手写补充按槽位序合并。
func (e *Engine) Assemble(main, supplement, mode, maxLevel string) string {
	mainText := strings.TrimRight(strings.TrimSpace(main), ",")
	supText := strings.TrimRight(strings.TrimSpace(supplement), ",")
	if mode == "仅透传 main" || supText == "" {
		return mainText
	}
	if mode == "追加到末尾" || mode == "" {
		if mainText == "" {
			return supText
		}
		return mainText + ", " + supText
	}
	tags := dedupe(append(splitTags(mainText), splitTags(supText)...))
	tags = applyMutex(tags)
	if maxLevel != "不限" && maxLevel != "" {
		level := levelNum(maxLevel)
		filtered := []string{}
		for _, tag := range tags {
			if e.tagLevel(tag) <= level {
				filtered = append(filtered, tag)
			}
		}
		tags = filtered
	}
	return strings.Join(tags, ", ")
}

// ── 小工具 ─────────────────────────────────────────────────────────────
func outfitID(outfit *Outfit) string {
	if outfit == nil {
		return ""
	}
	return outfit.ID
}

func sceneID(scene *Scene) string {
	if scene == nil {
		return ""
	}
	return scene.ID
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func uniqueStrings(items []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		if !seen[item] {
			seen[item] = true
			out = append(out, item)
		}
	}
	return out
}

func anyNoCap(chunks []*chunk) bool {
	for _, item := range chunks {
		if item.NoCap {
			return true
		}
	}
	return false
}

func itoa(value int) string {
	return jsonNumber(float64(value))
}
