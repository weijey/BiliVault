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
