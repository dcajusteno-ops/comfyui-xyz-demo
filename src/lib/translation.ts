import CryptoJS from "crypto-js";

export type TranslationProvider = "mymemory" | "baidu" | "aliyun";

export interface TranslationSettings {
  provider: TranslationProvider;
  baiduAppId?: string;
  baiduSecret?: string;
  aliyunAccessKeyId?: string;
  aliyunAccessKeySecret?: string;

}

export const defaultTranslationSettings: TranslationSettings = {
  provider: "mymemory",
};

let localDictionary: any[] | null = null;
let dictionaryPromise: Promise<any[]> | null = null;

async function getLocalDictionary() {
  if (localDictionary) return localDictionary;
  if (dictionaryPromise) return dictionaryPromise;

  dictionaryPromise = fetch("/data/prompt-library/all_prompts_merged.cleaned.json")
    .then(res => res.json())
    .then(data => {
      localDictionary = data;
      return data;
    })
    .catch(err => {
      console.error("Failed to load local dictionary for translation", err);
      return [];
    });
  
  return dictionaryPromise;
}

export async function translateText(text: string, settings: TranslationSettings, direction: "zh2en" | "en2zh" = "zh2en"): Promise<string> {
  if (!text || !text.trim()) return text;

  try {
    const dict = await getLocalDictionary();
    if (dict && dict.length > 0) {
      const lowerText = text.trim().toLowerCase();
      if (direction === "en2zh") {
        const entry = dict.find(e => e.text_en && e.text_en.toLowerCase() === lowerText);
        if (entry && entry.text_zh) {
          return entry.text_zh;
        }
      } else if (direction === "zh2en") {
        const entry = dict.find(e => e.text_zh && e.text_zh.toLowerCase() === lowerText);
        if (entry && entry.text_en) {
          return entry.text_en;
        }
      }
    }
  } catch (err) {
    // Ignore local dictionary errors and fall back to API
  }

  try {
    switch (settings.provider) {
      case "mymemory":
        return await translateMyMemory(text, direction);
      case "baidu":
        return await translateBaidu(text, settings.baiduAppId, settings.baiduSecret, direction);
      case "aliyun":
        return await translateAliyun(text, settings.aliyunAccessKeyId, settings.aliyunAccessKeySecret, direction);

      default:
        return text;
    }
  } catch (error) {
    console.error("Translation Error:", error);
    throw new Error(`翻译失败 (${settings.provider}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function translateMyMemory(text: string, direction: "zh2en" | "en2zh"): Promise<string> {
  const langpair = direction === "zh2en" ? "zh|en" : "en|zh";
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data && data.responseData && data.responseData.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error("MyMemory API 返回格式错误或翻译失败");
}

async function translateBaidu(text: string, appId?: string, secret?: string, direction: "zh2en" | "en2zh" = "zh2en"): Promise<string> {
  if (!appId || !secret) {
    throw new Error("请在设置中配置百度翻译的 App ID 和 Secret");
  }

  const salt = Math.random().toString().slice(2);
  const sign = CryptoJS.MD5(appId + text + salt + secret).toString();

  const url = new URL("https://api.fanyi.baidu.com/api/trans/vip/translate");
  url.searchParams.append("q", text);
  url.searchParams.append("from", direction === "zh2en" ? "zh" : "en");
  url.searchParams.append("to", direction === "zh2en" ? "en" : "zh");
  url.searchParams.append("appid", appId);
  url.searchParams.append("salt", salt);
  url.searchParams.append("sign", sign);

  return new Promise((resolve, reject) => {
    const callbackName = `baidu_translate_cb_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    url.searchParams.append("callback", callbackName);

    const script = document.createElement("script");
    script.src = url.toString();

    const cleanup = () => {
      delete (window as any)[callbackName];
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("百度翻译请求超时"));
    }, 10000);

    (window as any)[callbackName] = (data: any) => {
      clearTimeout(timeout);
      cleanup();
      
      if (data.error_code) {
        reject(new Error(`百度翻译错误: ${data.error_msg || data.error_code}`));
        return;
      }
      if (data.trans_result && data.trans_result.length > 0) {
        resolve(data.trans_result.map((item: any) => item.dst).join("\n"));
        return;
      }
      reject(new Error("百度翻译API返回格式异常"));
    };

    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("百度翻译网络请求失败 (JSONP)"));
    };

    document.body.appendChild(script);
  });
}

async function translateAliyun(text: string, accessKeyId?: string, accessKeySecret?: string, direction: "zh2en" | "en2zh" = "zh2en"): Promise<string> {
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("请在设置中配置阿里云的 AccessKey ID 和 Secret");
  }

  const timestamp = new Date().toISOString();
  const signatureNonce = Math.random().toString().slice(2) + Date.now().toString();

  const params: Record<string, string> = {
    Action: "TranslateGeneral",
    Format: "JSON",
    Version: "2018-10-12",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: signatureNonce,
    SignatureVersion: "1.0",
    AccessKeyId: accessKeyId,
    Timestamp: timestamp,
    SourceLanguage: direction === "zh2en" ? "zh" : "en",
    TargetLanguage: direction === "zh2en" ? "en" : "zh",
    FormatType: "text",
    SourceText: text,
  };

  const aliyunEncode = (str: string) => encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  
  const keys = Object.keys(params).sort();
  const sortedParams = keys.map(k => `${aliyunEncode(k)}=${aliyunEncode(params[k])}`).join("&");

  const stringToSign = "POST&%2F&" + aliyunEncode(sortedParams);
  
  const signature = CryptoJS.HmacSHA1(stringToSign, accessKeySecret + "&").toString(CryptoJS.enc.Base64);
  params["Signature"] = signature;

  const bodyParams = new URLSearchParams();
  for (const k of Object.keys(params)) {
    bodyParams.append(k, params[k]);
  }

  const response = await fetch(`/proxy/aliyun/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyParams.toString(),
  });

  const data = await response.json();
  if (data.Code && data.Code !== "200") {
    throw new Error(`阿里云翻译错误: ${data.Message}`);
  }
  
  if (data.Data && data.Data.Translated) {
    return data.Data.Translated;
  }
  
  throw new Error("阿里云翻译API返回格式异常");
}

