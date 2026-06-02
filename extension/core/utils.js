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

// --- MD5 Hash (pure JS, no external deps — Web Crypto API lacks MD5) ---

BOC.utils.md5 = (function () {
  function rotateLeft(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function addUnsigned(x, y) {
    var lsw = ((x & 0xffff) + (y & 0xffff)) >>> 0;
    var msw = ((x >>> 16) + (y >>> 16) + (lsw >>> 16)) >>> 0;
    return ((msw << 16) | (lsw & 0xffff)) >>> 0;
  }
  function F(x, y, z) { return (x & y) | ((~x) & z); }
  function G(x, y, z) { return (x & z) | (y & (~z)); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | (~z)); }
  function FF(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, F(b, c, d)), addUnsigned(x, ac)), s), b); }
  function GG(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, G(b, c, d)), addUnsigned(x, ac)), s), b); }
  function HH(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, H(b, c, d)), addUnsigned(x, ac)), s), b); }
  function II(a, b, c, d, x, s, ac) { return addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, I(b, c, d)), addUnsigned(x, ac)), s), b); }

  function convertToWordArray(str) {
    var len = str.length;
    var words = [];
    for (var i = 0; i < len - 3; i += 4) {
      words.push((str.charCodeAt(i) & 0xff) | ((str.charCodeAt(i + 1) & 0xff) << 8) |
        ((str.charCodeAt(i + 2) & 0xff) << 16) | ((str.charCodeAt(i + 3) & 0xff) << 24));
    }
    var remainder = len % 4;
    if (remainder === 1) {
      words.push(str.charCodeAt(len - 1) & 0xff);
    } else if (remainder === 2) {
      words.push((str.charCodeAt(len - 2) & 0xff) | ((str.charCodeAt(len - 1) & 0xff) << 8));
    } else if (remainder === 3) {
      words.push((str.charCodeAt(len - 3) & 0xff) | ((str.charCodeAt(len - 2) & 0xff) << 8) | ((str.charCodeAt(len - 1) & 0xff) << 16));
    }
    return words;
  }

  function wordToHex(w) {
    return (w & 0xff).toString(16).padStart(2, "0") +
      ((w >>> 8) & 0xff).toString(16).padStart(2, "0") +
      ((w >>> 16) & 0xff).toString(16).padStart(2, "0") +
      ((w >>> 24) & 0xff).toString(16).padStart(2, "0");
  }

  var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  var S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  return function (str) {
    // Convert to bytes, pad per RFC 1321, then convert to little-endian words
    var utf8 = BOC.utils._utf8Encode(str);
    var bytes = [];
    for (var bi = 0; bi < utf8.length; bi++) {
      bytes.push(utf8.charCodeAt(bi) & 0xff);
    }
    var bitLen = utf8.length * 8;
    bytes.push(0x80);
    while ((bytes.length + 8) % 64 !== 0) { bytes.push(0); }
    // Encode 64-bit length: JS >>> wraps at 32, split manually
    var lenLow = bitLen >>> 0;
    var lenHigh = Math.floor(bitLen / 0x100000000);
    for (var bi2 = 0; bi2 < 4; bi2++) {
      bytes.push((lenLow >>> (bi2 * 8)) & 0xff);
    }
    for (var bi2 = 0; bi2 < 4; bi2++) {
      bytes.push((lenHigh >>> (bi2 * 8)) & 0xff);
    }

    var words = [];
    for (var wi = 0; wi < bytes.length; wi += 4) {
      words.push(
        (bytes[wi] & 0xff) |
        ((bytes[wi + 1] & 0xff) << 8) |
        ((bytes[wi + 2] & 0xff) << 16) |
        ((bytes[wi + 3] & 0xff) << 24)
      );
    }

    var a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

    for (var i = 0; i < words.length; i += 16) {
      var aa = a, bb = b, cc = c, dd = d;
      a = FF(a, b, c, d, words[i + 0], S11, 0xd76aa478);
      d = FF(d, a, b, c, words[i + 1], S12, 0xe8c7b756);
      c = FF(c, d, a, b, words[i + 2], S13, 0x242070db);
      b = FF(b, c, d, a, words[i + 3], S14, 0xc1bdceee);
      a = FF(a, b, c, d, words[i + 4], S11, 0xf57c0faf);
      d = FF(d, a, b, c, words[i + 5], S12, 0x4787c62a);
      c = FF(c, d, a, b, words[i + 6], S13, 0xa8304613);
      b = FF(b, c, d, a, words[i + 7], S14, 0xfd469501);
      a = FF(a, b, c, d, words[i + 8], S11, 0x698098d8);
      d = FF(d, a, b, c, words[i + 9], S12, 0x8b44f7af);
      c = FF(c, d, a, b, words[i + 10], S13, 0xffff5bb1);
      b = FF(b, c, d, a, words[i + 11], S14, 0x895cd7be);
      a = FF(a, b, c, d, words[i + 12], S11, 0x6b901122);
      d = FF(d, a, b, c, words[i + 13], S12, 0xfd987193);
      c = FF(c, d, a, b, words[i + 14], S13, 0xa679438e);
      b = FF(b, c, d, a, words[i + 15], S14, 0x49b40821);

      a = GG(a, b, c, d, words[i + 1], S21, 0xf61e2562);
      d = GG(d, a, b, c, words[i + 6], S22, 0xc040b340);
      c = GG(c, d, a, b, words[i + 11], S23, 0x265e5a51);
      b = GG(b, c, d, a, words[i + 0], S24, 0xe9b6c7aa);
      a = GG(a, b, c, d, words[i + 5], S21, 0xd62f105d);
      d = GG(d, a, b, c, words[i + 10], S22, 0x2441453);
      c = GG(c, d, a, b, words[i + 15], S23, 0xd8a1e681);
      b = GG(b, c, d, a, words[i + 4], S24, 0xe7d3fbc8);
      a = GG(a, b, c, d, words[i + 9], S21, 0x21e1cde6);
      d = GG(d, a, b, c, words[i + 14], S22, 0xc33707d6);
      c = GG(c, d, a, b, words[i + 3], S23, 0xf4d50d87);
      b = GG(b, c, d, a, words[i + 8], S24, 0x455a14ed);
      a = GG(a, b, c, d, words[i + 13], S21, 0xa9e3e905);
      d = GG(d, a, b, c, words[i + 2], S22, 0xfcefa3f8);
      c = GG(c, d, a, b, words[i + 7], S23, 0x676f02d9);
      b = GG(b, c, d, a, words[i + 12], S24, 0x8d2a4c8a);

      a = HH(a, b, c, d, words[i + 5], S31, 0xfffa3942);
      d = HH(d, a, b, c, words[i + 8], S32, 0x8771f681);
      c = HH(c, d, a, b, words[i + 11], S33, 0x6d9d6122);
      b = HH(b, c, d, a, words[i + 14], S34, 0xfde5380c);
      a = HH(a, b, c, d, words[i + 1], S31, 0xa4beea44);
      d = HH(d, a, b, c, words[i + 4], S32, 0x4bdecfa9);
      c = HH(c, d, a, b, words[i + 7], S33, 0xf6bb4b60);
      b = HH(b, c, d, a, words[i + 10], S34, 0xbebfbc70);
      a = HH(a, b, c, d, words[i + 13], S31, 0x289b7ec6);
      d = HH(d, a, b, c, words[i + 0], S32, 0xeaa127fa);
      c = HH(c, d, a, b, words[i + 3], S33, 0xd4ef3085);
      b = HH(b, c, d, a, words[i + 6], S34, 0x4881d05);
      a = HH(a, b, c, d, words[i + 9], S31, 0xd9d4d039);
      d = HH(d, a, b, c, words[i + 12], S32, 0xe6db99e5);
      c = HH(c, d, a, b, words[i + 15], S33, 0x1fa27cf8);
      b = HH(b, c, d, a, words[i + 2], S34, 0xc4ac5665);

      a = II(a, b, c, d, words[i + 0], S41, 0xf4292244);
      d = II(d, a, b, c, words[i + 7], S42, 0x432aff97);
      c = II(c, d, a, b, words[i + 14], S43, 0xab9423a7);
      b = II(b, c, d, a, words[i + 5], S44, 0xfc93a039);
      a = II(a, b, c, d, words[i + 12], S41, 0x655b59c3);
      d = II(d, a, b, c, words[i + 3], S42, 0x8f0ccc92);
      c = II(c, d, a, b, words[i + 10], S43, 0xffeff47d);
      b = II(b, c, d, a, words[i + 1], S44, 0x85845dd1);
      a = II(a, b, c, d, words[i + 8], S41, 0x6fa87e4f);
      d = II(d, a, b, c, words[i + 15], S42, 0xfe2ce6e0);
      c = II(c, d, a, b, words[i + 6], S43, 0xa3014314);
      b = II(b, c, d, a, words[i + 13], S44, 0x4e0811a1);
      a = II(a, b, c, d, words[i + 4], S41, 0xf7537e82);
      d = II(d, a, b, c, words[i + 11], S42, 0xbd3af235);
      c = II(c, d, a, b, words[i + 2], S43, 0x2ad7d2bb);
      b = II(b, c, d, a, words[i + 9], S44, 0xeb86d391);

      a = addUnsigned(a, aa); b = addUnsigned(b, bb);
      c = addUnsigned(c, cc); d = addUnsigned(d, dd);
    }

    return wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
  };
})();

BOC.utils._utf8Encode = function (str) {
  str = str.replace(/\r\n/g, "\n");
  var utf = "";
  for (var i = 0; i < str.length; i++) {
    var ch = str.charCodeAt(i);
    if (ch < 0x80) { utf += String.fromCharCode(ch); }
    else if (ch < 0x800) { utf += String.fromCharCode(0xc0 | (ch >> 6)) + String.fromCharCode(0x80 | (ch & 0x3f)); }
    else if (ch < 0xd800 || ch >= 0xe000) {
      utf += String.fromCharCode(0xe0 | (ch >> 12)) + String.fromCharCode(0x80 | ((ch >> 6) & 0x3f)) + String.fromCharCode(0x80 | (ch & 0x3f));
    } else {
      i++;
      ch = 0x10000 + (((ch & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf += String.fromCharCode(0xf0 | (ch >> 18)) + String.fromCharCode(0x80 | ((ch >> 12) & 0x3f)) +
        String.fromCharCode(0x80 | ((ch >> 6) & 0x3f)) + String.fromCharCode(0x80 | (ch & 0x3f));
    }
  }
  return utf;
};
