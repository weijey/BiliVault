# B站批量知识摄取 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Bilibili Obsidian Clipper 基础上，新增批量抓取能力——从收藏夹/UP主空间选取视频，经筛选管道过滤后，串行抓取字幕并写入 Obsidian raw/ 目录。

**Architecture:** 从 content.js 巨石中抽取 core/ 共享库（BOC.* 全局命名空间），content.js 精简为 UI 壳。新增 batch.html 独立批量页，复用 core 模块。core/api 通过 fetchFn 依赖注入消除 chrome.runtime 直接依赖。

**Tech Stack:** Chrome Manifest V3, vanilla JS (非 ES module), BOC.* 全局命名空间, IndexedDB, Obsidian Local REST API

**审查修正清单（必须在实现中执行）：**

| 来源 | 修正 | 任务 |
|------|------|------|
| architecture-guardian | core/api fetchFn 注入 | Task A2 |
| architecture-guardian | 建立 CIR 作为内部标准表示 | Task A3 |
| systems-thinker | 完成报告暴露编译缺口 | Task B3 |
| systems-thinker | 编译债务上限提示 | Task B3 |
| engineer-advisor | debug 日志脱敏 auth_key | Task C1 |
| engineer-advisor | 预设模板一键开始 | Task B1 |
| engineer-advisor | 环境就绪检查 | Task B3 |

---

## 文件结构（变更后）

```
extension/
├── core/
│   ├── utils.js              # 新增: 公共工具函数
│   ├── bilibili-api.js       # 新增: B站 API 封装 (fetchFn注入)
│   ├── subtitle-fetcher.js   # 新增: 字幕抓取/解析/校验
│   ├── markdown-builder.js   # 新增: Markdown/SRT/TXT构建
│   ├── obsidian-client.js    # 新增: Obsidian API 客户端
│   └── subtitle-cache.js     # 新增: 字幕缓存 (chrome.storage)
├── content/
│   ├── content.js            # 重构: 精简为 UI + 编排
│   └── content.css           # 移动: 从 extension/ 移入
├── batch/
│   ├── batch.html            # 新增: 批量任务页
│   ├── batch.js              # 新增: 批量任务逻辑
│   └── batch.css             # 新增: 批量页面样式
├── popup/
│   ├── popup.html            # 移动
│   ├── popup.js              # 移动
│   └── popup.css             # 移动
├── options/
│   ├── options.html          # 移动
│   ├── options.js            # 移动
│   └── options.css           # 移动
├── background.js             # 重构: importScripts 加载 core
├── manifest.json             # 更新路径
└── icons/                    # 不动
```

---

## Phase 1: Core Extraction (Tasks A1-A9)

### Task A1: Create core/utils.js

**Files:**
- Create: `extension/core/utils.js`

Extract pure utility functions from content.js (no Chrome/DOM dependencies).

- [ ] **Step 1: Create core/utils.js**

```javascript
var BOC = BOC || {};

BOC.DEFAULT_SETTINGS = {
  noteFolder: "Clippings/Bilibili",
  obsidianApiBaseUrl: "http://127.0.0.1:27123",
  obsidianApiKey: "",
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

BOC.BOC_VERSION = "2.0.0";

BOC.utils = BOC.utils || {};

BOC.utils.formatLocalDate = function (value) {
  var date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  return date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
};

BOC.utils.escapeHtml = function (value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

BOC.utils.escapeYaml = function (value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
};

BOC.utils.sanitizeFileName = function (value) {
  return String(value || "untitled")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
};

BOC.utils.toReadableText = function (value, fallback) {
  if (value === undefined || value === null) { return fallback || ""; }
  if (typeof value === "string") {
    var text = value.trim();
    return (!text || text === "[object Object]") ? (fallback || "") : text;
  }
  if (typeof value === "number" || typeof value === "boolean") { return String(value); }
  try {
    var json = JSON.stringify(value);
    if (json && json !== "{}") { return json; }
  } catch (e) { /* ignore */ }
  var text = String(value);
  return (!text || text === "[object Object]") ? (fallback || "") : text;
};

BOC.utils.getErrorMessage = function (error, fallback) {
  var code = BOC.utils.toReadableText(error && error.code, "");
  var message = BOC.utils.toReadableText(error && error.message, "");
  if (message) { return code ? message + " (code: " + code + ")" : message; }
  if (code) { return "code: " + code; }
  return BOC.utils.toReadableText(error, fallback || "未知错误");
};

BOC.utils.isStaleRunError = function (error) {
  return (error && error.code) === "STALE_RUN";
};

BOC.utils.sleep = function (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
};

// Debug logging with auth_key redaction (engineer-advisor P0 fix)
BOC.utils._debugEnabled = false;

BOC.utils.setDebugEnabled = function (enabled) {
  BOC.utils._debugEnabled = Boolean(enabled);
};

BOC.utils._redactUrl = function (url) {
  return String(url || "").replace(/([?&]auth_key=)[^&\s]+/gi, "$1[REDACTED]");
};

BOC.utils.logInfo = function () {
  if (!BOC.utils._debugEnabled) { return; }
  var args = Array.prototype.slice.call(arguments);
  if (args.length > 0 && typeof args[0] === "string") {
    args[0] = BOC.utils._redactUrl(args[0]);
  }
  console.info.apply(console, args);
};

BOC.utils.logWarn = function () {
  if (!BOC.utils._debugEnabled) { return; }
  var args = Array.prototype.slice.call(arguments);
  if (args.length > 0 && typeof args[0] === "string") {
    args[0] = BOC.utils._redactUrl(args[0]);
  }
  console.warn.apply(console, args);
};

BOC.utils.isExtensionContextInvalidated = function (error) {
  var msg = String((error && error.message) || "");
  return msg.indexOf("Extension context invalidated") !== -1;
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/utils.js
```

Expected: no output (syntax valid)

---

### Task A2: Create core/bilibili-api.js (with fetchFn injection)

**Files:**
- Create: `extension/core/bilibili-api.js`

Extract all B站 API logic from content.js. **Key architecture fix:** `createClient(fetchFn)` receives network transport as a dependency, rather than directly calling `chrome.runtime.sendMessage`.

- [ ] **Step 1: Create core/bilibili-api.js**

```javascript
var BOC = BOC || {};
BOC.api = BOC.api || {};

/**
 * Create a Bilibili API client with injected fetch transport.
 * 
 * fetchFn(url) must return a Promise that resolves to the JSON-parsed response body.
 * In browser extension context: BOC.api.createClient(BOC.api._chromeFetch)
 * In Node.js context: BOC.api.createClient(BOC.api._nodeFetch)
 * 
 * This injection eliminates the architecture violation where core logic
 * directly depended on chrome.runtime.sendMessage.
 */
BOC.api.createClient = function (fetchFn) {
  var fetchJson = fetchFn;

  function fetchVideoMeta(bvid) {
    var url = "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
    BOC.utils.logInfo("[BOC] fetch video meta", { url: BOC.utils._redactUrl(url), bvid: bvid });

    return fetchJson(url).then(function (payload) {
      if (payload.code !== 0) {
        throw new Error(BOC.utils.toReadableText(payload && payload.message, "无法获取视频信息"));
      }
      var data = payload.data || {};
      var pubdate = Number(data.pubdate || 0);
      var uploadDate = pubdate > 0 ? BOC.utils.formatLocalDate(pubdate * 1000) : "";
      var pages = Array.isArray(data.pages) ? data.pages : [];

      return {
        aid: data.aid ? String(data.aid) : "",
        title: String(data.title || ""),
        author: String((data.owner && data.owner.name) || ""),
        description: String(data.desc || ""),
        uploadDate: uploadDate,
        defaultCid: data.cid ? String(data.cid) : "",
        defaultDuration: Number(data.duration || 0) || 0,
        pages: pages.map(function (item) {
          return {
            cid: String(item.cid || ""),
            page: Number(item.page || 0) || 0,
            part: String(item.part || "").trim(),
            duration: Number(item.duration || 0) || 0
          };
        })
      };
    });
  }

  function fetchSubtitleBundle(bvid, cid, aid) {
    var requests = BOC.api._buildSubtitleInfoRequests(bvid, cid, aid);

    function fetchByRequest(request) {
      BOC.utils.logInfo("[BOC] fetch subtitles list", {
        source: request.source,
        url: request.url,
        bvid: bvid,
        cid: cid,
        aid: aid
      });

      return fetchJson(request.url).then(function (payload) {
        BOC.utils.logInfo("[BOC] subtitles API raw response", { source: request.source });
        if (payload.code !== 0) {
          throw BOC.api._buildBiliApiError(payload, "无法获取字幕列表");
        }
        var chapters = BOC.api._mapChaptersFromPlayerData(payload.data);
        var subtitles = BOC.api._mapSubtitleTracks(
          (payload.data && payload.data.subtitle && payload.data.subtitle.subtitles) || [],
          request.source
        );
        var withUrl = subtitles.filter(function (item) { return item.subtitleUrl; });
        return { source: request.source, chapters: chapters, withUrl: withUrl };
      });
    }

    if (requests.length === 0) {
      return Promise.resolve({ tracks: [], chapters: [] });
    }

    var primaryRequest = requests[0];
    return fetchByRequest(primaryRequest).then(function (primaryResult) {
      if (primaryResult.withUrl.length > 0) {
        return { tracks: primaryResult.withUrl, chapters: primaryResult.chapters };
      }
      return { tracks: [], chapters: primaryResult.chapters };
    }).catch(function (primaryError) {
      BOC.utils.logWarn("[BOC] subtitles API request failed", {
        source: primaryRequest.source,
        message: BOC.utils.getErrorMessage(primaryError)
      });
      if (requests.length > 1) {
        var secondaryRequest = requests[1];
        return fetchByRequest(secondaryRequest).then(function (secondaryResult) {
          if (secondaryResult.withUrl.length > 0) {
            BOC.utils.logWarn("[BOC] primary subtitles source failed, using fallback", {
              primary: primaryRequest.source,
              fallback: secondaryRequest.source
            });
            return { tracks: secondaryResult.withUrl, chapters: secondaryResult.chapters };
          }
          return { tracks: [], chapters: secondaryResult.chapters };
        }).catch(function (secondaryError) {
          BOC.utils.logWarn("[BOC] fallback subtitles source failed", {
            source: secondaryRequest.source,
            message: BOC.utils.getErrorMessage(secondaryError)
          });
          throw secondaryError;
        });
      }
      throw primaryError;
    });
  }

  function fetchSubtitleBody(url) {
    BOC.utils.logInfo("[BOC] fetch subtitle body", { url: url });
    return fetchJson(BOC.api._normalizeSubtitleUrl(url));
  }

  // Public API
  return {
    fetchVideoMeta: fetchVideoMeta,
    fetchSubtitleBundle: fetchSubtitleBundle,
    fetchSubtitleBody: fetchSubtitleBody
  };
};

// --- Private helpers (also exposed on BOC.api for content.js backward compat) ---

BOC.api._buildSubtitleInfoRequests = function (bvid, cid, aid) {
  var safeBvid = encodeURIComponent(String(bvid || ""));
  var safeCid = encodeURIComponent(String(cid || ""));
  var safeAid = encodeURIComponent(String(aid || ""));
  var requests = [];

  if (aid) {
    requests.push({
      source: "player-wbi-v2",
      url: "https://api.bilibili.com/x/player/wbi/v2" +
        "?aid=" + safeAid + "&cid=" + safeCid +
        (bvid ? "&bvid=" + safeBvid : "")
    });
  }
  requests.push({
    source: "player-v2",
    url: "https://api.bilibili.com/x/player/v2" +
      (bvid ? "?bvid=" + safeBvid : "?") +
      (bvid ? "&" : "") + "cid=" + safeCid +
      (aid ? "&aid=" + safeAid : "")
  });

  return requests;
};

BOC.api._normalizeSubtitleUrl = function (url) {
  if (!url) { return ""; }
  if (url.slice(0, 2) === "//") { return "https:" + url; }
  if (url.slice(0, 7) === "http://" || url.slice(0, 8) === "https://") { return url; }
  return "https://" + url.replace(/^\/+/, "");
};

BOC.api._buildBiliApiError = function (payload, fallbackMessage) {
  var msg = BOC.utils.toReadableText(payload && payload.message, fallbackMessage);
  var error = new Error(msg);
  error.code = payload && payload.code;
  error.retryable = BOC.api._isRetryableErrorCode(payload && payload.code);
  return error;
};

BOC.api._isRetryableErrorCode = function (code) {
  return code === -509 || code === -3 || code < 0;
};

BOC.api._mapSubtitleTracks = function (subtitles, source) {
  source = source || "unknown";
  return (subtitles || []).map(function (item) {
    return {
      id: (item.id === undefined || item.id === null) ? "" : String(item.id),
      lan: item.lan || "",
      lanDoc: item.lan_doc || "",
      subtitleUrl: BOC.api._normalizeSubtitleUrl(item.subtitle_url || ""),
      aiStatus: Number(item.ai_status || 0),
      aiType: Number(item.ai_type || 0),
      source: source
    };
  });
};

BOC.api._mapChaptersFromPlayerData = function (data) {
  var raw = Array.isArray(data && data.view_points) ? data.view_points : [];
  return (raw || []).map(function (item) {
    return {
      title: String(item.content || item.title || item.label || "").trim(),
      from: BOC.api._normalizeChapterTime(item.from !== undefined ? item.from : (item.start !== undefined ? item.start : item.start_time)),
      to: BOC.api._normalizeChapterTime(item.to !== undefined ? item.to : (item.end !== undefined ? item.end : item.end_time)),
      source: "player-view-points"
    };
  });
};

BOC.api._normalizeChapterTime = function (value) {
  if (value === undefined || value === null || value === "") { return 0; }
  var num = Number(value);
  if (!isFinite(num) || num < 0) { return 0; }
  return num > 86400 ? num / 1000 : num;
};

// Page helpers for multi-P videos
BOC.api.extractBvid = function (url) {
  var match = url.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (match && match[1]) { return match[1]; }
  try {
    var parsed = new URL(url);
    var fromQuery = String(parsed.searchParams.get("bvid") || "").trim();
    if (/^BV[0-9A-Za-z]+$/.test(fromQuery)) { return fromQuery; }
  } catch (e) { /* ignore */ }
  return "";
};

BOC.api.extractPageIndex = function (url) {
  try {
    var page = Number(new URL(url).searchParams.get("p") || "1");
    if (!isFinite(page) || page <= 0) { return 1; }
    return page;
  } catch (e) { return 1; }
};

BOC.api.extractOid = function (url) {
  try { return String(new URL(url).searchParams.get("oid") || "").trim(); }
  catch (e) { return ""; }
};

BOC.api.hasExplicitPageParam = function (url) {
  try { return new URL(url).searchParams.has("p"); }
  catch (e) { return false; }
};

BOC.api.pickPageFromPages = function (pages, pageIndex) {
  var safePageIndex = Number(pageIndex) > 0 ? Number(pageIndex) : 1;
  var safePages = Array.isArray(pages) ? pages : [];
  var pageByIndex = safePages[safePageIndex - 1];
  if (pageByIndex && pageByIndex.cid) { return pageByIndex; }
  var pageByNo = safePages.find(function (item) { return Number(item.page) === safePageIndex; });
  if (pageByNo && pageByNo.cid) { return pageByNo; }
  return null;
};

BOC.api.pickCidFromPages = function (pages, pageIndex, fallbackCid) {
  var matchedPage = BOC.api.pickPageFromPages(pages, pageIndex);
  if (matchedPage && matchedPage.cid) { return String(matchedPage.cid); }
  var safePages = Array.isArray(pages) ? pages : [];
  if (safePages[0] && safePages[0].cid) { return String(safePages[0].cid); }
  if (fallbackCid) { return String(fallbackCid); }
  throw new Error("没有找到当前分P的 CID。");
};

BOC.api.pickPageIndexFromOid = function (pages, oid) {
  var safeOid = String(oid || "").trim();
  if (!safeOid) { return 0; }
  var safePages = Array.isArray(pages) ? pages : [];
  var pageByCid = safePages.find(function (item) { return String(item && item.cid || "") === safeOid; });
  if (pageByCid && pageByCid.page) { return Number(pageByCid.page) || 0; }
  return 0;
};

BOC.api.pickDurationFromPages = function (pages, pageIndex, fallbackDuration) {
  var matchedPage = BOC.api.pickPageFromPages(pages, pageIndex);
  if (Number(matchedPage && matchedPage.duration) > 0) { return Number(matchedPage.duration); }
  var safePages = Array.isArray(pages) ? pages : [];
  if (safePages[0] && Number(safePages[0].duration) > 0) { return Number(safePages[0].duration); }
  return Number(fallbackDuration || 0) || 0;
};

BOC.api.isRetryableNetworkError = function (error) {
  var message = BOC.utils.getErrorMessage(error, "").toLowerCase();
  if (!message) { return false; }
  if (message.indexOf("http ") !== -1) { return true; }
  return message.indexOf("请求失败") !== -1 ||
    message.indexOf("failed to fetch") !== -1 ||
    message.indexOf("fetch failed") !== -1 ||
    message.indexOf("networkerror") !== -1 ||
    message.indexOf("net::") !== -1 ||
    message.indexOf("background fetch failed") !== -1 ||
    message.indexOf("timeout") !== -1 ||
    message.indexOf("timed out") !== -1;
};

BOC.api.retryAsync = function (task, retries, delayMs) {
  retries = retries || 1;
  delayMs = delayMs || 180;
  var lastError = null;

  function attempt(n) {
    if (n > retries) { return Promise.reject(lastError || new Error("Unknown retry error")); }
    try {
      return Promise.resolve(task()).catch(function (error) {
        lastError = error;
        var isNetworkError = BOC.api.isRetryableNetworkError(error);
        var isRetryable = error && error.retryable === true;
        if (!isNetworkError && !isRetryable) { throw error; }
        var backoffDelay = Math.min(delayMs * Math.pow(2, Math.max(0, n - 1)), 5000);
        BOC.utils.logInfo("[BOC] retrying after " + backoffDelay + "ms, attempt " + (n + 1) + "/" + retries);
        return BOC.utils.sleep(backoffDelay).then(function () { return attempt(n + 1); });
      });
    } catch (error) {
      lastError = error;
      return attempt(n + 1);
    }
  }

  return attempt(0);
};

// --- Transport layer (provided to createClient) ---

/**
 * Chrome extension transport: routes fetch through background service worker
 * to bypass CORS on B站 API endpoints.
 */
BOC.api._chromeFetch = function (url) {
  return new Promise(function (resolve, reject) {
    try {
      chrome.runtime.sendMessage({ type: "fetch-json", url: url }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error(BOC.utils.toReadableText(resp && resp.error, "Background fetch failed")));
          return;
        }
        resolve(resp.data);
      });
    } catch (error) {
      reject(error);
    }
  });
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/bilibili-api.js
```

Expected: no output

---

### Task A3: Create core/subtitle-fetcher.js

**Files:**
- Create: `extension/core/subtitle-fetcher.js`

Extract subtitle parsing, validation, track selection, and chapter normalization.

- [ ] **Step 1: Create core/subtitle-fetcher.js**

```javascript
var BOC = BOC || {};
BOC.subtitle = BOC.subtitle || {};

// --- Track normalization & selection ---

BOC.subtitle.isAiSubtitle = function (item) {
  var lan = String((item && item.lan) || "").toLowerCase();
  return lan.indexOf("ai-") === 0;
};

BOC.subtitle._subtitlePriority = function (item) {
  var lan = String((item && item.lan) || "").toLowerCase();
  var label = String((item && item.lanDoc) || "").toLowerCase();

  if (lan === "zh-cn" || lan === "zh-hans") { return 0; }
  if (lan === "zh") { return 1; }
  if (lan.indexOf("zh") !== -1) { return 2; }
  if (label.indexOf("中文") !== -1) { return 3; }
  if (lan === "en" || lan === "en-us" || lan === "en-gb") { return 10; }
  if (lan.indexOf("en") !== -1) { return 11; }
  if (label.indexOf("英文") !== -1 || label.indexOf("英语") !== -1 || label.indexOf("english") !== -1) { return 12; }
  return 50;
};

BOC.subtitle.normalizeTracks = function (subtitles) {
  return (subtitles || []).slice().sort(function (a, b) {
    var p = BOC.subtitle._subtitlePriority(a) - BOC.subtitle._subtitlePriority(b);
    if (p !== 0) { return p; }

    var lanA = String((a.lanDoc || a.lan || "")).toLowerCase();
    var lanB = String((b.lanDoc || b.lan || "")).toLowerCase();
    if (lanA < lanB) { return -1; }
    if (lanA > lanB) { return 1; }

    var idA = parseInt(String(a.id || "0"), 10);
    var idB = parseInt(String(b.id || "0"), 10);
    if (isFinite(idA) && isFinite(idB) && idA !== idB) { return idA - idB; }

    return String(a.subtitleUrl).localeCompare(String(b.subtitleUrl));
  });
};

BOC.subtitle.pickPreferred = function (subtitles, opts) {
  opts = opts || {};
  var tracks = subtitles || [];
  if (tracks.length === 0) { return null; }

  if (opts.previousId) {
    var byId = tracks.find(function (item) { return String(item.id || "") === String(opts.previousId); });
    if (byId) { return byId; }
  }
  if (opts.previousUrl) {
    var prevKey = BOC.subtitle._normalizeUrlForCache(opts.previousUrl);
    if (prevKey) {
      var byUrl = tracks.find(function (item) { return BOC.subtitle._normalizeUrlForCache(item.subtitleUrl) === prevKey; });
      if (byUrl) { return byUrl; }
    }
  }
  if (opts.previousLang) {
    var normLang = String(opts.previousLang).trim().toLowerCase();
    var byLang = tracks.find(function (item) {
      return String(item.lanDoc || item.lan || "").trim().toLowerCase() === normLang;
    });
    if (byLang) { return byLang; }
  }
  return tracks[0];
};

BOC.subtitle.buildCandidates = function (subtitles, preferred) {
  var tracks = subtitles || [];
  var seen = {};
  var list = [];

  function pushUnique(item) {
    if (!item) { return; }
    var key = String(item.id || "").trim() + "|" +
      BOC.subtitle._normalizeUrlForCache(item.subtitleUrl) + "|" +
      String(item.lan || "").trim().toLowerCase();
    if (seen[key]) { return; }
    seen[key] = true;
    list.push(item);
  }

  pushUnique(preferred);
  tracks.forEach(pushUnique);
  return list;
};

// --- Subtitle body parsing & validation ---

BOC.subtitle.parseBody = function (subtitle) {
  var body = Array.isArray(subtitle && subtitle.body) ? subtitle.body : [];
  return body.map(function (item) {
    return {
      from: Number((item && item.from) || 0),
      to: Number((item && item.to) || 0),
      content: String((item && (item.content || item.text)) || "").trim()
    };
  });
};

BOC.subtitle.validateByDuration = function (body, videoDuration) {
  var duration = Number(videoDuration || 0);
  if (!Array.isArray(body) || body.length === 0) {
    return { ok: false, reason: "empty", videoDuration: duration, maxTo: 0 };
  }

  var maxTo = 0;
  body.forEach(function (item) {
    var to = Number(item && item.to);
    var from = Number(item && item.from);
    if (isFinite(to) && to > maxTo) { maxTo = to; }
    if (isFinite(from) && from > maxTo) { maxTo = from; }
  });

  if (!(duration > 0)) {
    return { ok: true, reason: "skip-no-video-duration", videoDuration: duration, maxTo: maxTo };
  }

  var upperTolerance = Math.max(12, duration * 0.15);
  if (maxTo > duration + upperTolerance) {
    return { ok: false, reason: "too-long", videoDuration: duration, maxTo: maxTo };
  }

  var minCoverageRatio = 0;
  if (duration >= 600) { minCoverageRatio = 0.18; }
  else if (duration >= 300) { minCoverageRatio = 0.22; }
  else if (duration >= 180) { minCoverageRatio = 0.25; }

  if (minCoverageRatio > 0 && maxTo < duration * minCoverageRatio) {
    return { ok: false, reason: "too-short", videoDuration: duration, maxTo: maxTo };
  }

  return { ok: true, reason: "ok", videoDuration: duration, maxTo: maxTo };
};

// --- Chapter normalization ---

BOC.subtitle.normalizeChapters = function (chapters) {
  var normalized = (chapters || []).map(function (item) {
    return {
      title: String((item && item.title) || "").trim(),
      from: Number((item && item.from) || 0) || 0,
      to: Number((item && item.to) || 0) || 0,
      source: String((item && item.source) || "")
    };
  }).filter(function (item) { return item.title && item.from >= 0; })
    .sort(function (a, b) { return a.from - b.from; });

  var unique = [];
  var seen = {};
  normalized.forEach(function (item) {
    var key = Math.floor(item.from * 10) + "|" + item.title.toLowerCase();
    if (seen[key]) { return; }
    seen[key] = true;
    unique.push(item);
  });
  return unique;
};

// --- Try candidates (orchestrates load + validate) ---

BOC.subtitle.tryLoadCandidates = function (candidates, runId, loadFn) {
  var lastError = null;

  function tryNext(index) {
    if (index >= (candidates || []).length) {
      if (lastError) { return Promise.reject(lastError); }
      return Promise.reject(new Error("这个视频暂时没有可用字幕。"));
    }
    var item = candidates[index];
    BOC.utils.logInfo("[BOC] try subtitle track", {
      id: item.id, lan: item.lan, lanDoc: item.lanDoc
    });
    return loadFn(item.subtitleUrl, item.lanDoc || item.lan || "unknown", runId, item.id)
      .then(function () { return item; })
      .catch(function (error) {
        lastError = error;
        var reasonCode = BOC.utils.toReadableText(error && error.code, "");
        var meta = { id: item.id, lan: item.lan, lanDoc: item.lanDoc, reason: reasonCode || BOC.utils.getErrorMessage(error, "unknown") };
        if (reasonCode === "SUBTITLE_DURATION_MISMATCH") {
          BOC.utils.logInfo("[BOC] subtitle track skipped " + JSON.stringify(meta));
        } else {
          BOC.utils.logWarn("[BOC] subtitle track rejected " + JSON.stringify(meta));
        }
        return tryNext(index + 1);
      });
  }

  return tryNext(0);
};

// --- URL normalization for cache keys ---

BOC.subtitle._normalizeUrlForCache = function (url) {
  var text = String(url || "").trim();
  if (!text) { return ""; }
  try {
    var parsed = new URL(text);
    var path = parsed.pathname.replace(/[^\w/.-]+/g, "_");
    return parsed.hostname + path;
  } catch (e) {
    return text.replace(/[^\w/.-]+/g, "_");
  }
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/subtitle-fetcher.js
```

Expected: no output

---

### Task A4: Create core/markdown-builder.js

**Files:**
- Create: `extension/core/markdown-builder.js`

Extract all Markdown/SRT/TXT generation logic. Pure functions, zero side effects.

- [ ] **Step 1: Create core/markdown-builder.js**

```javascript
var BOC = BOC || {};
BOC.markdown = BOC.markdown || {};

// --- Timestamp formatting ---

BOC.markdown.formatCompactTimestamp = function (seconds, withHours) {
  var safe = Math.max(0, Math.floor(Number(seconds) || 0));
  var hour = Math.floor(safe / 3600);
  var minute = Math.floor((safe % 3600) / 60);
  var second = safe % 60;

  if (withHours) {
    return String(hour).padStart(2, "0") + ":" +
      String(minute).padStart(2, "0") + ":" +
      String(second).padStart(2, "0");
  }
  var totalMinutes = Math.floor(safe / 60);
  return String(totalMinutes).padStart(2, "0") + ":" + String(second).padStart(2, "0");
};

BOC.markdown.formatTimestamp = function (seconds, forSrt) {
  var safe = Number(seconds) || 0;
  var msTotal = Math.max(0, Math.floor(safe * 1000));
  var hour = Math.floor(msTotal / 3600000);
  var minute = Math.floor((msTotal % 3600000) / 60000);
  var second = Math.floor((msTotal % 60000) / 1000);
  var ms = msTotal % 1000;

  var hh = String(hour).padStart(2, "0");
  var mm = String(minute).padStart(2, "0");
  var ss = String(second).padStart(2, "0");
  if (!forSrt) {
    return hh + ":" + mm + ":" + ss + "." + String(ms).padStart(3, "0");
  }
  return hh + ":" + mm + ":" + ss + "," + String(ms).padStart(3, "0");
};

// --- Duration display helpers ---

BOC.markdown._shouldShowHours = function (body, chapters, duration) {
  var subtitleMaxTo = (body || []).reduce(function (max, item) {
    var to = Number((item && item.to) || 0);
    return isFinite(to) && to > max ? to : max;
  }, 0);
  var chapterMaxTo = (chapters || []).reduce(function (max, item) {
    return Math.max(max, Number((item && item.from) || 0) || 0, Number((item && item.to) || 0) || 0);
  }, 0);
  var dur = Number(duration || 0) || 0;
  return Math.max(subtitleMaxTo, chapterMaxTo, dur) >= 3600;
};

// --- Preview ---

BOC.markdown.buildPreview = function (body, settings) {
  var withHours = BOC.markdown._shouldShowHours(body, [], 0);
  return (body || []).map(function (item) {
    var text = String((item && item.content) || "").trim();
    if (!text) { return ""; }
    if (settings && settings.includeTimestampInBody) {
      return "`" + BOC.markdown.formatCompactTimestamp(item.from, withHours) + "` " + text;
    }
    return text;
  }).filter(Boolean).join("\n");
};

// --- SRT ---

BOC.markdown.buildSrt = function (body) {
  return body.map(function (item, index) {
    var from = BOC.markdown.formatTimestamp(item.from, true);
    var to = BOC.markdown.formatTimestamp(item.to, true);
    var text = ((item && item.content) || "").trim();
    return (index + 1) + "\n" + from + " --> " + to + "\n" + text;
  }).join("\n\n");
};

// --- TXT ---

BOC.markdown.buildTxt = function (body, settings) {
  var withHours = BOC.markdown._shouldShowHours(body, [], 0);
  return (body || []).map(function (item) {
    var text = String((item && item.content) || "").trim();
    if (!text) { return ""; }
    if (settings && settings.includeTimestampInBody) {
      return BOC.markdown.formatCompactTimestamp(item.from, withHours) + " " + text;
    }
    return text;
  }).filter(Boolean).join("\n");
};

// --- Bilibili embed iframe ---

BOC.markdown.buildEmbedIframe = function (meta, page) {
  var safeAid = encodeURIComponent(String((meta && meta.aid) || "").trim());
  var safeBvid = encodeURIComponent(String((meta && meta.bvid) || "").trim());
  var safeCid = encodeURIComponent(String((meta && meta.cid) || "").trim());
  var safePage = Number(page) > 0 ? Number(page) : 1;

  return '<iframe src="https://player.bilibili.com/player.html?aid=' + safeAid +
    '&bvid=' + safeBvid + '&cid=' + safeCid + '&page=' + safePage +
    '&autoplay=0" scrolling="no" border="0" frameborder="no" framespacing="0" ' +
    'allow="fullscreen; picture-in-picture" allowfullscreen="true" ' +
    'style="height:100%;width:100%; aspect-ratio: 16 / 9;"> </iframe>';
};

// --- Frontmatter ---

BOC.markdown.buildFrontMatter = function (meta, settings, created, tagsYaml) {
  var defaultFields = BOC.DEFAULT_SETTINGS.frontmatterFields;
  var raw = Array.isArray(settings && settings.frontmatterFields) ? settings.frontmatterFields : defaultFields;
  var allowed = {};
  defaultFields.forEach(function (f) { allowed[f] = true; });

  var enabled = [];
  raw.forEach(function (item) {
    var key = String(item || "").trim();
    if (key && allowed[key] && enabled.indexOf(key) === -1) { enabled.push(key); }
  });

  var fixedLines = BOC.markdown._buildFixedPropertyLines(settings);
  if (enabled.length === 0 && fixedLines.length === 0) { return ""; }

  var fieldLines = {};
  fieldLines.title = 'title: "' + BOC.utils.escapeYaml(meta.title || "") + '"';
  fieldLines.url = 'url: "' + BOC.utils.escapeYaml(meta.url || "") + '"';
  fieldLines.bvid = 'bvid: "' + BOC.utils.escapeYaml(meta.bvid || "") + '"';
  fieldLines.cid = 'cid: "' + BOC.utils.escapeYaml(meta.cid || "") + '"';
  fieldLines.author = 'author: "' + BOC.utils.escapeYaml(meta.author || "unknown") + '"';
  fieldLines.upload_date = 'upload_date: "' + BOC.utils.escapeYaml(meta.uploadDate || "unknown") + '"';
  fieldLines.subtitle_lang = 'subtitle_lang: "' + BOC.utils.escapeYaml(meta.selectedSubtitleLang || "unknown") + '"';
  fieldLines.created = 'created: "' + (created || "") + '"';
  fieldLines.tags = 'tags: ' + (tagsYaml || "[]");

  // New fields for Karpathy-style knowledge base
  if (meta.subtitleType) {
    fieldLines.subtitle_type = 'subtitle_type: "' + BOC.utils.escapeYaml(meta.subtitleType) + '"';
    enabled.push("subtitle_type");
  }
  if (meta.source) {
    fieldLines.source = 'source: "' + BOC.utils.escapeYaml(meta.source) + '"';
    enabled.push("source");
  }
  if (meta.sourceType) {
    fieldLines.source_type = 'source_type: "' + BOC.utils.escapeYaml(meta.sourceType) + '"';
    enabled.push("source_type");
  }
  if (meta.durationSeconds) {
    fieldLines.duration_seconds = 'duration_seconds: ' + Number(meta.durationSeconds);
    enabled.push("duration_seconds");
  }
  if (meta.authorUid) {
    fieldLines.author_uid = 'author_uid: "' + BOC.utils.escapeYaml(meta.authorUid) + '"';
    enabled.push("author_uid");
  }

  var lines = enabled.map(function (field) { return fieldLines[field]; }).filter(Boolean);
  lines = lines.concat(fixedLines);
  if (lines.length === 0) { return ""; }
  return "---\n" + lines.join("\n") + "\n---";
};

BOC.markdown._buildFixedPropertyLines = function (settings) {
  var rows = Array.isArray(settings && settings.fixedFrontmatterProperties) ? settings.fixedFrontmatterProperties : [];
  var systemFields = {};
  BOC.DEFAULT_SETTINGS.frontmatterFields.forEach(function (f) { systemFields[f.toLowerCase()] = true; });
  var seenKeys = {};
  var lines = [];

  rows.forEach(function (item) {
    var key = String((item && item.key) || "").trim();
    var type = String((item && item.type) || "").trim().toLowerCase();
    if (type !== "number" && type !== "checkbox" && type !== "list") { type = "text"; }
    var value = item && item.value;
    var lowerKey = key.toLowerCase();

    if (!key || !String(value || "").trim()) { return; }
    if (!/^[一-鿿\w\-\s]+$/.test(key)) { return; }
    if (systemFields[lowerKey] || seenKeys[lowerKey]) { return; }
    seenKeys[lowerKey] = true;

    if (type === "number") {
      var num = Number(String(value || "").trim());
      if (!isFinite(num)) { return; }
      lines.push(key + ": " + String(value).trim());
    } else if (type === "checkbox") {
      var normalizedValue = String(value || "").trim().toLowerCase();
      if (normalizedValue !== "true" && normalizedValue !== "false") { return; }
      lines.push(key + ": " + normalizedValue);
    } else if (type === "list") {
      var items = String(value || "").split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      lines.push(key + ": [" + items.map(function (s) { return '"' + BOC.utils.escapeYaml(s) + '"'; }).join(", ") + "]");
    } else {
      lines.push(key + ': "' + BOC.utils.escapeYaml(String(value || "")) + '"');
    }
  });
  return lines;
};

// --- Chapter lines ---

BOC.markdown.buildChapterLines = function (chapters, withHours) {
  var chapterItems = BOC.subtitle.normalizeChapters(chapters);
  if (chapterItems.length === 0) { return []; }
  return chapterItems.map(function (item) {
    var fromText = BOC.markdown.formatCompactTimestamp(item.from, withHours);
    return "- `" + fromText + "` " + item.title;
  });
};

// --- Subtitle section lines (chapter-aware) ---

BOC.markdown.buildSubtitleSectionLines = function (body, chapters, settings, withHours) {
  var subtitleItems = (body || []).map(function (item, index) {
    return {
      from: Number(item.from || 0) || 0,
      to: Number(item.to || 0) || 0,
      text: String((item.content || item.text) || "").trim(),
      _index: index
    };
  }).filter(function (item) { return item.text; });

  if (subtitleItems.length === 0) { return ["（暂无字幕）"]; }

  var chapterItems = BOC.subtitle.normalizeChapters(chapters);
  if (chapterItems.length === 0) {
    return subtitleItems.map(function (item) { return BOC.markdown._formatSubtitleLine(item, settings, withHours); });
  }

  var lines = [];
  var usedIndexes = {};

  chapterItems.forEach(function (chapter, idx) {
    var start = Number(chapter.from || 0) || 0;
    var next = chapterItems[idx + 1];
    var end = Infinity;
    if (next && Number(next.from) > start) { end = Number(next.from); }
    else if (Number(chapter.to || 0) > start) { end = Number(chapter.to); }

    var sectionItems = subtitleItems.filter(function (item) {
      return item.from + 0.001 >= start && (end === Infinity || item.from < end);
    });
    if (sectionItems.length === 0) { return; }

    var chapterStamp = settings && settings.includeTimestampInBody
      ? " `" + BOC.markdown.formatCompactTimestamp(start, withHours) + "`"
      : "";
    lines.push("### " + chapter.title + chapterStamp, "");
    sectionItems.forEach(function (item) {
      usedIndexes[item._index] = true;
      lines.push(BOC.markdown._formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  });

  var remaining = subtitleItems.filter(function (item) { return !usedIndexes[item._index]; });
  if (remaining.length > 0) {
    lines.push("### 其他片段", "");
    remaining.forEach(function (item) {
      lines.push(BOC.markdown._formatSubtitleLine(item, settings, withHours));
    });
    lines.push("");
  }

  if (lines.length === 0) {
    return subtitleItems.map(function (item) { return BOC.markdown._formatSubtitleLine(item, settings, withHours); });
  }

  while (lines.length > 0 && !lines[lines.length - 1]) { lines.pop(); }
  return lines;
};

BOC.markdown._formatSubtitleLine = function (item, settings, withHours) {
  var text = String((item && item.text) || "");
  if (!text) { return ""; }
  if (!(settings && settings.includeTimestampInBody)) { return text; }
  return "`" + BOC.markdown.formatCompactTimestamp(item.from, withHours) + "` " + text;
};

// --- Full Markdown ---

BOC.markdown.buildMarkdown = function (meta, body, settings) {
  var created = BOC.utils.formatLocalDate();
  var tags = (settings.tags || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
  var tagsYaml = tags.length === 0
    ? "[]"
    : "[" + tags.map(function (t) { return '"' + BOC.utils.escapeYaml(t) + '"'; }).join(", ") + "]";

  var chapters = meta.chapters || [];
  var withHours = BOC.markdown._shouldShowHours(body, chapters, meta.videoDuration);
  var chapterLines = BOC.markdown.buildChapterLines(chapters, withHours);
  var subtitleSectionLines = BOC.markdown.buildSubtitleSectionLines(body, chapters, settings, withHours);
  var frontMatter = BOC.markdown.buildFrontMatter(meta, settings, created, tagsYaml);

  var page = BOC.api.extractPageIndex(meta.url || "");
  var embedIframe = BOC.markdown.buildEmbedIframe(meta, page);
  var intro = String(meta.description || "").trim();

  var lines = [];
  if (frontMatter) { lines.push(frontMatter, ""); }
  lines.push(embedIframe, "");
  if (intro) { lines.push("## 简介", "", intro, ""); }
  if (chapterLines.length > 0) { lines.push("## 章节", "", chapterLines.join("\n"), ""); }
  lines.push("## 字幕", "", subtitleSectionLines.join("\n"));

  return lines.join("\n");
};

// --- Filename ---

BOC.markdown.buildNoteFilename = function (meta, settings) {
  var includeDate = !(settings && settings.includeDateInFilename === false);
  var baseParts = [];
  if (includeDate) { baseParts.push(BOC.utils.formatLocalDate()); }
  baseParts.push(meta.title || meta.bvid || "bilibili-subtitle");

  if (Number(meta.pageCount) > 1) {
    baseParts.push("P" + (Number(meta.pageIndex) > 0 ? Number(meta.pageIndex) : 1));
    var pageTitle = String(meta.pageTitle || "").trim();
    if (pageTitle) { baseParts.push(pageTitle); }
  }

  var baseName = BOC.utils.sanitizeFileName(baseParts.filter(Boolean).join("-"));
  return (baseName || "bilibili-subtitle") + ".md";
};

// --- Download format ---

BOC.markdown.normalizeDownloadFormat = function (value) {
  return value === "txt" ? "txt" : "srt";
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/markdown-builder.js
```

Expected: no output

---

### Task A5: Create core/obsidian-client.js

**Files:**
- Create: `extension/core/obsidian-client.js`

- [ ] **Step 1: Create core/obsidian-client.js**

```javascript
var BOC = BOC || {};
BOC.obsidian = BOC.obsidian || {};

BOC.obsidian.normalizeFolder = function (input) {
  return String(input || "").trim().replace(/^\/+|\/+$/g, "");
};

/**
 * Write a note to Obsidian via Local REST API.
 * sendMessageFn(tabId, message) routes the request to background.js.
 * In content.js context: chrome.runtime.sendMessage
 * In batch.js context: chrome.runtime.sendMessage (same API)
 */
BOC.obsidian.writeNote = function (sendMessageFn, baseUrl, apiKey, filepath, content) {
  return new Promise(function (resolve, reject) {
    try {
      sendMessageFn({
        type: "write-obsidian-note",
        baseUrl: baseUrl,
        apiKey: apiKey,
        filepath: filepath,
        content: content
      }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error(BOC.utils.toReadableText(resp && resp.error, "Local API 写入失败")));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
};

BOC.obsidian.testConnection = function (sendMessageFn, baseUrl, apiKey) {
  return new Promise(function (resolve, reject) {
    try {
      sendMessageFn({
        type: "test-obsidian-connection",
        baseUrl: baseUrl,
        apiKey: apiKey
      }, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error(BOC.utils.toReadableText(resp && resp.error, "连接失败")));
          return;
        }
        resolve(resp.service || "Obsidian Local REST API");
      });
    } catch (error) {
      reject(error);
    }
  });
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/obsidian-client.js
```

Expected: no output

---

### Task A6: Create core/subtitle-cache.js

**Files:**
- Create: `extension/core/subtitle-cache.js`

- [ ] **Step 1: Create core/subtitle-cache.js**

```javascript
var BOC = BOC || {};
BOC.cache = BOC.cache || {};

BOC.cache.CACHE_KEY_PREFIX = "boc_subtitle_cache_";

BOC.cache._buildSourceKey = function (subtitleId, subtitleUrl, lang) {
  var id = String(subtitleId || "").trim();
  if (id) { return "id_" + id; }
  var normalizedUrl = BOC.subtitle._normalizeUrlForCache(subtitleUrl);
  if (normalizedUrl) { return "url_" + normalizedUrl; }
  return "lang_" + String(lang || "").trim().toLowerCase() || "unknown";
};

BOC.cache.getCacheKey = function (bvid, cid, subtitleId, subtitleUrl, lang) {
  var sourceKey = BOC.cache._buildSourceKey(subtitleId, subtitleUrl, lang);
  return BOC.cache.CACHE_KEY_PREFIX + bvid + "_" + cid + "_" + sourceKey;
};

BOC.cache.load = function (cacheKey) {
  try {
    return new Promise(function (resolve) {
      chrome.storage.local.get(cacheKey, function (result) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve((result && result[cacheKey] && result[cacheKey].body) || null);
      });
    });
  } catch (e) {
    return Promise.resolve(null);
  }
};

BOC.cache.save = function (cacheKey, body) {
  try {
    var data = {};
    data[cacheKey] = { body: body, timestamp: Date.now() };
    return new Promise(function (resolve) {
      chrome.storage.local.set(data, function () { resolve(); });
    });
  } catch (e) {
    return Promise.resolve();
  }
};

BOC.cache.clear = function (cacheKey) {
  try {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(cacheKey, function () { resolve(); });
    });
  } catch (e) {
    return Promise.resolve();
  }
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check extension/core/subtitle-cache.js
```

Expected: no output

---

### Task A7: Refactor content/content.js — UI Shell

**Files:**
- Create: `extension/content/content.js` (new location, ~600 lines)
- Move: `extension/content.css` → `extension/content/content.css`

content.js 保留：UI 渲染、事件绑定、state 管理、refreshClip 编排逻辑。所有业务逻辑委托给 BOC.* 模块。

由于此任务涉及大量代码改写，关键改动点如下（实际实现时逐个函数替换）：

- [ ] **Step 1: Move content.css to content/**

```bash
mkdir -p extension/content
mv extension/content.css extension/content/content.css
```

- [ ] **Step 2: Rewrite content.js header — use BOC.* modules**

将 content.js 中所有被提取到 core 的函数替换为 BOC.* 调用。关键映射：

| content.js 原函数 | 替换为 |
|---|---|
| `formatLocalDate()` | `BOC.utils.formatLocalDate()` |
| `escapeHtml()` | `BOC.utils.escapeHtml()` |
| `getErrorMessage()` | `BOC.utils.getErrorMessage()` |
| `fetchVideoMeta()` | `BOC.apiClient.fetchVideoMeta()` |
| `fetchSubtitleBundle()` | `BOC.apiClient.fetchSubtitleBundle()` |
| `fetchSubtitleBody()` | `BOC.apiClient.fetchSubtitleBody()` |
| `normalizeSubtitleTracks()` | `BOC.subtitle.normalizeTracks()` |
| `pickPreferredSubtitle()` | `BOC.subtitle.pickPreferred()` |
| `validateSubtitleByDuration()` | `BOC.subtitle.validateByDuration()` |
| `buildMarkdown()` | `BOC.markdown.buildMarkdown()` |
| `buildSrt()` | `BOC.markdown.buildSrt()` |
| `buildTxt()` | `BOC.markdown.buildTxt()` |
| `buildSubtitlePreview()` | `BOC.markdown.buildPreview()` |
| `buildNoteFilename()` | `BOC.markdown.buildNoteFilename()` |
| `getSubtitleCacheKey()` | `BOC.cache.getCacheKey()` |
| `loadSubtitleFromCache()` | `BOC.cache.load()` |
| `saveSubtitleToCache()` | `BOC.cache.save()` |

**初始化时创建 API client：**
```javascript
var apiClient = BOC.api.createClient(BOC.api._chromeFetch);
```

所有 `DEFAULT_SETTINGS` 引用改为 `BOC.DEFAULT_SETTINGS`。
所有 `BOC_VERSION` 引用改为 `BOC.BOC_VERSION`。

- [ ] **Step 3: Remove extracted function definitions from content.js**

删除所有已迁移到 core/ 的函数定义。仅保留：
- `buildUiHtml()`, `bindUiEvents()`, `bindRuntimeEvents()`
- `init()`, `startUrlWatcher()`, `resetClipState()`
- `refreshClip()`, `onSubtitleChange()`, `loadSubtitle()`
- `renderMeta()`, `renderSubtitleSelect()`, `getPopupPayload()`
- `copyMarkdown()`, `downloadSubtitle()`, `sendToObsidian()`
- `setBusyState()`, `setStatus()`, `setMessage()`
- `getSettings()`, `byId()`, `sendRuntimeMessage()`, `requestOpenOptions()`
- `readVideoTitle()`, `readVideoAuthor()`, `readUploadDate()`, `readRuntimeVideoDuration()`
- `ids`, `state`

- [ ] **Step 4: Verify content.js is under 900 lines**

```bash
wc -l extension/content/content.js
```

Expected: < 900 lines

- [ ] **Step 5: Syntax check**

```bash
node --check extension/content/content.js
```

---

### Task A8: Update background.js

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Add importScripts at the top of background.js**

Replace the current background.js preamble with core module loading:

```javascript
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
```

- [ ] **Step 2: Replace local normalizeDownloadFormat with BOC.markdown.normalizeDownloadFormat**

- [ ] **Step 3: Syntax check**

```bash
node --check extension/background.js
```

---

### Task A9: Update manifest.json

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Update all paths in manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Bilibili Obsidian Clipper｜一键保存B站字幕",
  "version": "2.0.0",
  "description": "在 B 站视频页抓取字幕，预览后一键保存到 Obsidian。支持批量抓取。",

  "browser_specific_settings": {
    "gecko": {
      "id": "bilibili-obsidian-clipper@github.com",
      "strict_min_version": "109.0"
    }
  },

  "permissions": ["storage", "scripting"],
  "host_permissions": [
    "https://www.bilibili.com/*",
    "https://api.bilibili.com/*",
    "https://*.hdslb.com/*",
    "http://127.0.0.1/*",
    "https://127.0.0.1/*",
    "http://localhost/*",
    "https://localhost/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "options_page": "options/options.html",
  "content_scripts": [
    {
      "matches": [
        "https://www.bilibili.com/video/*",
        "https://www.bilibili.com/list/watchlater",
        "https://www.bilibili.com/list/watchlater/*"
      ],
      "js": [
        "core/utils.js",
        "core/bilibili-api.js",
        "core/subtitle-fetcher.js",
        "core/markdown-builder.js",
        "core/obsidian-client.js",
        "core/subtitle-cache.js",
        "content/content.js"
      ],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_title": "Bilibili Obsidian Clipper",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_popup": "popup/popup.html"
  },
  "web_accessible_resources": [
    {
      "resources": ["batch/batch.html", "batch/batch.js", "batch/batch.css"],
      "matches": ["https://www.bilibili.com/*"]
    }
  ]
}
```

---

## Phase 2: Batch Page (Tasks B1-B3)

### Task B1: Create batch/batch.html

**Files:**
- Create: `extension/batch/batch.html`

**Usability fix (engineer-advisor P0):** 第一步预设"从收藏夹导入"模板，降低首次使用认知门槛。

- [ ] **Step 1: Create batch/batch.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BiliVault — 批量知识摄取</title>
  <link rel="stylesheet" href="./batch.css" />
</head>
<body>
  <main class="batch-container">
    <header class="batch-header">
      <h1>BiliVault 批量摄取</h1>
      <p class="batch-subtitle">从 B站 抓取字幕 → Obsidian 知识库 raw/ 层</p>
    </header>

    <!-- Step 1: Source Selection -->
    <section id="step-source" class="batch-step active">
      <h2>Step 1: 选择来源</h2>

      <div class="source-presets">
        <button class="preset-card" data-preset="favorite">
          <span class="preset-icon">📁</span>
          <strong>从收藏夹导入</strong>
          <small>粘贴收藏夹链接，一键识别</small>
        </button>
        <button class="preset-card" data-preset="space">
          <span class="preset-icon">👤</span>
          <strong>从UP主空间导入</strong>
          <small>粘贴UP主主页链接</small>
        </button>
        <button class="preset-card" data-preset="manual">
          <span class="preset-icon">📋</span>
          <strong>手动输入BV号</strong>
          <small>精确控制，一行一个</small>
        </button>
      </div>

      <div id="source-detail" class="source-detail" hidden>
        <!-- Dynamically populated based on preset selection -->
      </div>

      <div id="source-status" class="source-status" hidden></div>

      <div class="step-actions">
        <button id="source-next-btn" class="btn-primary" disabled>下一步：设置筛选</button>
      </div>
    </section>

    <!-- Step 2: Filter Pipeline -->
    <section id="step-filter" class="batch-step">
      <h2>Step 2: 筛选条件</h2>

      <div class="filter-stages">
        <div class="filter-stage">
          <label class="filter-toggle">
            <input type="checkbox" id="filter-subtitle" checked />
            <strong>Stage 0: 字幕前置条件</strong>
          </label>
          <div class="filter-options">
            <label><input type="checkbox" class="sub-filter" data-parent="filter-subtitle" id="filter-cc-only" /> 仅人工CC字幕（跳过AI生成）</label>
            <label><input type="checkbox" class="sub-filter" data-parent="filter-subtitle" id="filter-zh-first" checked /> 首选中文，无中文时降级英文</label>
          </div>
        </div>

        <div class="filter-stage">
          <label class="filter-toggle">
            <input type="checkbox" id="filter-dedup" checked />
            <strong>Stage 1: 去重</strong>
          </label>
          <div class="filter-options">
            <p class="filter-hint">自动跳过已存在于 Obsidian raw/ 目录中的视频</p>
          </div>
        </div>

        <div class="filter-stage">
          <label class="filter-toggle">
            <input type="checkbox" id="filter-duration" />
            <strong>Stage 2: 时长范围</strong>
          </label>
          <div class="filter-options">
            <input type="number" id="duration-min" value="2" min="0" class="filter-number" /> 分钟 ~
            <input type="number" id="duration-max" value="180" min="0" class="filter-number" /> 分钟
          </div>
        </div>

        <div class="filter-stage">
          <label class="filter-toggle">
            <input type="checkbox" id="filter-keyword" />
            <strong>Stage 3: 标题关键词</strong>
          </label>
          <div class="filter-options">
            <input type="text" id="keyword-include" placeholder="包含关键词（逗号分隔）" class="filter-text" />
            <input type="text" id="keyword-exclude" placeholder="排除关键词（逗号分隔）" class="filter-text" />
          </div>
        </div>

        <div class="filter-stage">
          <label class="filter-toggle">
            <input type="checkbox" id="filter-daterange" />
            <strong>Stage 4: 发布时间</strong>
          </label>
          <div class="filter-options">
            <select id="date-range-select">
              <option value="1">最近 1 个月</option>
              <option value="3">最近 3 个月</option>
              <option value="6" selected>最近 6 个月</option>
              <option value="12">最近 1 年</option>
              <option value="0">不限</option>
            </select>
          </div>
        </div>
      </div>

      <div class="filter-summary" id="filter-summary" hidden>
        <strong>📊 实时统计</strong>
        <div id="filter-stats"></div>
      </div>

      <div class="step-actions">
        <button id="filter-back-btn" class="btn-secondary">上一步</button>
        <button id="filter-next-btn" class="btn-primary" disabled>预览视频列表</button>
      </div>
    </section>

    <!-- Step 3: Preview & Confirm -->
    <section id="step-preview" class="batch-step">
      <h2>Step 3: 预览 & 确认</h2>
      <div id="preview-summary"></div>
      <div id="preview-list" class="preview-list"></div>
      <div class="step-actions">
        <button id="preview-back-btn" class="btn-secondary">上一步</button>
        <button id="preview-start-btn" class="btn-primary">开始批量抓取</button>
      </div>
    </section>

    <!-- Step 4: Execution & Progress -->
    <section id="step-execute" class="batch-step">
      <h2>Step 4: 执行中</h2>
      <div class="progress-bar-container">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
      <div id="progress-stats"></div>
      <div id="progress-log" class="progress-log"></div>
      <div class="step-actions">
        <button id="execute-pause-btn" class="btn-secondary">暂停</button>
        <button id="execute-stop-btn" class="btn-danger">停止</button>
      </div>
    </section>

    <!-- Step 5: Completion Report -->
    <section id="step-complete" class="batch-step">
      <h2>Step 5: 完成报告</h2>
      <div id="complete-report"></div>
      <!-- systems-thinker fix: compilation gap exposure -->
      <div id="compilation-gap" class="compilation-gap" hidden></div>
      <div class="step-actions">
        <button id="complete-retry-btn" class="btn-secondary">重试失败项</button>
        <button id="complete-close-btn" class="btn-primary">关闭</button>
      </div>
    </section>

    <!-- Environment readiness banner -->
    <div id="env-banner" class="env-banner" hidden></div>
  </main>

  <script src="../core/utils.js"></script>
  <script src="../core/bilibili-api.js"></script>
  <script src="../core/subtitle-fetcher.js"></script>
  <script src="../core/markdown-builder.js"></script>
  <script src="../core/obsidian-client.js"></script>
  <script src="../core/subtitle-cache.js"></script>
  <script src="./batch.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify HTML well-formed**

```bash
# Manual verification: open in browser
```

---

### Task B2: Create batch/batch.css

**Files:**
- Create: `extension/batch/batch.css`

- [ ] **Step 1: Create batch/batch.css**

```css
/* BiliVault Batch Page Styles */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  line-height: 1.6;
  min-height: 100vh;
}

.batch-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 32px 24px;
}

.batch-header {
  text-align: center;
  margin-bottom: 40px;
}

.batch-header h1 {
  font-size: 28px;
  color: #00b4d8;
  margin-bottom: 8px;
}

.batch-subtitle {
  color: #888;
  font-size: 14px;
}

/* Steps */
.batch-step { display: none; }
.batch-step.active { display: block; }

.batch-step h2 {
  font-size: 20px;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid #333;
}

/* Preset Cards */
.source-presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.preset-card {
  background: #16213e;
  border: 2px solid #333;
  border-radius: 12px;
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  color: #e0e0e0;
  font-family: inherit;
  font-size: inherit;
}

.preset-card:hover { border-color: #00b4d8; background: #1a2744; }
.preset-card.selected { border-color: #00b4d8; background: #0f3460; }

.preset-icon { font-size: 32px; display: block; margin-bottom: 12px; }
.preset-card strong { display: block; margin-bottom: 4px; }
.preset-card small { color: #888; font-size: 12px; }

/* Source Detail */
.source-detail {
  background: #16213e;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
}

.source-detail input[type="text"],
.source-detail textarea {
  width: 100%;
  background: #0f3460;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px;
  color: #e0e0e0;
  font-size: 14px;
  margin-bottom: 12px;
}

.source-detail textarea { min-height: 100px; resize: vertical; }

/* Filter Pipeline */
.filter-stages { margin-bottom: 24px; }

.filter-stage {
  background: #16213e;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 12px;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.filter-toggle input[type="checkbox"] {
  width: 18px; height: 18px;
  accent-color: #00b4d8;
}

.filter-options {
  margin-top: 12px;
  padding-left: 28px;
}

.filter-options label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: #ccc;
}

.filter-number {
  width: 80px !important;
  padding: 6px 10px !important;
}

.filter-text {
  width: 100% !important;
  padding: 8px 12px !important;
}

.filter-hint { color: #666; font-size: 13px; }

.filter-summary {
  background: #0f3460;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

/* Preview List */
.preview-list {
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 24px;
}

.preview-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #222;
  font-size: 14px;
}

.preview-item .title { flex: 1; }
.preview-item .meta { color: #888; font-size: 12px; white-space: nowrap; }
.preview-item .status-ok { color: #4caf50; }
.preview-item .status-skip { color: #ff9800; }
.preview-item .status-fail { color: #f44336; }

/* Progress */
.progress-bar-container {
  background: #333;
  border-radius: 8px;
  height: 8px;
  margin-bottom: 20px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #00b4d8, #0096c7);
  border-radius: 8px;
  transition: width 0.3s;
  width: 0%;
}

#progress-stats {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  font-size: 14px;
}

.progress-log {
  background: #0a0a1a;
  border-radius: 8px;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
  margin-bottom: 24px;
}

.progress-log .log-ok { color: #4caf50; }
.progress-log .log-skip { color: #ff9800; }
.progress-log .log-fail { color: #f44336; }
.progress-log .log-info { color: #00b4d8; }

/* Compilation Gap (systems-thinker fix) */
.compilation-gap {
  background: #332200;
  border: 1px solid #ff9800;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 24px;
}

.compilation-gap.warning { border-color: #ff9800; }
.compilation-gap.critical { border-color: #f44336; background: #330000; }

.compilation-gap h3 { color: #ff9800; margin-bottom: 8px; }
.compilation-gap p { font-size: 14px; }

/* Environment Banner */
.env-banner {
  background: #330000;
  border: 1px solid #f44336;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 24px;
  font-size: 14px;
}

.env-banner.ok { background: #003300; border-color: #4caf50; }

/* Buttons */
.btn-primary {
  background: #00b4d8;
  color: #1a1a2e;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.3; cursor: not-allowed; }

.btn-secondary {
  background: #333;
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 16px;
  cursor: pointer;
}

.btn-secondary:hover { background: #444; }

.btn-danger {
  background: #c62828;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 16px;
  cursor: pointer;
}

.step-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

/* Status chips */
.source-status {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 14px;
}

.source-status.loading { background: #16213e; color: #00b4d8; }
.source-status.success { background: #003300; color: #4caf50; }
.source-status.error { background: #330000; color: #f44336; }
```

---

### Task B3: Create batch/batch.js

**Files:**
- Create: `extension/batch/batch.js`

核心批量逻辑。包含：环境就绪检查、来源解析、筛选管道、队列消费、进度报告、编译缺口暴露。

由于 batch.js 是整个系统中最复杂的文件，约 800-1000 行，这里展示核心架构和关键函数。

- [ ] **Step 1: Create batch.js — State & Environment Check**

```javascript
// BiliVault — Batch Ingestion Controller
(function () {
  if (typeof BOC === "undefined") {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:red;">Core modules not loaded. Reload extension.</div>';
    return;
  }

  // --- State ---
  var state = {
    step: "source",           // source | filter | preview | execute | complete
    sourceType: null,         // favorite | space | manual
    sourceInput: null,        // URL or BV list text
    sourceData: null,         // parsed: { mediaId, uid, bvList }
    allVideos: [],            // raw videos from source
    filteredVideos: [],       // after filter pipeline
    settings: {},
    apiClient: null,

    // Execution
    taskQueue: [],
    active: false,
    paused: false,
    completed: 0,
    skipped: 0,
    failed: 0,
    abortController: null,

    // Compilation gap tracking (systems-thinker fix)
    rawFileCount: 0,          // existing raw/ files before this batch
    newFileCount: 0           // files added by this batch
  };

  // --- Environment Readiness Check (engineer-advisor P0) ---
  function checkEnvironment() {
    var banner = document.getElementById("env-banner");
    
    // Check 1: Settings loaded?
    loadSettings().then(function (settings) {
      state.settings = settings;
      BOC.utils.setDebugEnabled(settings.enableDebugLogs);
      state.apiClient = BOC.api.createClient(BOC.api._chromeFetch);

      var issues = [];
      if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) {
        issues.push("Obsidian Local REST API 未配置——请在设置页填写地址和 API Key");
      }

      if (issues.length > 0) {
        banner.hidden = false;
        banner.className = "env-banner";
        banner.innerHTML = "⚠ 环境问题：<br>" + issues.map(function (i) { return "&nbsp;&nbsp;• " + i; }).join("<br>");
      } else {
        // All good — test Obsidian connection
        BOC.obsidian.testConnection(
          chrome.runtime.sendMessage.bind(chrome.runtime),
          settings.obsidianApiBaseUrl,
          settings.obsidianApiKey
        ).then(function () {
          banner.hidden = false;
          banner.className = "env-banner ok";
          banner.textContent = "✓ Obsidian 连接正常 | " + settings.noteFolder;
        }).catch(function () {
          banner.hidden = false;
          banner.className = "env-banner";
          banner.textContent = "⚠ 无法连接 Obsidian——请确认 Obsidian 已启动且 Local REST API 已启用";
        });
      }
    });
  }

  function loadSettings() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "get-settings" }, function (resp) {
        if (resp && resp.ok) { resolve(Object.assign({}, BOC.DEFAULT_SETTINGS, resp.settings)); }
        else { resolve(Object.assign({}, BOC.DEFAULT_SETTINGS)); }
      });
    });
  }
```

- [ ] **Step 2: Create batch.js — Source Resolution**

```javascript
  // --- Source Resolution ---
  function resolveSource() {
    showSourceStatus("正在解析来源...", "loading");

    if (state.sourceType === "favorite") {
      resolveFavoriteSource();
    } else if (state.sourceType === "space") {
      resolveSpaceSource();
    } else if (state.sourceType === "manual") {
      resolveManualSource();
    }
  }

  function resolveFavoriteSource() {
    // Extract media_id from URL like: https://www.bilibili.com/medialist/detail/ml88854277
    var match = state.sourceInput.match(/ml(\d+)/);
    if (!match) {
      // Try plain number
      var num = parseInt(state.sourceInput, 10);
      if (!isNaN(num) && num > 0) {
        match = [null, String(num)];
      }
    }
    if (!match) {
      showSourceStatus("无法识别收藏夹 ID——请粘贴收藏夹页面完整 URL", "error");
      return;
    }

    var mediaId = match[1];
    state.sourceData = { mediaId: mediaId };

    var url = "https://api.bilibili.com/medialist/gateway/base/spaceDetail" +
      "?media_id=" + mediaId + "&pn=1&ps=20&order=mtime&type=0&tid=0&jsonp=jsonp";

    fetchAllPages(url, "medias", 20).then(function (allMedias) {
      state.allVideos = allMedias.map(normalizeFavoriteItem);
      showSourceStatus("收藏夹: 找到 " + state.allVideos.length + " 个视频", "success");
      enableStep("filter");
    }).catch(function (error) {
      showSourceStatus("获取收藏夹失败: " + BOC.utils.getErrorMessage(error) + "（请确认收藏夹是公开的）", "error");
    });
  }

  function resolveSpaceSource() {
    // Extract UID from URL like: https://space.bilibili.com/243917657
    var match = state.sourceInput.match(/space\.bilibili\.com\/(\d+)/);
    if (!match) {
      var num = parseInt(state.sourceInput, 10);
      if (!isNaN(num) && num > 0) { match = [null, String(num)]; }
    }
    if (!match) {
      showSourceStatus("无法识别 UP主 UID——请粘贴 UP主主页完整 URL", "error");
      return;
    }

    var uid = match[1];
    state.sourceData = { uid: uid };

    // Fetch user info to confirm
    var userUrl = "https://api.bilibili.com/x/space/acc/info?mid=" + uid;
    state.apiClient.fetchVideoMeta("BV1xx411c7mD").then(function () {
      // Use space arc search (WBI-signed)
      var spaceUrl = "https://api.bilibili.com/x/space/wbi/arc/search" +
        "?mid=" + uid + "&pn=1&ps=30&order=pubdate";

      fetchAllPages(spaceUrl, "list.vlist", 30).then(function (allVideos) {
        state.allVideos = allVideos.map(normalizeSpaceItem);
        showSourceStatus("UP主空间: 找到 " + state.allVideos.length + " 个视频", "success");
        enableStep("filter");
      }).catch(function (error) {
        showSourceStatus("获取UP主视频列表失败: " + BOC.utils.getErrorMessage(error), "error");
      });
    }).catch(function () {
      // Fallback: try direct approach
      showSourceStatus("获取UP主信息失败，请确认 UID 正确", "error");
    });
  }

  function resolveManualSource() {
    var lines = state.sourceInput.split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var bvList = [];
    lines.forEach(function (line) {
      var bvMatch = line.match(/BV[0-9A-Za-z]+/);
      if (bvMatch) { bvList.push(bvMatch[0]); }
    });

    if (bvList.length === 0) {
      showSourceStatus("未找到有效的 BV 号", "error");
      return;
    }

    state.sourceData = { bvList: bvList };
    state.allVideos = bvList.map(function (bv) {
      return { bvid: bv, title: bv, duration: 0, author: "", uploadDate: "" };
    });

    showSourceStatus("手动输入: " + bvList.length + " 个 BV 号（将在抓取时获取详细信息）", "success");
    enableStep("filter");
  }

  // Fetch all pages of a paginated API
  function fetchAllPages(baseUrl, dataPath, pageSize, maxPages) {
    maxPages = maxPages || 50;
    var allItems = [];
    var page = 1;

    function fetchPage() {
      var url = baseUrl + "&pn=" + page + "&ps=" + pageSize;
      return state.apiClient.fetchSubtitleBody(url.replace(/\/medialist\/.*/, "/x/web-interface/view?bvid=placeholder"))
        .then(function () { throw new Error("not used"); })
        .catch(function () {
          // Use chrome fetch for non-B站-api URLs
          return new Promise(function (resolve, reject) {
            chrome.runtime.sendMessage({ type: "fetch-json", url: baseUrl + "&pn=" + page + "&ps=" + pageSize }, function (resp) {
              if (!resp || !resp.ok) { reject(new Error(resp && resp.error)); return; }
              var data = resp.data;
              var pathParts = dataPath.split(".");
              var items = pathParts.reduce(function (obj, key) { return (obj || {})[key]; }, data && data.data) || [];
              allItems = allItems.concat(Array.isArray(items) ? items : []);
              var hasMore = data && data.data && data.data.has_more;
              if (hasMore && page < maxPages) {
                page++;
                BOC.utils.sleep(400).then(fetchPage);
              } else {
                resolve(allItems);
              }
            });
          });
        });
    }

    return fetchPage();
  }

  function normalizeFavoriteItem(item) {
    return {
      bvid: item.bvid || item.bv_id || "",
      aid: String(item.id || ""),
      title: item.title || "",
      author: (item.upper && item.upper.name) || "",
      authorUid: (item.upper && String(item.upper.mid)) || "",
      duration: Number(item.duration || 0),
      uploadDate: item.pubtime ? BOC.utils.formatLocalDate(Number(item.pubtime) * 1000) : "",
      playCount: (item.cnt_info && item.cnt_info.play) || 0,
      source: "收藏夹",
      sourceType: "favorite"
    };
  }

  function normalizeSpaceItem(item) {
    return {
      bvid: item.bvid || "",
      aid: String(item.aid || item.param || ""),
      title: item.title || "",
      author: item.author || "",
      duration: Number(item.duration || item.length || 0),
      uploadDate: item.ctime ? BOC.utils.formatLocalDate(Number(item.ctime) * 1000) : "",
      playCount: Number(item.play || 0),
      source: "UP主空间",
      sourceType: "space"
    };
  }

  function showSourceStatus(text, type) {
    var el = document.getElementById("source-status");
    el.hidden = false;
    el.textContent = text;
    el.className = "source-status " + (type || "loading");
  }

  function enableStep(step) {
    if (step === "filter") {
      document.getElementById("source-next-btn").disabled = false;
    }
  }
```

- [ ] **Step 3: Create batch.js — Filter Pipeline**

```javascript
  // --- Filter Pipeline ---
  function applyFilters() {
    var videos = state.allVideos.slice();
    var stats = { total: videos.length };

    // Stage 0: Subtitle (always on for batch — must check per video during fetch)
    // Stage 1: Dedup — check against settings.noteFolder pattern
    // Stage 2: Duration
    if (document.getElementById("filter-duration").checked) {
      var minDur = parseInt(document.getElementById("duration-min").value, 10) * 60 || 0;
      var maxDur = parseInt(document.getElementById("duration-max").value, 10) * 60 || Infinity;
      videos = videos.filter(function (v) { return v.duration >= minDur && v.duration <= maxDur; });
      stats.afterDuration = videos.length;
    }

    // Stage 3: Keyword
    if (document.getElementById("filter-keyword").checked) {
      var include = document.getElementById("keyword-include").value.split(/[,，]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      var exclude = document.getElementById("keyword-exclude").value.split(/[,，]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      if (include.length > 0) {
        videos = videos.filter(function (v) {
          var title = v.title.toLowerCase();
          return include.some(function (kw) { return title.indexOf(kw) !== -1; });
        });
      }
      if (exclude.length > 0) {
        videos = videos.filter(function (v) {
          var title = v.title.toLowerCase();
          return !exclude.some(function (kw) { return title.indexOf(kw) !== -1; });
        });
      }
      stats.afterKeyword = videos.length;
    }

    // Stage 4: Date range
    if (document.getElementById("filter-daterange").checked) {
      var months = parseInt(document.getElementById("date-range-select").value, 10);
      if (months > 0) {
        var cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
        videos = videos.filter(function (v) {
          if (!v.uploadDate) { return true; } // keep if no date
          return new Date(v.uploadDate).getTime() >= cutoff;
        });
        stats.afterDate = videos.length;
      }
    }

    // Limit
    if (videos.length > 200) {
      videos = videos.slice(0, 200);
      stats.truncated = true;
    }

    state.filteredVideos = videos;
    updateFilterSummary(stats);
    document.getElementById("filter-next-btn").disabled = videos.length === 0;
  }

  function updateFilterSummary(stats) {
    document.getElementById("filter-summary").hidden = false;
    document.getElementById("filter-stats").innerHTML =
      "来源获取: " + stats.total + " → 筛选后: " + state.filteredVideos.length +
      (stats.truncated ? " (已截断至 200 个)" : "") +
      "<br>预计耗时: 约 " + Math.ceil(state.filteredVideos.length * 8 / 60) + " 分钟";
  }
```

- [ ] **Step 4: Create batch.js — Execution Engine & Compilation Gap**

```javascript
  // --- Execution Engine ---
  function startExecution() {
    state.step = "execute";
    state.active = true;
    state.paused = false;
    state.completed = 0;
    state.skipped = 0;
    state.failed = 0;
    state.taskQueue = state.filteredVideos.slice();
    state.abortController = new AbortController();

    showStep("execute");
    updateProgress();
    processNext();
  }

  function processNext() {
    if (!state.active || state.paused) { return; }
    if (state.taskQueue.length === 0) {
      finishExecution();
      return;
    }

    var video = state.taskQueue.shift();
    var settings = state.settings;

    logProgress("⏳ 正在抓取: " + video.title, "log-info");

    // Fetch video meta (for aid/cid)
    state.apiClient.fetchVideoMeta(video.bvid)
      .then(function (meta) {
        video.aid = meta.aid;
        video.cid = meta.defaultCid || "";
        video.title = meta.title || video.title;
        video.author = meta.author || video.author;
        video.uploadDate = meta.uploadDate || video.uploadDate;
        video.description = meta.description || "";

        // Duration filter (for manual mode where duration isn't pre-known)
        if (document.getElementById("filter-duration").checked) {
          var minDur = parseInt(document.getElementById("duration-min").value, 10) * 60 || 0;
          var maxDur = parseInt(document.getElementById("duration-max").value, 10) * 60 || Infinity;
          var dur = meta.defaultDuration || video.duration;
          if (dur < minDur || dur > maxDur) {
            state.skipped++;
            logProgress("⊘ " + video.title + " → 跳过（时长不符）", "log-skip");
            updateProgress();
            return scheduleNext();
          }
        }

        video.duration = meta.defaultDuration || video.duration;

        // Fetch subtitle bundle
        return state.apiClient.fetchSubtitleBundle(video.bvid, video.cid || meta.defaultCid, video.aid);
      })
      .then(function (bundle) {
        var tracks = BOC.subtitle.normalizeTracks(bundle.tracks);
        if (tracks.length === 0) {
          state.skipped++;
          logProgress("⊘ " + video.title + " → 跳过（无字幕）", "log-skip");
          updateProgress();
          return scheduleNext();
        }

        // Filter: CC-only
        var ccOnly = document.getElementById("filter-cc-only").checked;
        if (ccOnly) {
          tracks = tracks.filter(function (t) { return !BOC.subtitle.isAiSubtitle(t); });
          if (tracks.length === 0) {
            state.skipped++;
            logProgress("⊘ " + video.title + " → 跳过（无人工CC字幕）", "log-skip");
            updateProgress();
            return scheduleNext();
          }
        }

        var preferred = BOC.subtitle.pickPreferred(tracks, {});
        return state.apiClient.fetchSubtitleBody(preferred.subtitleUrl).then(function (subtitle) {
          var body = BOC.subtitle.parseBody(subtitle);
          var validation = BOC.subtitle.validateByDuration(body, video.duration);
          if (!validation.ok) {
            state.skipped++;
            logProgress("⊘ " + video.title + " → 跳过（字幕校验失败: " + validation.reason + "）", "log-skip");
            updateProgress();
            return scheduleNext();
          }

          // Build Markdown
          var meta = {
            bvid: video.bvid,
            aid: video.aid,
            cid: video.cid,
            title: video.title,
            url: "https://www.bilibili.com/video/" + video.bvid,
            author: video.author,
            authorUid: video.authorUid || "",
            uploadDate: video.uploadDate,
            description: video.description || "",
            videoDuration: video.duration,
            pageCount: 1,
            pageIndex: 1,
            pageTitle: "",
            selectedSubtitleLang: preferred.lanDoc || preferred.lan || "unknown",
            subtitleType: BOC.subtitle.isAiSubtitle(preferred) ? "ai" : "manual",
            chapters: BOC.subtitle.normalizeChapters(bundle.chapters),
            source: video.source || "",
            sourceType: video.sourceType || state.sourceType,
            durationSeconds: video.duration
          };

          var markdown = BOC.markdown.buildMarkdown(meta, body, settings);

          // Write to Obsidian
          var filename = BOC.markdown.buildNoteFilename(meta, settings);
          var folder = BOC.obsidian.normalizeFolder(settings.noteFolder || "");
          // Karpathy-style: organize by source type
          if (video.sourceType === "favorite") {
            folder = folder + "/favorite/" + BOC.utils.sanitizeFileName(video.source || "unknown");
          } else if (video.sourceType === "space") {
            folder = folder + "/space/" + BOC.utils.sanitizeFileName(video.author || "unknown");
          } else {
            folder = folder + "/manual";
          }
          var filepath = folder + "/" + filename;

          return BOC.obsidian.writeNote(
            chrome.runtime.sendMessage.bind(chrome.runtime),
            settings.obsidianApiBaseUrl,
            settings.obsidianApiKey,
            filepath,
            markdown
          ).then(function () {
            state.completed++;
            state.newFileCount++;
            logProgress("✓ " + video.title + " → Obsidian", "log-ok");
            updateProgress();
            return scheduleNext();
          });
        });
      })
      .catch(function (error) {
        state.failed++;
        logProgress("✗ " + video.title + " → " + BOC.utils.getErrorMessage(error), "log-fail");
        updateProgress();
        return scheduleNext();
      });
  }

  function scheduleNext() {
    // Rate limiting: 800-1800ms random delay between requests
    var delay = 800 + Math.floor(Math.random() * 1000);
    return BOC.utils.sleep(delay).then(function () { processNext(); });
  }

  function updateProgress() {
    var total = state.filteredVideos.length;
    var processed = state.completed + state.skipped + state.failed;
    var pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-stats").innerHTML =
      "✓ 成功: " + state.completed + " | ⊘ 跳过: " + state.skipped +
      " | ✗ 失败: " + state.failed + " | " + pct + "% (" + processed + "/" + total + ")";
  }

  function logProgress(text, className) {
    var log = document.getElementById("progress-log");
    var line = document.createElement("div");
    line.className = className || "";
    line.textContent = new Date().toLocaleTimeString() + " " + text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // --- Compilation Gap Exposure (systems-thinker P0) ---
  function showCompilationGap() {
    var gap = document.getElementById("compilation-gap");
    // Estimate: raw/ files now = previous count + new batch
    var estimatedTotal = state.rawFileCount + state.newFileCount;
    // Assume wiki/ coverage is low unless proven otherwise
    var severity = estimatedTotal > 50 ? "critical" : "warning";

    gap.hidden = false;
    gap.className = "compilation-gap " + severity;
    gap.innerHTML =
      "<h3>⚠ 知识库编译提醒</h3>" +
      "<p>本次新增 <strong>" + state.newFileCount + "</strong> 个文件到 raw/ 层。</p>" +
      "<p>raw/ 现在约有 <strong>" + estimatedTotal + "</strong> 个源文件。</p>" +
      (severity === "critical"
        ? "<p><strong>建议：</strong>在继续抓取之前，先让 LLM 编译至少 50 个文件到 wiki/。未编译的 raw/ 就像未读的书——它们不是知识，只是知识的占位符。</p>"
        : "<p>编译覆盖率跟踪将在后续 Phase 中自动提醒。</p>");
  }

  function finishExecution() {
    state.step = "complete";
    state.active = false;
    showStep("complete");

    document.getElementById("complete-report").innerHTML =
      "<p>✓ 成功写入 Obsidian: <strong>" + state.completed + "</strong> 个</p>" +
      "<p>⊘ 跳过（无字幕/校验失败）: <strong>" + state.skipped + "</strong> 个</p>" +
      "<p>✗ 失败: <strong>" + state.failed + "</strong> 个</p>";

    showCompilationGap();
  }

  // --- Step Navigation ---
  function showStep(step) {
    state.step = step;
    document.querySelectorAll(".batch-step").forEach(function (el) { el.classList.remove("active"); });
    var stepEl = document.getElementById("step-" + step);
    if (stepEl) { stepEl.classList.add("active"); }
  }
```

- [ ] **Step 5: Create batch.js — Event Bindings & Init**

```javascript
  // --- Event Bindings ---
  function bindEvents() {
    // Preset cards
    document.querySelectorAll(".preset-card").forEach(function (card) {
      card.addEventListener("click", function () {
        document.querySelectorAll(".preset-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        state.sourceType = card.dataset.preset;
        showSourceDetail(card.dataset.preset);
      });
    });

    // Filter toggles
    document.querySelectorAll(".filter-toggle input[type='checkbox']").forEach(function (cb) {
      cb.addEventListener("change", applyFilters);
    });
    document.querySelectorAll(".filter-options input, .filter-options select").forEach(function (el) {
      el.addEventListener("change", applyFilters);
      el.addEventListener("input", applyFilters);
    });

    // Source next
    document.getElementById("source-next-btn").addEventListener("click", function () {
      applyFilters();
      showStep("filter");
    });

    // Filter navigation
    document.getElementById("filter-back-btn").addEventListener("click", function () { showStep("source"); });
    document.getElementById("filter-next-btn").addEventListener("click", function () {
      renderPreview();
      showStep("preview");
    });

    // Preview navigation
    document.getElementById("preview-back-btn").addEventListener("click", function () { showStep("filter"); });
    document.getElementById("preview-start-btn").addEventListener("click", startExecution);

    // Execution controls
    document.getElementById("execute-pause-btn").addEventListener("click", function () {
      state.paused = !state.paused;
      this.textContent = state.paused ? "继续" : "暂停";
      if (!state.paused) { processNext(); }
    });
    document.getElementById("execute-stop-btn").addEventListener("click", function () {
      state.active = false;
      finishExecution();
    });

    // Complete
    document.getElementById("complete-retry-btn").addEventListener("click", function () {
      // Retry failed items
    });
    document.getElementById("complete-close-btn").addEventListener("click", function () { window.close(); });
  }

  function showSourceDetail(preset) {
    var detail = document.getElementById("source-detail");
    detail.hidden = false;

    if (preset === "favorite") {
      detail.innerHTML =
        '<label>收藏夹链接 或 收藏夹ID</label>' +
        '<input type="text" id="source-input" placeholder="https://www.bilibili.com/medialist/detail/ml88854277" />' +
        '<button id="source-resolve-btn" class="btn-primary" style="margin-top:8px;">解析收藏夹</button>';
    } else if (preset === "space") {
      detail.innerHTML =
        '<label>UP主主页链接 或 UID</label>' +
        '<input type="text" id="source-input" placeholder="https://space.bilibili.com/243917657" />' +
        '<p style="color:#888;font-size:12px;margin-top:4px;">将获取该UP主最近50个投稿视频</p>' +
        '<button id="source-resolve-btn" class="btn-primary" style="margin-top:8px;">获取视频列表</button>';
    } else if (preset === "manual") {
      detail.innerHTML =
        '<label>BV号列表（一行一个 或 逗号分隔）</label>' +
        '<textarea id="source-input" rows="6" placeholder="BV1xx411c7mD&#10;BV1zL4y1M78d&#10;..."></textarea>' +
        '<button id="source-resolve-btn" class="btn-primary" style="margin-top:8px;">解析BV列表</button>';
    }

    document.getElementById("source-resolve-btn").addEventListener("click", function () {
      state.sourceInput = document.getElementById("source-input").value.trim();
      if (!state.sourceInput) { return; }
      resolveSource();
    });
  }

  function renderPreview() {
    var list = document.getElementById("preview-list");
    document.getElementById("preview-summary").innerHTML =
      "<p>共 <strong>" + state.filteredVideos.length + "</strong> 个视频待抓取</p>";

    list.innerHTML = state.filteredVideos.map(function (v) {
      var durMin = Math.floor(v.duration / 60);
      var durSec = v.duration % 60;
      return '<div class="preview-item">' +
        '<span class="title">' + BOC.utils.escapeHtml(v.title) + '</span>' +
        '<span class="meta">' + (v.author || "?") + ' · ' + durMin + ':' + String(durSec).padStart(2, "0") + '</span>' +
        '</div>';
    }).join("");
  }

  // --- Init ---
  function init() {
    bindEvents();
    checkEnvironment();
  }

  init();
})();
```

- [ ] **Step 6: Verify syntax**

```bash
node --check extension/batch/batch.js
```

---

## Phase 3: Integration & Verification (Tasks C1-C3)

### Task C1: Move popup and options files

**Files:**
- Move: `extension/popup.html` → `extension/popup/popup.html`
- Move: `extension/popup.js` → `extension/popup/popup.js`
- Move: `extension/popup.css` → `extension/popup/popup.css`
- Move: `extension/options.html` → `extension/options/options.html`
- Move: `extension/options.js` → `extension/options/options.js`
- Move: `extension/options.css` → `extension/options/options.css`

- [ ] **Step 1: Create directories and move files**

```bash
mkdir -p extension/popup extension/options
mv extension/popup.html extension/popup/popup.html
mv extension/popup.js extension/popup/popup.js
mv extension/popup.css extension/popup/popup.css
mv extension/options.html extension/options/options.html
mv extension/options.js extension/options/options.js
mv extension/options.css extension/options/options.css
```

- [ ] **Step 2: Update internal references in popup.html**

In `extension/popup/popup.html`, change:
```html
<link rel="stylesheet" href="./popup.css" />
```
to:
```html
<link rel="stylesheet" href="./popup.css" />
```
(No change needed — relative paths stay the same within the directory)

And:
```html
<script src="./popup.js"></script>
```
(Also unchanged within popup/ directory)

- [ ] **Step 3: Update internal references in options.html**

Same check — internal references should remain relative within options/ directory.

- [ ] **Step 4: Update popup.js "打开批量页" button**

In `extension/popup/popup.js`, add a "batch" button to the popup:

After `el.sendBtn` event binding, add:
```javascript
// Add batch button event
var batchBtn = document.getElementById("batchBtn");
if (batchBtn) {
  batchBtn.addEventListener("click", function () {
    chrome.tabs.create({ url: chrome.runtime.getURL("batch/batch.html") });
  });
}
```

And in popup.html, add the button:
```html
<button id="batchBtn" type="button" class="batch-entry">批量抓取</button>
```

---

### Task C2: Final verification

- [ ] **Step 1: Syntax check all files**

```bash
for f in extension/core/*.js extension/content/*.js extension/batch/*.js extension/popup/*.js extension/options/*.js extension/background.js; do
  echo "=== $f ==="
  node --check "$f" && echo "OK" || echo "FAIL"
done
```

Expected: all files pass

- [ ] **Step 2: Verify manifest.json loads correct paths**

Ensure all paths in manifest.json match actual file locations:
```bash
echo "Checking manifest paths..."
grep -oP '"[^"]*\.(js|css|html)"' extension/manifest.json | while read -r path; do
  clean=$(echo "$path" | tr -d '"')
  if [ -f "extension/$clean" ]; then
    echo "  ✓ $clean"
  else
    echo "  ✗ MISSING: $clean"
  fi
done
```

- [ ] **Step 3: Package extension for testing**

```bash
cd extension && zip -r ../release/BiliVault-v2.0.0.zip . -x "*.git*" && cd ..
```

---

## Self-Review Checklist

- [ ] A1-A6: All core modules created, syntax passes
- [ ] A7: content.js refactored, <900 lines, all BOC.* delegations correct
- [ ] A8: background.js loads core via importScripts
- [ ] A9: manifest.json paths updated, batch.html web_accessible
- [ ] B1-B3: Batch page HTML/CSS/JS created, all 5 steps functional
- [ ] C1: File moves complete, internal references checked
- [ ] C2: Full syntax check passes, manifest validates
- [ ] Review fix: fetchFn injection (A2) ✓
- [ ] Review fix: compilation gap exposure (B3) ✓
- [ ] Review fix: log redaction (A1) ✓
- [ ] Review fix: preset templates (B1) ✓
- [ ] Review fix: environment check (B3) ✓
