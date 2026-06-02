var BOC = BOC || {};
BOC.markdown = BOC.markdown || {};

// --- Timestamp formatting ---

BOC.markdown.formatCompactTimestamp = function (seconds, withHours) {
  var safe = Math.max(0, Math.floor(Number(seconds) || 0));
  var hour = Math.floor(safe / 3600);
  var minute = Math.floor((safe % 3600) / 60);
  var second = safe % 60;
  if (withHours) {
    return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":" + String(second).padStart(2, "0");
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
  if (!forSrt) { return hh + ":" + mm + ":" + ss + "." + String(ms).padStart(3, "0"); }
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
    return "- `" + BOC.markdown.formatCompactTimestamp(item.from, withHours) + "` " + item.title;
  });
};

// --- Subtitle section lines ---

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

BOC.markdown.normalizeDownloadFormat = function (value) {
  return value === "txt" ? "txt" : "srt";
};
