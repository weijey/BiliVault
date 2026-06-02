var BOC = BOC || {};
BOC.obsidian = BOC.obsidian || {};

BOC.obsidian.normalizeFolder = function (input) {
  return String(input || "").trim().replace(/^\/+|\/+$/g, "");
};

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
