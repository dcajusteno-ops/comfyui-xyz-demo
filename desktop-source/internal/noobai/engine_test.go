package noobai

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

var (
	testDSOnce sync.Once
	testDS     *Dataset
	testDSErr  error
)

func testDataset(t *testing.T) *Dataset {
	t.Helper()
	testDSOnce.Do(func() {
		fsys, err := EmbeddedFS()
		if err != nil {
			testDSErr = err
			return
		}
		testDS, testDSErr = loadDataset(fsys)
	})
	if testDSErr != nil {
		t.Fatalf("加载词库失败: %v", testDSErr)
	}
	return testDS
}

func newTestEngine(t *testing.T) *Engine {
	t.Helper()
	return NewEngine(testDataset(t), DefaultState(), nil)
}

func roll(t *testing.T, engine *Engine, params map[string]interface{}) map[string]interface{} {
	t.Helper()
	base := map[string]interface{}{
		"nsfw_level":        "sfw",
		"seed":              1,
		"tag_cap":           "自动",
		"base_prob":         0.6,
		"quality_profile":   "NoobAI 标准",
		"outfit_style":      "随机",
		"outfit_prob":       60,
		"appearance_follow": true,
		"appearance_mode":   "完整核心",
		"negative_profile":  "自动（按档位）",
		"rating_tag":        true,
	}
	for key, value := range params {
		base[key] = value
	}
	return engine.Roll(base)
}

func reportOf(t *testing.T, result map[string]interface{}) map[string]interface{} {
	t.Helper()
	report, ok := result["report"].(map[string]interface{})
	if !ok {
		t.Fatalf("report 类型异常: %T", result["report"])
	}
	return report
}

func tagsOf(t *testing.T, result map[string]interface{}) []string {
	t.Helper()
	tags, ok := result["tags"].([]string)
	if !ok {
		t.Fatalf("tags 类型异常: %T", result["tags"])
	}
	return tags
}

func tagSet(tags []string) map[string]bool {
	out := map[string]bool{}
	for _, tag := range tags {
		out[tag] = true
	}
	return out
}

func TestDataScale(t *testing.T) {
	ds := testDataset(t)
	if len(ds.Sections) != 15 {
		t.Fatalf("段落数 = %d, want 15", len(ds.Sections))
	}
	options := 0
	fields := 0
	for _, section := range ds.Sections {
		fields += len(section.Fields)
		for _, field := range section.Fields {
			options += len(field.Opts)
		}
	}
	if options != 3018 {
		t.Fatalf("选项数 = %d, want 3018", options)
	}
	if fields != 52 {
		t.Fatalf("字段数 = %d, want 52", fields)
	}
	if len(ds.Characters) != 754 {
		t.Fatalf("精选角色 = %d, want 754", len(ds.Characters))
	}
	if len(ds.Works) != 154 {
		t.Fatalf("作品数 = %d, want 154", len(ds.Works))
	}
	if ds.ArtistCount != 600 {
		t.Fatalf("精选画师 = %d, want 600", ds.ArtistCount)
	}
	if ds.ArtistIndexCount < 42000 {
		t.Fatalf("全量画师索引 = %d, want >= 42000", ds.ArtistIndexCount)
	}
	if len(ds.ArtistStyles) != 6 {
		t.Fatalf("画师风格分类 = %d, want 6", len(ds.ArtistStyles))
	}
	if len(ds.Outfits) != 381 {
		t.Fatalf("服装 = %d, want 381", len(ds.Outfits))
	}
	if len(ds.Scenes) != 457 {
		t.Fatalf("场景 = %d, want 457", len(ds.Scenes))
	}
	if ds.IndexCount < 14000 {
		t.Fatalf("全量角色索引 = %d, want >= 14000", ds.IndexCount)
	}
	for index, id := range SectionOrder {
		if ds.Sections[index].ID != id {
			t.Fatalf("段落顺序错误: %s != %s", ds.Sections[index].ID, id)
		}
	}
}

func TestPinyinInitials(t *testing.T) {
	cases := map[string]string{
		"钟离": "zl", "飞霄": "fx", "初音未来": "cywl", "博丽灵梦": "bllm",
		"纳西妲": "nxd", "芙宁娜": "fnn",
	}
	for name, want := range cases {
		if got := pinyinInitials(name); got != want {
			t.Fatalf("pinyinInitials(%q) = %q, want %q", name, got, want)
		}
	}
	ds := testDataset(t)
	for _, char := range ds.Characters {
		if char.Zh != "" && char.PinyinAbbr == "" {
			t.Fatalf("角色 %s 缺少拼音首字母", char.Zh)
		}
	}
}

func TestCharacterSearchAliases(t *testing.T) {
	ds := testDataset(t)
	cases := map[string]string{
		"zl": "zhongli", "金闪闪": "gilgamesh", "红A": "emiya", "散兵": "wanderer",
		"5t5": "gojo", "兵长": "levi", "波奇酱": "gotou hitori", "海哥": "alhaitham",
	}
	for query, want := range cases {
		result := ds.searchCharacters(query, "", 120, 0)
		found := false
		for _, char := range result["characters"].([]*Character) {
			if strings.Contains(char.Tag, want) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("搜索 %q 未命中 %s", query, want)
		}
	}
}

func TestTagLevelIndex(t *testing.T) {
	engine := newTestEngine(t)
	cases := map[string]int{
		"nude": 2, "bikini": 1, "sex": 3, "gangbang": 4,
		"black hair": 0, "masterpiece": 0,
	}
	for tag, want := range cases {
		if got := engine.tagLevel(tag); got < want {
			t.Fatalf("tagLevel(%q) = %d, want >= %d", tag, got, want)
		}
	}
	if got := engine.tagLevel("black hair"); got != 0 {
		t.Fatalf("tagLevel(black hair) = %d, want 0", got)
	}
}

func TestLevelGating(t *testing.T) {
	engine := newTestEngine(t)
	for tier, level := range []string{"sfw", "suggestive"} {
		for seed := 1000; seed < 1012; seed++ {
			result := roll(t, engine, map[string]interface{}{"nsfw_level": level, "seed": seed})
			for _, tag := range tagsOf(t, result) {
				if got := engine.tagLevel(tag); got > tier {
					t.Fatalf("%s 档出现超档 tag %q (level %d)", level, tag, got)
				}
			}
		}
	}
}

func TestSFWBlocksNSFW(t *testing.T) {
	engine := newTestEngine(t)
	banned := []string{
		"nude", "topless", "bottomless", "bikini", "lingerie", "panties",
		"bra", "sex", "fellatio", "bondage", "nipples", "cleavage",
	}
	for seed := 5000; seed < 5020; seed++ {
		set := tagSet(tagsOf(t, roll(t, engine, map[string]interface{}{"seed": seed})))
		for _, tag := range banned {
			if set[tag] {
				t.Fatalf("sfw 出现 %q", tag)
			}
		}
	}
}

func TestDeterminism(t *testing.T) {
	engine := newTestEngine(t)
	a := roll(t, engine, map[string]interface{}{"nsfw_level": "suggestive", "seed": 2026})
	b := roll(t, engine, map[string]interface{}{"nsfw_level": "suggestive", "seed": 2026})
	if a["text"] != b["text"] {
		t.Fatalf("相同 seed 文本不一致:\n%s\n%s", a["text"], b["text"])
	}
	c := roll(t, engine, map[string]interface{}{"nsfw_level": "suggestive", "seed": 2027})
	if a["text"] == c["text"] {
		t.Fatalf("不同 seed 文本相同")
	}
}

func TestTagCap(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{"seed": 77, "tag_cap": "24"})
	report := reportOf(t, result)
	// lazypos 是必加的固定质量词（NoCap），允许在标签上限之外多占一位。
	if report["n"].(int) > 25 {
		t.Fatalf("标签数 %d 超过上限 24 + lazypos", report["n"])
	}
	if len(tagsOf(t, result)) > 25 {
		t.Fatalf("标签数超过上限 24 + lazypos")
	}
}

func TestExtraBodyLevelFilter(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{"seed": 9, "extra_body": "nude, smile"})
	set := tagSet(tagsOf(t, result))
	if !set["smile"] {
		t.Fatalf("手写补充 smile 未出现")
	}
	if set["nude"] {
		t.Fatalf("sfw 下手写补充 nude 未被剔除")
	}
	notes := reportOf(t, result)["notes"].([]string)
	if len(notes) == 0 {
		t.Fatalf("剔除超档标签后应写入 notes")
	}
}

func TestSelectedRole(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{"seed": 11, "selected_roles": "shinomiya kaguya"})
	set := tagSet(tagsOf(t, result))
	for _, tag := range []string{"shinomiya kaguya", "kaguya-sama wa kokurasetai", "black hair", "red eyes"} {
		if !set[tag] {
			t.Fatalf("指定角色缺少 %q: %v", tag, tagsOf(t, result))
		}
	}
}

func TestTwoRolesForce2Girls(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{
		"seed": 12, "selected_roles": "shinomiya kaguya|fujiwara chika",
	})
	set := tagSet(tagsOf(t, result))
	if !set["2girls"] || set["1girl"] || set["solo"] {
		t.Fatalf("双角色人数未收敛为 2girls: %v", tagsOf(t, result))
	}
}

func TestShortRoleName(t *testing.T) {
	engine := newTestEngine(t)
	for seed := 0; seed < 10; seed++ {
		result := roll(t, engine, map[string]interface{}{"seed": seed, "selected_roles": "kafka"})
		set := tagSet(tagsOf(t, result))
		if !set["kafka (honkai: star rail)"] {
			t.Fatalf("短名 kafka 未命中角色")
		}
		if !set["1girl"] || !set["solo"] {
			t.Fatalf("单角色人数未收敛: %v", tagsOf(t, result))
		}
	}
}

func TestCoreInjectionAndModes(t *testing.T) {
	engine := newTestEngine(t)
	full := roll(t, engine, map[string]interface{}{"seed": 1, "selected_roles": "shinomiya kaguya"})
	fullSet := tagSet(tagsOf(t, full))
	for _, tag := range []string{"short hair", "parted bangs", "hair ribbon", "black hair", "red eyes"} {
		if !fullSet[tag] {
			t.Fatalf("完整核心缺少 %q", tag)
		}
	}
	if fullSet["long hair"] {
		t.Fatalf("完整核心与随机发长冲突")
	}
	if !reportOf(t, full)["core_used"].(bool) {
		t.Fatalf("完整核心未标记注入")
	}

	color := roll(t, engine, map[string]interface{}{
		"seed": 1, "selected_roles": "shinomiya kaguya", "appearance_mode": "仅发色瞳色",
	})
	if tagSet(tagsOf(t, color))["folded ponytail"] {
		t.Fatalf("仅发色瞳色模式不应注入核心")
	}
	off := roll(t, engine, map[string]interface{}{
		"seed": 1, "selected_roles": "shinomiya kaguya", "appearance_follow": false,
	})
	if tagSet(tagsOf(t, off))["folded ponytail"] {
		t.Fatalf("关闭角色还原后不应注入核心")
	}
}

func TestNegativeProfiles(t *testing.T) {
	engine := newTestEngine(t)
	cases := []struct {
		profile string
		extra   string
		want    string
	}{
		{"NoobAI 官方", "", "worst quality"},
		{"WAI 官方", "", "bad quality"},
		{"不加负面", "", ""},
		{"自定义追加", "foo, bar", "foo, bar"},
	}
	for _, item := range cases {
		result := roll(t, engine, map[string]interface{}{
			"seed": 2, "negative_profile": item.profile, "negative_extra": item.extra,
		})
		negative := result["negative"].(string)
		if item.want == "" {
			if negative != "" {
				t.Fatalf("%s 负向词应为空，得到 %q", item.profile, negative)
			}
		} else if !strings.Contains(negative, item.want) {
			t.Fatalf("%s 负向词缺少 %q: %q", item.profile, item.want, negative)
		}
	}
}

// lazypos 是用户指定必加的质量词（Lazy Embedding），
// 无论画质预设怎么选（包括「不加画质串」）都要放在正向词最前面。
func TestLazyposAlwaysFirst(t *testing.T) {
	engine := newTestEngine(t)
	for _, profile := range []string{"", "不加画质串", "极简", "NoobAI 精细"} {
		params := map[string]interface{}{"seed": 7}
		if profile != "" {
			params["quality_profile"] = profile
		}
		tags := tagsOf(t, roll(t, engine, params))
		if len(tags) == 0 || tags[0] != "lazypos" {
			t.Fatalf("画质预设 %q 下 lazypos 不在最前: %v", profile, tags)
		}
	}
}

func TestRatingTags(t *testing.T) {
	engine := newTestEngine(t)
	sfw := roll(t, engine, map[string]interface{}{"seed": 3})
	if !tagSet(tagsOf(t, sfw))["safe"] {
		t.Fatalf("sfw 缺少 safe 评分")
	}
	off := roll(t, engine, map[string]interface{}{"seed": 3, "rating_tag": false})
	if tagSet(tagsOf(t, off))["safe"] {
		t.Fatalf("关闭评分后仍出现 safe")
	}
	if ratingFor("any", "NoobAI 标准") != "" {
		t.Fatalf("any 档不应输出评分")
	}
	if ratingFor("suggestive", "WAI Illustrious") != "sensitive" {
		t.Fatalf("WAI 档位评分不匹配")
	}
}

func TestTokensAndChunks(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{"seed": 4})
	chunks := result["chunks"].([][]string)
	flat := []string{}
	for _, chunk := range chunks {
		flat = append(flat, chunk...)
	}
	if !reflect.DeepEqual(flat, tagsOf(t, result)) {
		t.Fatalf("分块拼接与 tags 不一致")
	}
	if len(chunks) < 1 {
		t.Fatalf("至少应有 1 个分块")
	}
	if reportOf(t, result)["tokens_est"].(int) <= 0 {
		t.Fatalf("token 估算异常")
	}
}

func TestOutfitProbability(t *testing.T) {
	engine := newTestEngine(t)
	for seed := 0; seed < 6; seed++ {
		result := roll(t, engine, map[string]interface{}{"seed": seed, "outfit_prob": 0})
		if reportOf(t, result)["outfit_id"].(string) != "" {
			t.Fatalf("outfit_prob=0 仍抽到服装")
		}
	}
	for seed := 0; seed < 6; seed++ {
		result := roll(t, engine, map[string]interface{}{"seed": seed, "outfit_prob": 100})
		if reportOf(t, result)["outfit_id"].(string) == "" {
			t.Fatalf("outfit_prob=100 未抽到服装")
		}
	}
}

func TestAvoidRepeat(t *testing.T) {
	engine := newTestEngine(t)
	first := roll(t, engine, map[string]interface{}{
		"seed": 1, "avoid_repeat": true, "outfit_prob": 100, "scene_pick": true,
	})
	second := roll(t, engine, map[string]interface{}{
		"seed": 2, "avoid_repeat": true, "outfit_prob": 100, "scene_pick": true,
	})
	firstReport := reportOf(t, first)
	secondReport := reportOf(t, second)
	if firstReport["outfit_id"] == secondReport["outfit_id"] {
		t.Fatalf("避免连抽未生效（服装）")
	}
	if firstReport["scene_id"] == secondReport["scene_id"] {
		t.Fatalf("避免连抽未生效（场景）")
	}
	if !secondReport["avoid_hit"].(bool) {
		t.Fatalf("第二次抽取未标记 avoid_hit")
	}
}

func TestScenePick(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{
		"seed": 13, "pick_pool_ids": "sc_cafe_window", "pick_pool_mode": "scene",
	})
	set := tagSet(tagsOf(t, result))
	for _, tag := range []string{"cafe", "window light", "sitting"} {
		if !set[tag] {
			t.Fatalf("指定场景缺少 %q", tag)
		}
	}
	if !strings.Contains(result["cn_summary"].(string), "咖啡店窗边") {
		t.Fatalf("中文摘要缺少场景名: %s", result["cn_summary"])
	}
}

func TestOutfitStyle(t *testing.T) {
	engine := newTestEngine(t)
	school := map[string]bool{}
	for _, outfit := range engine.ds.Outfits {
		if outfit.Cat != "school" {
			continue
		}
		for _, value := range outfit.Tags {
			for _, tag := range splitTags(value) {
				school[tag] = true
			}
		}
	}
	hit := false
	for seed := 14; seed < 20; seed++ {
		set := tagSet(tagsOf(t, roll(t, engine, map[string]interface{}{"seed": seed, "outfit_style": "校园"})))
		for tag := range school {
			if set[tag] {
				hit = true
				break
			}
		}
		if hit {
			break
		}
	}
	if !hit {
		t.Fatalf("校园风格未抽到校园套装标签")
	}
}

func TestQualityProfiles(t *testing.T) {
	engine := newTestEngine(t)
	minimal := roll(t, engine, map[string]interface{}{"seed": 15, "quality_profile": "极简"})
	// lazypos 固定在最前，画质串紧跟其后。
	if !strings.HasPrefix(minimal["text"].(string), "lazypos, best quality") {
		t.Fatalf("极简画质未置顶（lazypos 之后）")
	}
	none := roll(t, engine, map[string]interface{}{"seed": 15, "quality_profile": "不加画质串"})
	text := none["text"].(string)
	if strings.Contains(text, "best quality") {
		t.Fatalf("不加画质串仍出现画质前缀")
	}
	if !strings.HasPrefix(text, "lazypos") {
		t.Fatalf("不加画质串时 lazypos 仍应在最前")
	}
}

func TestLockOption(t *testing.T) {
	engine := newTestEngine(t)
	weightsJSON, _ := json.Marshal(map[string]interface{}{
		"options": map[string]float64{"hair.color|silver hair": 3},
	})
	result := roll(t, engine, map[string]interface{}{"seed": 17, "weights_json": string(weightsJSON)})
	if !tagSet(tagsOf(t, result))["silver hair"] {
		t.Fatalf("锁定选项未生效")
	}
}

func TestDisableOutfitSection(t *testing.T) {
	engine := newTestEngine(t)
	outfitTags := map[string]bool{}
	for _, outfit := range engine.ds.Outfits {
		for slot, value := range outfit.Tags {
			if slot == "accessory" {
				continue
			}
			for _, tag := range splitTags(value) {
				outfitTags[tag] = true
			}
		}
	}
	weightsJSON, _ := json.Marshal(map[string]interface{}{
		"sections": map[string]float64{"outfit": 0},
	})
	result := roll(t, engine, map[string]interface{}{"seed": 16, "weights_json": string(weightsJSON)})
	for _, tag := range tagsOf(t, result) {
		if outfitTags[tag] {
			t.Fatalf("关闭服装段后仍出现 %q", tag)
		}
	}
}

func TestCoreYieldsToActiveOutfit(t *testing.T) {
	engine := newTestEngine(t)
	if _, err := engine.UpdateState(map[string]interface{}{"active_outfit": "sailor_uniform"}); err != nil {
		t.Fatalf("保存状态失败: %v", err)
	}
	defer engine.UpdateState(map[string]interface{}{"active_outfit": ""}) //nolint:errcheck
	result := roll(t, engine, map[string]interface{}{"seed": 5, "selected_roles": "shinomiya kaguya"})
	set := tagSet(tagsOf(t, result))
	if !set["serafuku"] {
		t.Fatalf("启用套装后缺少 serafuku: %v", tagsOf(t, result))
	}
	if set["shuuchiin academy school uniform"] {
		t.Fatalf("启用套装后仍注入角色校服")
	}
	if !set["black hair"] || !set["red eyes"] {
		t.Fatalf("角色发色瞳色被误删")
	}
	notes := strings.Join(reportOf(t, result)["notes"].([]string), " ")
	if !strings.Contains(notes, "已启用服装库覆盖") {
		t.Fatalf("缺少覆盖提示: %s", notes)
	}
}

func TestCoreYieldsToLockedField(t *testing.T) {
	engine := newTestEngine(t)
	result := roll(t, engine, map[string]interface{}{
		"seed": 5, "selected_roles": "shinomiya kaguya", "lock_fields": "hair.length",
	})
	set := tagSet(tagsOf(t, result))
	if set["short hair"] {
		t.Fatalf("锁定 hair.length 后仍注入角色短发")
	}
	hasHairLength := false
	for _, tag := range []string{
		"long hair", "medium hair", "very long hair", "high twintails", "twintails",
		"low twintails", "single braid", "twin braids", "ponytail", "side ponytail",
		"high ponytail", "low ponytail", "braided hair", "updo",
	} {
		if set[tag] {
			hasHairLength = true
			break
		}
	}
	if !hasHairLength {
		t.Fatalf("锁定的 hair.length 未随机渲染: %v", result["tags"])
	}
}

func TestHairColorOverride(t *testing.T) {
	engine := newTestEngine(t)
	weightsJSON, _ := json.Marshal(map[string]interface{}{
		"options": map[string]float64{"hair.color|blonde hair": 3},
	})
	result := roll(t, engine, map[string]interface{}{
		"seed": 1740538225, "selected_roles": "firefly (honkai: star rail)",
		"lock_fields": "hair.color", "weights_json": string(weightsJSON),
	})
	set := tagSet(tagsOf(t, result))
	if !set["blonde hair"] || set["grey hair"] {
		t.Fatalf("发色覆盖未生效")
	}
}

func TestMaxTwoPersons(t *testing.T) {
	engine := newTestEngine(t)
	banned := []string{
		"3girls", "4girls", "5girls", "6+girls", "3boys", "group",
		"multiple girls", "multiple boys",
	}
	for seed := 0; seed < 20; seed++ {
		set := tagSet(tagsOf(t, roll(t, engine, map[string]interface{}{"seed": seed})))
		for _, tag := range banned {
			if set[tag] {
				t.Fatalf("出现超过 2 人的 tag %q", tag)
			}
		}
	}
}

func TestAssemble(t *testing.T) {
	engine := newTestEngine(t)
	cases := []struct {
		main, supplement, mode, maxLevel, want string
	}{
		{"1girl, solo", "red eyes, 1girl", "合并去重", "", "1girl, solo, red eyes"},
		{"1girl, solo", "", "合并去重", "", "1girl, solo"},
		{"1girl, solo", "nude", "合并去重", "sfw", "1girl, solo"},
		{"1girl", "smile", "仅透传 main", "", "1girl"},
	}
	for _, item := range cases {
		if got := engine.Assemble(item.main, item.supplement, item.mode, item.maxLevel); got != item.want {
			t.Fatalf("Assemble(%q, %q, %q, %q) = %q, want %q",
				item.main, item.supplement, item.mode, item.maxLevel, got, item.want)
		}
	}
}

func TestStatePersistence(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")
	engine := NewEngine(testDataset(t), DefaultState(), func(next State) error {
		return saveState(statePath, next)
	})
	if _, err := engine.UpdateState(map[string]interface{}{
		"active_outfit":  "maid_classic",
		"overrides":      map[string]interface{}{"top": "white shirt"},
		"char_favorites": []interface{}{"a", "a", "b"},
		"recent_chars":   []interface{}{"1", "2"},
	}); err != nil {
		t.Fatalf("更新状态失败: %v", err)
	}
	state := loadState(statePath)
	if state.ActiveOutfit != "maid_classic" {
		t.Fatalf("active_outfit 未持久化")
	}
	if state.Overrides["top"] != "white shirt" {
		t.Fatalf("overrides 未持久化")
	}
	if !reflect.DeepEqual(state.CharFavorites, []string{"a", "b"}) {
		t.Fatalf("收藏去重异常: %v", state.CharFavorites)
	}
	if len(state.RecentChars) != 2 {
		t.Fatalf("最近使用异常: %v", state.RecentChars)
	}
}

func TestHealthPayload(t *testing.T) {
	ds := testDataset(t)
	health := ds.healthPayload()
	counts := health["counts"].(map[string]int)
	if counts["sections"] != 15 || counts["characters"] != 754 ||
		counts["outfits"] != 381 || counts["scenes"] != 457 ||
		counts["artists"] != 600 || counts["artist_index"] < 42000 {
		t.Fatalf("health 计数异常: %v", counts)
	}
	if counts["options"] != 3018 {
		t.Fatalf("health 选项数异常: %d", counts["options"])
	}
}

func TestArtistsData(t *testing.T) {
	ds := testDataset(t)
	payload := ds.artistsPayload()
	if payload["count"] != 600 {
		t.Fatalf("artists payload count = %v, want 600", payload["count"])
	}
	styles := payload["styles"].([]string)
	if len(styles) != 6 {
		t.Fatalf("styles count = %d, want 6", len(styles))
	}
	for _, a := range ds.Artists {
		if a.Tag == "" {
			t.Fatalf("artist tag empty: %+v", a)
		}
		if a.Zh == "" {
			t.Fatalf("artist zh empty: %+v", a)
		}
		if a.PostCount < 50 {
			t.Fatalf("artist post count < 50: %+v", a)
		}
		if a.PinyinAbbr == "" {
			t.Fatalf("artist pinyin abbr empty: %+v", a)
		}
	}
}

func TestArtistIndexAndSearch(t *testing.T) {
	ds := testDataset(t)
	if ds.ArtistIndexCount < 42000 {
		t.Fatalf("artist index count = %d, want >= 42000", ds.ArtistIndexCount)
	}
	// 英文搜索
	resWlop := ds.searchArtists("wlop", "", "", "", 5, 0)
	if resWlop["total"].(int) == 0 {
		t.Fatalf("search wlop got 0")
	}
	wlopArtists := resWlop["artists"].([]*Artist)
	foundWlop := false
	for _, a := range wlopArtists {
		if strings.Contains(strings.ToLower(a.Tag), "wlop") {
			foundWlop = true
			break
		}
	}
	if !foundWlop {
		t.Fatalf("wlop not found in search results: %v", resWlop)
	}

	// 中文/拼音搜索
	resCilo := ds.searchArtists("ciloranko", "", "", "", 5, 0)
	if resCilo["total"].(int) == 0 {
		t.Fatalf("search ciloranko got 0")
	}
	ciloArtists := resCilo["artists"].([]*Artist)
	foundCilo := false
	for _, a := range ciloArtists {
		if strings.Contains(strings.ToLower(a.Tag), "ciloranko") {
			foundCilo = true
			break
		}
	}
	if !foundCilo {
		t.Fatalf("ciloranko not found in search results: %v", resCilo)
	}
}

func TestArtistRoll(t *testing.T) {
	engine := newTestEngine(t)

	// 随机抽取画师
	resPick := engine.Roll(map[string]interface{}{
		"nsfw_level":   "sfw",
		"artist_pick":  true,
		"artist_style": "唯美厚涂",
		"seed":         42,
	})
	cnSummary := resPick["cn_summary"].(string)
	if !strings.Contains(cnSummary, "画师:") {
		t.Fatalf("artist_pick cn_summary does not contain 画师:: %s", cnSummary)
	}

	// 指定画师
	resForce := engine.Roll(map[string]interface{}{
		"nsfw_level":       "sfw",
		"selected_artists": "wlop, ciloranko",
		"seed":             42,
	})
	text := resForce["text"].(string)
	if !strings.Contains(text, "wlop") {
		t.Fatalf("force artist text does not contain wlop: %s", text)
	}
	if !strings.Contains(text, "ciloranko") {
		t.Fatalf("force artist text does not contain ciloranko: %s", text)
	}
	forceSummary := resForce["cn_summary"].(string)
	if !strings.Contains(forceSummary, "画师: WLOP (王凌)") {
		t.Fatalf("forceSummary does not contain 画师: WLOP (王凌): %s", forceSummary)
	}
	if !strings.Contains(forceSummary, "画师: Ciloranko") {
		t.Fatalf("forceSummary does not contain 画师: Ciloranko: %s", forceSummary)
	}

	// 画师在 prompt 中的位置应在角色之后、身体/发型之前
	posCount := strings.Index(text, "1girl")
	posArtist := strings.Index(text, "wlop")
	posHair := strings.Index(text, "hair")
	if posCount != -1 && posHair != -1 {
		if posCount >= posArtist {
			t.Fatalf("posCount (%d) >= posArtist (%d)", posCount, posArtist)
		}
		if posArtist >= posHair {
			t.Fatalf("posArtist (%d) >= posHair (%d)", posArtist, posHair)
		}
	}
}
