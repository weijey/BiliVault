// Bilibili Obsidian Clipper — Service Worker
// Phase A: load core dependencies via importScripts

try {
  importScripts(
    "core/utils.js",
    "core/bilibili-api.js",
    "core/subtitle-fetcher.js",
    "core/markdown-builder.js",
    "core/obsidian-client.js",
    "core/subtitle-cache.js"
  );
} catch (e) {
  console.error("[BOC] Failed to load core dependencies:", e);
}

const DEFAULT_SYNC_SETTINGS = {
  noteFolder: "Clippings/Bilibili",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  tags: "clippings,bilibili",
  downloadFormat: "srt",
  includeDateInFilename: true,
  includeTimestampInBody: true,
  enableDebugLogs: false,
  frontmatterFields: [
    "title", "url", "bvid", "cid", "author",
    "upload_date", "subtitle_lang", "created", "tags"
  ],
  fixedFrontmatterProperties: []
};

const DEFAULT_LOCAL_SETTINGS = { obsidianApiKey: "" };

chrome.runtime.onInstalled.addListener(async () => { await initializeSettingsStorage(); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") { return false; }

  if (message.type === "get-settings") {
    getMergedSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "save-settings") {
    saveSettings(message.settings || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "open-options") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "fetch-json") {
    const url = typeof message.url === "string" ? message.url : "";
    if (!url) { sendResponse({ ok: false, error: "Missing URL" }); return false; }

    const isBiliRequest = /(?:api\.bilibili\.com|hdslb\.com)/.test(url);
    const headers = new Headers();
    headers.set("Accept", "application/json, text/plain, */*");
    headers.set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
    headers.set("Cache-Control", "no-cache");
    headers.set("Pragma", "no-cache");

    const fetchOptions = {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: headers
    };
    if (/space/.test(url)) {
      fetchOptions.referrer = "https://space.bilibili.com/";
    } else if (isBiliRequest) {
      fetchOptions.referrer = "https://www.bilibili.com/";
    }
    fetchOptions.referrerPolicy = "strict-origin-when-cross-origin";

    function doRequest() {
      fetch(url, fetchOptions)
        .then(async (response) => {
          if (!response.ok) {
            sendResponse({ ok: false, error: "HTTP " + response.status });
            return;
          }
          const text = await response.text();
          try {
            sendResponse({ ok: true, data: JSON.parse(text) });
          } catch (e) {
            sendResponse({ ok: false, error: "Invalid JSON: " + text.substring(0, 200) });
          }
        })
        .catch((error) => sendResponse({ ok: false, error: error.message }));
    }

    if (/space/.test(url)) {
      // Space API needs explicit cookie injection due to SameSite
      // Temporarily switch to omit since we manually set Cookie header
      fetchOptions.credentials = "omit";
      chrome.cookies.getAll({}, (allCookies) => {
        if (!chrome.runtime.lastError) {
          const biliCookies = allCookies.filter(c => {
            const d = c.domain;
            return d.includes("bilibili") || d.includes("hdslb");
          });
          const cookieStr = biliCookies.map(c => c.name + "=" + c.value).join("; ");
          if (cookieStr) {
            fetchOptions.headers.set("Cookie", cookieStr);
            fetchOptions.credentials = "omit";
          }
        }
        doRequest();
      });
    } else {
      doRequest();
    }
    return true;
  }

  if (message.type === "write-obsidian-note") {
    const baseUrl = String(message.baseUrl || "").trim();
    const apiKey = String(message.apiKey || "").trim();
    const filepath = String(message.filepath || "").trim();
    const content = typeof message.content === "string" ? message.content : "";

    if (!baseUrl || !apiKey || !filepath) {
      sendResponse({ ok: false, error: "缺少 Local REST API 参数" });
      return false;
    }

    const encodedPath = filepath.split("/").filter(Boolean).map((s) => encodeURIComponent(s)).join("/");
    const endpoint = baseUrl.replace(/\/+$/g, "") + "/vault/" + encodedPath;

    fetch(endpoint, {
      method: "PUT",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "text/markdown; charset=utf-8" },
      body: content
    })
      .then(async (response) => {
        if (!response.ok) {
          const bt = await response.text().catch(() => "");
          sendResponse({ ok: false, error: "HTTP " + response.status + (bt ? " " + bt.slice(0, 200) : "") });
          return;
        }
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "test-obsidian-connection") {
    const baseUrl = String(message.baseUrl || "").trim();
    const apiKey = String(message.apiKey || "").trim();

    if (!baseUrl || !apiKey) {
      sendResponse({ ok: false, error: "缺少 Local REST API 参数" });
      return false;
    }

    fetch(baseUrl.replace(/\/+$/g, "") + "/", {
      method: "GET",
      headers: { Authorization: "Bearer " + apiKey, Accept: "application/json, text/plain, */*" },
      cache: "no-store"
    })
      .then(async (response) => {
        const bt = await response.text().catch(() => "");
        let data = null;
        try { data = bt ? JSON.parse(bt) : null; } catch (e) { data = null; }
        if (!response.ok) {
          sendResponse({ ok: false, error: "HTTP " + response.status + (bt ? " " + bt.slice(0, 200) : "") });
          return;
        }
        if (data && data.authenticated === false) {
          sendResponse({ ok: false, error: "API Key 无效或未授权" });
          return;
        }
        sendResponse({ ok: true, service: (data && data.service) || "Obsidian Local REST API" });
      })
      .catch((error) => {
        const msg = String(error.message || "").trim();
        sendResponse({ ok: false, error: msg.includes("Failed to fetch") ? "无法连接 Local REST API" : msg });
      });
    return true;
  }

  return false;
});

async function initializeSettingsStorage() {
  const syncCurrent = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  const localCurrent = await chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SYNC_SETTINGS, ...syncCurrent });
  await chrome.storage.local.set({ obsidianApiKey: normalizeApiKey(localCurrent.obsidianApiKey) });
  const legacySyncApiKey = normalizeApiKey(syncCurrent.obsidianApiKey);
  const localApiKey = normalizeApiKey(localCurrent.obsidianApiKey);
  if (!localApiKey && legacySyncApiKey) {
    await chrome.storage.local.set({ obsidianApiKey: legacySyncApiKey });
  }
  if ("obsidianApiKey" in syncCurrent) { await chrome.storage.sync.remove("obsidianApiKey"); }
}

async function getMergedSettings() {
  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS),
    chrome.storage.local.get(DEFAULT_LOCAL_SETTINGS)
  ]);
  const merged = { ...DEFAULT_SYNC_SETTINGS, ...syncSettings };
  merged.downloadFormat = normalizeDownloadFormat(merged.downloadFormat);
  merged.fixedFrontmatterProperties = normalizeFixedFrontmatterProperties(merged.fixedFrontmatterProperties);
  let apiKey = normalizeApiKey(localSettings.obsidianApiKey);
  const legacySyncApiKey = normalizeApiKey(syncSettings.obsidianApiKey);
  if (!apiKey && legacySyncApiKey) {
    apiKey = legacySyncApiKey;
    await chrome.storage.local.set({ obsidianApiKey: apiKey });
    await chrome.storage.sync.remove("obsidianApiKey");
  }
  return { ...merged, obsidianApiKey: apiKey };
}

async function saveSettings(settings) {
  const payload = settings && typeof settings === "object" ? settings : {};
  const syncPayload = { ...payload };
  delete syncPayload.obsidianApiKey;
  syncPayload.downloadFormat = normalizeDownloadFormat(syncPayload.downloadFormat);
  syncPayload.fixedFrontmatterProperties = normalizeFixedFrontmatterProperties(syncPayload.fixedFrontmatterProperties);
  await Promise.all([
    chrome.storage.sync.set(syncPayload),
    chrome.storage.local.set({ obsidianApiKey: normalizeApiKey(payload.obsidianApiKey) })
  ]);
}

function toString(value) { return typeof value === "string" ? value : ""; }
function normalizeApiKey(value) { return toString(value).trim().replace(/^Bearer\s+/i, "").trim(); }
function normalizeDownloadFormat(value) { return value === "txt" ? "txt" : "srt"; }

function normalizeFixedFrontmatterProperties(value) {
  if (!Array.isArray(value)) { return []; }
  return value.map((item) => ({
    key: toString(item && item.key).trim(),
    type: normalizeFixedPropertyType(item && item.type),
    value: normalizeFixedPropertyValue(item && item.type, item && item.value)
  })).filter((item) => item.key && !isFixedPropertyRowEffectivelyEmpty(item.type, item.value));
}

function normalizeFixedPropertyType(value) {
  const type = toString(value).trim().toLowerCase();
  return type === "number" || type === "checkbox" || type === "list" ? type : "text";
}

function normalizeFixedPropertyValue(type, value) {
  const normalizedType = normalizeFixedPropertyType(type);
  if (normalizedType === "checkbox") { return toString(value).trim().toLowerCase(); }
  return toString(value).trim();
}

function isFixedPropertyRowEffectivelyEmpty(type, value) { return !toString(value).trim(); }
