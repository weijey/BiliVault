var BOC = BOC || {};
BOC.api = BOC.api || {};

/**
 * Create a Bilibili API client with injected fetch transport.
 * fetchFn(url) must return a Promise that resolves to the JSON-parsed response body.
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
        source: request.source, url: request.url, bvid: bvid, cid: cid, aid: aid
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

    if (requests.length === 0) { return Promise.resolve({ tracks: [], chapters: [] }); }

    var primaryRequest = requests[0];
    return fetchByRequest(primaryRequest).then(function (primaryResult) {
      if (primaryResult.withUrl.length > 0) {
        return { tracks: primaryResult.withUrl, chapters: primaryResult.chapters };
      }
      return { tracks: [], chapters: primaryResult.chapters };
    }).catch(function (primaryError) {
      BOC.utils.logWarn("[BOC] subtitles API request failed", {
        source: primaryRequest.source, message: BOC.utils.getErrorMessage(primaryError)
      });
      if (requests.length > 1) {
        var secondaryRequest = requests[1];
        return fetchByRequest(secondaryRequest).then(function (secondaryResult) {
          if (secondaryResult.withUrl.length > 0) {
            BOC.utils.logWarn("[BOC] primary subtitles source failed, using fallback", {
              primary: primaryRequest.source, fallback: secondaryRequest.source
            });
            return { tracks: secondaryResult.withUrl, chapters: secondaryResult.chapters };
          }
          return { tracks: [], chapters: secondaryResult.chapters };
        }).catch(function (secondaryError) {
          BOC.utils.logWarn("[BOC] fallback subtitles source failed", {
            source: secondaryRequest.source, message: BOC.utils.getErrorMessage(secondaryError)
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

  function fetchSpaceVideos(uid, opts) {
    return BOC.api._fetchSpaceVideos(uid, fetchJson, opts);
  }

  return {
    fetchVideoMeta: fetchVideoMeta,
    fetchSubtitleBundle: fetchSubtitleBundle,
    fetchSubtitleBody: fetchSubtitleBody,
    fetchSpaceVideos: fetchSpaceVideos
  };
};

// --- Private helpers ---

BOC.api._buildSubtitleInfoRequests = function (bvid, cid, aid) {
  var safeBvid = encodeURIComponent(String(bvid || ""));
  var safeCid = encodeURIComponent(String(cid || ""));
  var safeAid = encodeURIComponent(String(aid || ""));
  var requests = [];

  if (aid) {
    requests.push({
      source: "player-wbi-v2",
      url: "https://api.bilibili.com/x/player/wbi/v2" +
        "?aid=" + safeAid + "&cid=" + safeCid + (bvid ? "&bvid=" + safeBvid : "")
    });
  }
  requests.push({
    source: "player-v2",
    url: "https://api.bilibili.com/x/player/v2" +
      (bvid ? "?bvid=" + safeBvid : "?") + (bvid ? "&" : "") + "cid=" + safeCid +
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

// --- Page helpers ---

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

// --- WBI Signing (for space arc search + future WBI endpoints) ---

BOC.api._WBI_MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
  0, 39, 42, 13, 16, 48, 57, 51, 34, 1, 20, 44, 6, 54, 22, 55,
  4, 24, 36, 25, 41, 26, 38, 40, 59, 11, 60, 21, 17, 30, 61, 62
];

BOC.api._wbiKeyCache = { imgKey: "", subKey: "", expiresAt: 0 };

BOC.api._getMixinKey = function (imgKey, subKey) {
  var combined = imgKey + subKey;
  var mixed = "";
  for (var i = 0; i < BOC.api._WBI_MIXIN_TAB.length; i++) {
    mixed += combined.charAt(BOC.api._WBI_MIXIN_TAB[i]);
  }
  return mixed.substring(0, 32);
};

/**
 * Fetch WBI keys from /x/web-interface/nav. Keys rotate daily — cached.
 */
BOC.api._fetchWbiKeys = function (fetchFn) {
  var now = Date.now();

  // Cache hit: reuse keys if not expired (24h TTL)
  if (BOC.api._wbiKeyCache.imgKey && BOC.api._wbiKeyCache.expiresAt > now) {
    return Promise.resolve({
      imgKey: BOC.api._wbiKeyCache.imgKey,
      subKey: BOC.api._wbiKeyCache.subKey
    });
  }

  return fetchFn("https://api.bilibili.com/x/web-interface/nav").then(function (payload) {
    var data = payload && payload.data;
    if (!data) { throw new Error("Failed to fetch WBI keys — nav API returned no data. code=" + (payload && payload.code)); }

    var wbiImg = data.wbi_img || {};
    var imgUrl = String(wbiImg.img_url || "");
    var subUrl = String(wbiImg.sub_url || "");

    var imgKey = imgUrl.split("/").pop().replace(/\.png$/, "");
    var subKey = subUrl.split("/").pop().replace(/\.png$/, "");

    if (!imgKey || !subKey) {
      throw new Error(
        "Failed to extract WBI keys. img=" + (imgKey || "EMPTY") +
        " sub=" + (subKey || "EMPTY") +
        " imgUrl=" + imgUrl.substring(Math.max(0, imgUrl.length - 30)) +
        " subUrl=" + subUrl.substring(Math.max(0, subUrl.length - 30))
      );
    }

    BOC.api._wbiKeyCache = {
      imgKey: imgKey,
      subKey: subKey,
      expiresAt: now + 24 * 60 * 60 * 1000
    };

    return { imgKey: imgKey, subKey: subKey };
  });
};

/**
 * Compute WBI-signed parameters for a given param dict.
 * Returns a URL query string with w_rid and wts appended.
 */
BOC.api._computeWbiSignature = function (params, imgKey, subKey) {
  var mixinKey = BOC.api._getMixinKey(imgKey, subKey);
  var wts = String(Math.floor(Date.now() / 1000));

  var allParams = {};
  Object.keys(params).forEach(function (k) { allParams[k] = params[k]; });
  allParams.wts = wts;

  // Sort by key
  var sortedKeys = Object.keys(allParams).sort();
  var queryParts = [];
  sortedKeys.forEach(function (k) {
    var v = String(allParams[k]);
    // Filter special chars
    v = v.replace(/[!'()*]/g, "");
    queryParts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  });
  var queryStr = queryParts.join("&");

  var wRid = BOC.utils.md5(queryStr + mixinKey);
  return queryStr + "&w_rid=" + wRid;
};

/**
 * Fetch UP主空间视频列表. Requires WBI signing.
 *
 * @param {string} uid - UP主 UID
 * @param {function} fetchFn - injected fetch transport
 * @param {object} opts - { order: 'pubdate'|'click'|'stow', count: number, tid: number }
 * @returns {Promise<Array>} normalized video items
 */
BOC.api._fetchSpaceVideos = function (uid, fetchFn, opts) {
  opts = opts || {};
  var order = opts.order || "pubdate";
  var targetCount = Math.min(opts.count || 50, 200);
  var tid = opts.tid || 0;

  return BOC.api._fetchWbiKeys(fetchFn).then(function (keys) {
    var allVideos = [];
    var page = 1;
    var ps = 30; // max per page

    function fetchPage() {
      if (allVideos.length >= targetCount) { return Promise.resolve(allVideos.slice(0, targetCount)); }

      var params = {
        mid: uid,
        pn: String(page),
        ps: String(ps),
        order: order,
        platform: "web"
      };
      if (tid > 0) { params.tid = String(tid); }

      var signedQuery = BOC.api._computeWbiSignature(params, keys.imgKey, keys.subKey);
      var url = "https://api.bilibili.com/x/space/wbi/arc/search?" + signedQuery;

      return fetchFn(url).then(function (payload) {
        if (payload.code !== 0) {
          var msg = BOC.utils.toReadableText(payload && payload.message, "");
          var code = payload && payload.code;
          throw new Error((msg || "获取失败") + " (code: " + code + ")");
        }
        var data = payload.data || {};
        var list = (data.list && data.list.vlist) || [];
        allVideos = allVideos.concat(list);

        var hasMore = data.list && data.list.vlist && data.list.vlist.length >= ps;
        if (hasMore && allVideos.length < targetCount) {
          page++;
          return BOC.utils.sleep(300).then(fetchPage);
        }
        return allVideos.slice(0, targetCount);
      });
    }

    return fetchPage();
  });
};

// --- Transport layer ---

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
