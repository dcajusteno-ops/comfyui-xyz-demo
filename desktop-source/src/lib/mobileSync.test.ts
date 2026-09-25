import { describe, expect, it } from "vitest";
import { extractTextsFromHistory, parseMultipart } from "./mobileSync";

/** 构造浏览器 fetch FormData 上报的标准 multipart 报文 */
function buildMultipart(fields: Array<{ name: string; filename?: string; contentType?: string; body: Uint8Array }>, boundary = "----TestBoundaryXYZ"): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const push = (text: string) => chunks.push(...enc.encode(text));
  for (const field of fields) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${field.name}"`);
    if (field.filename) push(`; filename="${field.filename}"`);
    push("\r\n");
    if (field.contentType) push(`Content-Type: ${field.contentType}\r\n`);
    push("\r\n");
    chunks.push(...field.body);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);
  return new Uint8Array(chunks);
}

describe("parseMultipart", () => {
  it("parses a file field with binary body", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff]);
    const raw = buildMultipart([{ name: "image", filename: "photo.png", contentType: "image/png", body: png }]);
    const parts = parseMultipart(raw, "----TestBoundaryXYZ");
    expect(parts).toHaveLength(1);
    expect(parts[0].name).toBe("image");
    expect(parts[0].filename).toBe("photo.png");
    expect(parts[0].contentType).toBe("image/png");
    expect(Array.from(parts[0].data)).toEqual(Array.from(png));
  });

  it("parses file + text params in one request", () => {
    const raw = buildMultipart([
      { name: "image", filename: "a.jpg", contentType: "image/jpeg", body: new Uint8Array([1, 2, 3]) },
      { name: "params", body: new TextEncoder().encode('{"threshold":0.5}') },
    ]);
    const parts = parseMultipart(raw, "----TestBoundaryXYZ");
    expect(parts.map((p) => p.name)).toEqual(["image", "params"]);
    expect(new TextDecoder().decode(parts[1].data)).toBe('{"threshold":0.5}');
  });

  it("decodes percent-encoded non-ASCII filenames", () => {
    const raw = buildMultipart([
      { name: "image", filename: "%E6%B5%8B%E8%AF%95.png", contentType: "image/png", body: new Uint8Array([1]) },
    ]);
    const parts = parseMultipart(raw, "----TestBoundaryXYZ");
    expect(parts[0].filename).toBe("测试.png");
  });

  it("returns empty for a closing-only request", () => {
    const raw = new TextEncoder().encode("--b--\r\n");
    expect(parseMultipart(raw, "b")).toEqual([]);
  });
});

describe("extractTextsFromHistory", () => {
  it("reads a single-string text output from Save Text node", () => {
    const history = {
      "p1": { outputs: { "4": { text: ["1girl, solo, long hair"] } } },
    };
    expect(extractTextsFromHistory(history, "p1")).toEqual(["1girl, solo, long hair"]);
  });

  it("dedupes identical texts from WD14 node and Save Text node (real ComfyUI shape)", () => {
    // 真实 history：节点 2(WD14Tagger) 输出 tags，节点 4(Save Text) 的 text 为单字符数组，两者内容一致
    const tags = "1girl, solo, long hair, smile, blue eyes";
    const charArray = [...tags];
    const history = {
      "p1": {
        outputs: {
          "2": { tags: [tags] },
          "4": { text: charArray },
        },
      },
    };
    expect(extractTextsFromHistory(history, "p1")).toEqual([tags]);
  });

  it("returns empty when outputs are missing or contain no text", () => {
    expect(extractTextsFromHistory({ "p1": {} }, "p1")).toEqual([]);
    expect(extractTextsFromHistory({ "p1": { outputs: { "3": { images: [{ filename: "a.png" }] } } } }, "p1")).toEqual([]);
  });

  it("handles string value directly and joins single-char arrays", () => {
    const history = { "p1": { outputs: { "5": { text: "tagA, tagB" }, "6": { csv: ["a", "b", "c"] } } } };
    expect(extractTextsFromHistory(history, "p1")).toEqual(["tagA, tagB", "abc"]);
  });
});