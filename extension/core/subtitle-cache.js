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
