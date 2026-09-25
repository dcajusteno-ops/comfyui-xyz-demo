/**
 * 手机上传识别任务的纯逻辑（无 Node/BOM 依赖，可被浏览器与服务端共用、可直接单测）。
 */

export type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array;
};

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const CRLF = new Uint8Array([13, 10]);
const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);

function decodeFilename(raw: string): string {
  if (raw.includes("%")) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * 极简 multipart/form-data 解析：浏览器 fetch FormData 上传的标准格式。
 * boundary 取自 Content-Type 头。仅支持平铺字段（文件 + 文本字段），够本功能使用。
 */
export function parseMultipart(raw: Uint8Array, boundary: string): MultipartPart[] {
  const delim = new TextEncoder().encode(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = indexOf(raw, delim);
  if (cursor === -1) return parts;
  cursor += delim.length;
  // 首行 boundary 后必须是 --（空请求）或 \r\n
  if (raw[cursor] === 45 && raw[cursor + 1] === 45) return parts;
  cursor += 2;

  while (cursor < raw.length) {
    const headerEnd = indexOf(raw, CRLFCRLF, cursor);
    if (headerEnd === -1) break;
    const headers = new TextDecoder("utf-8").decode(raw.slice(cursor, headerEnd));
    const bodyStart = headerEnd + 4;

    const needle = new Uint8Array(CRLF.length + delim.length);
    needle.set(CRLF, 0);
    needle.set(delim, CRLF.length);
    const nextDelim = indexOf(raw, needle, bodyStart);
    if (nextDelim === -1) break;

    const part: MultipartPart = { name: "", data: raw.slice(bodyStart, nextDelim) };
    for (const line of headers.split("\r\n")) {
      if (line.startsWith("Content-Disposition:")) {
        const nameMatch = line.match(/name="([^"]*)"/);
        if (nameMatch) part.name = nameMatch[1];
        const fileMatch = line.match(/filename="([^"]*)"/);
        if (fileMatch) part.filename = decodeFilename(fileMatch[1]);
      }
      if (line.startsWith("Content-Type:")) {
        part.contentType = line.split(":").slice(1).join(":").trim();
      }
    }
    parts.push(part);

    cursor = nextDelim + needle.length;
    if (raw[cursor] === 45 && raw[cursor + 1] === 45) break; // 结束 boundary "--"
    cursor += 2; // 跳过该段后的 \r\n
  }
  return parts;
}

type HistoryOutputs = Record<string, unknown>;

/**
 * 从 ComfyUI history 中提取文本结果（对齐 comfyClient.extractHistory 的取值规则：
 * 依次查找 text/texts/STRING/string/tags/csv 字段，兼容字符串与数组两种形态）。
 */
export function extractTextsFromHistory(
  history: Record<string, { outputs?: HistoryOutputs } | undefined>,
  promptId?: string,
): string[] {
  const entry = promptId ? history[promptId] : Object.values(history)[0];
  const raw: string[] = [];
  if (!entry?.outputs) return raw;

  const pushValue = (value: unknown) => {
    if (Array.isArray(value)) {
      const valid = value.filter((v): v is string | number => typeof v === "string" || typeof v === "number");
      if (valid.length === 0) return;
      if (valid.length > 1 && valid.every((v) => typeof v === "string" && v.length === 1)) {
        raw.push(valid.join(""));
      } else {
        raw.push(...valid.map(String));
      }
    } else if (typeof value === "string" || typeof value === "number") {
      const strValue = String(value);
      if (strValue.trim().length > 0) raw.push(strValue);
    }
  };

  for (const output of Object.values(entry.outputs)) {
    for (const key of ["text", "texts", "STRING", "string", "tags", "csv"]) {
      if (output && typeof output === "object" && key in output) {
        pushValue((output as Record<string, unknown>)[key]);
      }
    }
  }

  // WD14 节点自身的 tags 输出与 Save Text 节点的 text 输出内容相同，按内容去重（保序）
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (!seen.has(t)) {
      seen.add(t);
      texts.push(t);
    }
  }
  return texts;
}