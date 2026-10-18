import { describe, expect, it, vi } from "vitest";
import {
  buildPostsUrl,
  buildSearchTags,
  buildSnapshot,
  chooseImageUrl,
  fetchDanbooruImage,
  fetchRandomDanbooruPost,
  formatDanbooruGroups,
  hasBlockTags,
  isUsableDanbooruPost,
  normalizeDanbooruRating,
  normalizeDanbooruRatings,
  RECOMMENDED_BLOCK_PRESETS,
  splitRatingFromQuery,
  toggleBlockTags,
  type DanbooruPost,
} from "./danbooru";
import { defaultDanbooruSettings } from "./persist";
import type { DanbooruSettings } from "./types";

function post(overrides: Partial<DanbooruPost> = {}): DanbooruPost {
  return {
    id: 123,
    file_ext: "jpg",
    rating: "g",
    tag_string_artist: "dairi",
    tag_string_character: "hatsune_miku",
    tag_string_copyright: "vocaloid",
    tag_string_general: "1girl long_hair smile",
    tag_string_meta: "highres",
    file_url: "https://cdn.donmai.us/original/a.jpg",
    large_file_url: "https://cdn.donmai.us/sample/a.jpg",
    preview_file_url: "https://cdn.donmai.us/preview/a.jpg",
    image_width: 1200,
    image_height: 1600,
    media_asset: {
      variants: [
        { type: "sample", url: "https://cdn.donmai.us/sample/a.jpg" },
        { type: "original", url: "https://cdn.donmai.us/original/a.jpg" },
      ],
    },
    ...overrides,
  };
}

function settings(overrides: Partial<DanbooruSettings> = {}): DanbooruSettings {
  return {
    ...defaultDanbooruSettings,
    ...overrides,
    groups: { ...defaultDanbooruSettings.groups, ...(overrides.groups ?? {}) },
  };
}

describe("Danbooru 查询", () => {
  it("分级多选拼成 rating:g,s，自动追加 random:1 且不重复追加", () => {
    expect(buildSearchTags("", ["g"])).toBe("rating:g random:1");
    expect(buildSearchTags("1girl", ["g"])).toBe("rating:g 1girl random:1");
    expect(buildSearchTags("1girl solo", ["q"])).toBe("rating:q 1girl solo random:1");
    expect(buildSearchTags("1girl random:1", ["s"])).toBe("rating:s 1girl random:1");
  });

  it("多选按 g/s/q/e 顺序拼接并去重", () => {
    expect(buildSearchTags("1girl", ["e", "g"])).toBe("rating:g,e 1girl random:1");
    expect(buildSearchTags("1girl", ["s", "s", "q"])).toBe("rating:s,q 1girl random:1");
  });

  it("一个都没选（不限）时不加 rating 条件", () => {
    expect(buildSearchTags("", [])).toBe("random:1");
    expect(buildSearchTags("1girl", [])).toBe("1girl random:1");
  });

  it("查询串里残留的 rating:* 会被摘掉，以下拉多选为准", () => {
    expect(buildSearchTags("rating:general 1girl", ["e"])).toBe("rating:e 1girl random:1");
    expect(buildSearchTags("1girl rating:explicit", [])).toBe("1girl random:1");
  });

  it("旧存档的 rating:general / rating:g,s 能拆到多选字段", () => {
    expect(splitRatingFromQuery("rating:general")).toEqual({ query: "", ratings: ["g"] });
    expect(splitRatingFromQuery("rating:explicit 1girl solo")).toEqual({ query: "1girl solo", ratings: ["e"] });
    expect(splitRatingFromQuery("rating:g,s 1girl")).toEqual({ query: "1girl", ratings: ["g", "s"] });
    expect(splitRatingFromQuery("rating:any 1girl")).toEqual({ query: "1girl", ratings: [] });
    expect(splitRatingFromQuery("1girl solo")).toEqual({ query: "1girl solo", ratings: [] });
  });

  it("非法分级值被忽略", () => {
    expect(normalizeDanbooruRating("general")).toBe("g");
    expect(normalizeDanbooruRating("E")).toBe("e");
    expect(normalizeDanbooruRating("nope")).toBeUndefined();
    expect(normalizeDanbooruRatings("e,wat,g")).toEqual(["g", "e"]);
    expect(normalizeDanbooruRatings("all")).toEqual([]);
  });

  it("URL 使用 tags 参数而不是 random 查询参数（后者会 302）", () => {
    const url = buildPostsUrl(settings({ query: "1girl", ratings: ["g"] }));
    expect(url).toContain("tags=rating%3Ag%201girl%20random%3A1");
    expect(url).not.toContain("&random=1");
  });
});

describe("Danbooru 推荐屏蔽词", () => {
  it("整组加入后再次点击移除，其他词保持原样", () => {
    const preset = RECOMMENDED_BLOCK_PRESETS[0];
    const added = toggleBlockTags("my_own_tag", preset.tags);
    expect(added).toContain("my_own_tag");
    expect(added).toContain("text");
    expect(hasBlockTags(added, preset.tags)).toBe(true);

    const removed = toggleBlockTags(added, preset.tags);
    expect(removed).toBe("my_own_tag");
    expect(hasBlockTags(removed, preset.tags)).toBe(false);
  });

  it("重复点击不会产生重复词，大小写/下划线按归一化比较", () => {
    const preset = RECOMMENDED_BLOCK_PRESETS[1];
    const once = toggleBlockTags("TEXT, Artist Name", preset.tags);
    const twice = toggleBlockTags(once, preset.tags);
    // 已全部存在时第二次是把整组移除，因此这里只验证第一次没有重复项
    expect(once.split(",").map((tag) => tag.trim()).filter(Boolean)).toHaveLength(
      new Set(once.split(",").map((tag) => tag.trim().toLowerCase().replace(/_/g, " "))).size,
    );
    expect(twice).toContain("TEXT");
  });
});

describe("Danbooru 选图与过滤", () => {
  it("优先 media_asset.variants 对应档位", () => {
    expect(chooseImageUrl(post(), "sample")).toBe("https://cdn.donmai.us/sample/a.jpg");
    expect(chooseImageUrl(post(), "original")).toBe("https://cdn.donmai.us/original/a.jpg");
  });

  it("没有 variants 时按档位回退字段", () => {
    const p = post({ media_asset: undefined });
    expect(chooseImageUrl(p, "sample")).toBe("https://cdn.donmai.us/sample/a.jpg");
    expect(chooseImageUrl(p, "original")).toBe("https://cdn.donmai.us/original/a.jpg");
    expect(chooseImageUrl(p, "180x180")).toBe("https://cdn.donmai.us/preview/a.jpg");
  });

  it("跳过动图、视频、已删除与非静态格式", () => {
    expect(isUsableDanbooruPost(post(), "sample")).toBe(true);
    expect(isUsableDanbooruPost(post({ tag_string_general: "animated 1girl" }), "sample")).toBe(false);
    expect(isUsableDanbooruPost(post({ tag_string_meta: "video" }), "sample")).toBe(false);
    expect(isUsableDanbooruPost(post({ is_deleted: true }), "sample")).toBe(false);
    expect(isUsableDanbooruPost(post({ file_ext: "mp4" }), "sample")).toBe(false);
  });
});

describe("Danbooru 标签格式化", () => {
  it("下划线转空格、画师加 @、按组顺序拼接", () => {
    const { groups, prompt } = formatDanbooruGroups(
      post(),
      settings({ groups: { ...defaultDanbooruSettings.groups, artist: true } }),
    );
    expect(groups.artist).toBe("@dairi");
    expect(groups.character).toBe("hatsune miku");
    expect(groups.general).toBe("1girl, long hair, smile");
    expect(prompt).toBe("@dairi, hatsune miku, vocaloid, 1girl, long hair, smile");
    // meta 默认关闭
    expect(groups.meta).toBe("");
  });

  it("屏蔽默认词与自定义词", () => {
    const p = post({ tag_string_general: "1girl watermark custom_bad" });
    const { groups } = formatDanbooruGroups(
      p,
      settings({ groups: { ...defaultDanbooruSettings.groups, general: true }, blockTags: "custom_bad" }),
    );
    expect(groups.general).toBe("1girl");
  });

  it("组内去重且忽略大小写", () => {
    const p = post({ tag_string_general: "1girl 1girl Smile smile" });
    const { groups } = formatDanbooruGroups(p, settings());
    expect(groups.general).toBe("1girl, smile");
  });

  it("关闭分组后不参与 prompt", () => {
    const p = post();
    const { prompt } = formatDanbooruGroups(
      p,
      settings({ groups: { artist: false, character: false, copyright: false, general: true, meta: false } }),
    );
    expect(prompt).toBe("1girl, long hair, smile");
  });
});

describe("Danbooru 请求", () => {
  it("429 后重试成功", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [post()] });
    const snapshot = await fetchRandomDanbooruPost(
      settings({ groups: { ...defaultDanbooruSettings.groups, artist: true } }),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => undefined,
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(snapshot.id).toBe(123);
    expect(snapshot.prompt).toContain("@dairi");
  });

  it("422 立即失败，不重试", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({}) });
    await expect(
      fetchRandomDanbooruPost(settings(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/422/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("连续抽到不可用作品时重试并在第三次成功", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [post({ tag_string_general: "animated" })] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [post({ id: 456 })] });
    const snapshot = await fetchRandomDanbooruPost(settings(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(snapshot.id).toBe(456);
  });

  it("全部不可用时抛出可读错误", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [post({ tag_string_general: "animated" })],
    });
    await expect(
      fetchRandomDanbooruPost(settings(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async () => undefined,
        attempts: 2,
      }),
    ).rejects.toThrow(/动图或已删除/);
  });
});

describe("Danbooru 快照与下载", () => {
  it("快照包含原帖链接、分组与 prompt", () => {
    const snapshot = buildSnapshot(post(), settings());
    expect(snapshot).not.toBeNull();
    expect(snapshot?.postUrl).toContain("/posts/123");
    expect(snapshot?.groups.general).toBe("1girl, long hair, smile");
  });

  it("快照按档位生成回退列表（sample → 720 → original → preview）", () => {
    const snapshot = buildSnapshot(post(), settings());
    expect(snapshot?.imageUrls?.[0]).toBe("https://cdn.donmai.us/sample/a.jpg");
    expect(snapshot?.imageUrls).toContain("https://cdn.donmai.us/original/a.jpg");
    expect(snapshot?.imageUrls).toContain("https://cdn.donmai.us/preview/a.jpg");
    // 去重：sample/original 在 variants 与字段里各出现一次
    expect(new Set(snapshot?.imageUrls).size).toBe(snapshot?.imageUrls?.length);
  });

  it("超过体积上限的图片拒绝下载", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["x".repeat(100)]),
    });
    await expect(
      fetchDanbooruImage("https://cdn.donmai.us/a.jpg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxBytes: 10,
      }),
    ).rejects.toThrow(/15MB/);
  });
});
