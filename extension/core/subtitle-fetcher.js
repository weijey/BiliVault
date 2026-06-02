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

// --- Try candidates ---

BOC.subtitle.tryLoadCandidates = function (candidates, runId, loadFn) {
  var lastError = null;
  function tryNext(index) {
    if (index >= (candidates || []).length) {
      if (lastError) { return Promise.reject(lastError); }
      return Promise.reject(new Error("这个视频暂时没有可用字幕。"));
    }
    var item = candidates[index];
    BOC.utils.logInfo("[BOC] try subtitle track", { id: item.id, lan: item.lan, lanDoc: item.lanDoc });
    return loadFn(item.subtitleUrl, item.lanDoc || item.lan || "unknown", runId, item.id)
      .then(function () { return item; })
      .catch(function (error) {
        lastError = error;
        var reasonCode = BOC.utils.toReadableText(error && error.code, "");
        if (reasonCode === "SUBTITLE_DURATION_MISMATCH") {
          BOC.utils.logInfo("[BOC] subtitle track skipped " + JSON.stringify({ id: item.id, lan: item.lan, lanDoc: item.lanDoc, reason: reasonCode }));
        } else {
          BOC.utils.logWarn("[BOC] subtitle track rejected " + JSON.stringify({ id: item.id, lan: item.lan, lanDoc: item.lanDoc, reason: reasonCode || BOC.utils.getErrorMessage(error, "unknown") }));
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
