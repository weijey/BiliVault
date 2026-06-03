// Bilibili Obsidian Clipper — Content Script (UI Shell)
// Phase A: delegates business logic to BOC.* core modules.

(function () {
  if (window.__boc_content_loaded) { return; }
  if (typeof BOC === "undefined") {
    console.error("[BOC] Core modules not loaded — BOC namespace missing. Extension may need reload.");
    return;
  }
  window.__boc_content_loaded = true;

  // Create API client with Chrome fetch transport (architecture-guardian fix: fetchFn injection)
  var apiClient = BOC.api.createClient(BOC.api._chromeFetch);

  var state = {
    currentUrl: location.href,
    fetchRunId: 0,
    bvid: "",
    aid: "",
    cid: "",
    cidSource: "",
    pageIndex: 1,
    pageCount: 0,
    pageTitle: "",
    videoDuration: 0,
    description: "",
    title: "",
    author: "",
    uploadDate: "",
    subtitles: [],
    selectedSubtitleId: "",
    selectedSubtitleUrl: "",
    selectedSubtitleLang: "",
    subtitleBody: [],
    chapters: [],
    markdown: "",
    srt: "",
    txt: "",
    statusText: "准备就绪，点击“刷新抓取”开始。",
    messageText: "",
    settings: Object.assign({}, BOC.DEFAULT_SETTINGS)
  };

  var ids = {
    root: "boc-root",
    panel: "boc-panel",
    status: "boc-status",
    meta: "boc-meta",
    subtitleSelect: "boc-subtitle-select",
    preview: "boc-preview",
    message: "boc-message",
    copyBtn: "boc-copy-btn",
    downloadBtn: "boc-download-btn",
    sendBtn: "boc-send-btn",
    refreshBtn: "boc-refresh-btn",
    closeBtn: "boc-close-btn",
    settingsBtn: "boc-settings-btn"
  };

  init();

  function init() {
    var existingRoot = document.getElementById(ids.root);
    if (existingRoot) { existingRoot.remove(); }

    BOC.utils.logInfo("[BOC] content script loaded, version=" + BOC.BOC_VERSION);

    var root = document.createElement("div");
    root.id = ids.root;
    root.innerHTML = buildUiHtml();
    document.body.appendChild(root);

    bindUiEvents();
    bindRuntimeEvents();
    startUrlWatcher();
    getSettings().then(function (settings) { state.settings = settings; });
  }

  function bindRuntimeEvents() {
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || typeof message !== "object") { return false; }

      if (message.type === "popup-get-state") {
        sendResponse({ ok: true, payload: getPopupPayload() });
        return false;
      }

      if (message.type === "popup-refresh") {
        refreshClip()
          .then(function () { sendResponse({ ok: true, payload: getPopupPayload() }); })
          .catch(function (error) {
            sendResponse({ ok: false, error: BOC.utils.getErrorMessage(error), payload: getPopupPayload() });
          });
        return true;
      }

      if (message.type === "popup-select-subtitle") {
        var url = String(message.url || "").trim();
        var lang = String(message.lang || "unknown");
        var subtitleId = String(message.subtitleId || "");
        if (!url) {
          sendResponse({ ok: false, error: "Missing subtitle URL", payload: getPopupPayload() });
          return false;
        }
        loadSubtitle(url, lang, state.fetchRunId, subtitleId)
          .then(function () {
            setStatus("字幕切换完成。");
            renderSubtitleSelect();
            sendResponse({ ok: true, payload: getPopupPayload() });
          })
          .catch(function (error) {
            sendResponse({ ok: false, error: BOC.utils.getErrorMessage(error), payload: getPopupPayload() });
          });
        return true;
      }

      if (message.type === "popup-send-obsidian") {
        sendToObsidian()
          .then(function () { sendResponse({ ok: true, payload: getPopupPayload() }); })
          .catch(function (error) {
            sendResponse({ ok: false, error: BOC.utils.getErrorMessage(error), payload: getPopupPayload() });
          });
        return true;
      }

      return false;
    });
  }

  function buildUiHtml() {
    return '<aside id="' + ids.panel + '" aria-hidden="true">' +
      '<header class="boc-header"><strong>BiliVault</strong>' +
      '<div class="boc-header-actions">' +
      '<button id="' + ids.settingsBtn + '" type="button" title="插件设置">设置</button>' +
      '<button id="' + ids.closeBtn + '" type="button" title="关闭">关闭</button>' +
      '</div></header>' +
      '<p id="' + ids.status + '" class="boc-status">准备就绪，点击"刷新抓取"开始。</p>' +
      '<div class="boc-props-head">属性</div>' +
      '<div id="' + ids.meta + '" class="boc-meta"></div>' +
      '<label class="boc-label" for="' + ids.subtitleSelect + '">字幕语言</label>' +
      '<select id="' + ids.subtitleSelect + '" disabled><option value="">暂无字幕</option></select>' +
      '<label class="boc-label" for="' + ids.preview + '">字幕预览</label>' +
      '<textarea id="' + ids.preview + '" readonly></textarea>' +
      '<div class="boc-actions">' +
      '<button id="' + ids.refreshBtn + '" type="button">刷新抓取</button>' +
      '<button id="' + ids.copyBtn + '" type="button">复制完整 Markdown</button>' +
      '<button id="' + ids.downloadBtn + '" type="button">下载字幕</button>' +
      '<button id="' + ids.sendBtn + '" type="button">发送到 Obsidian</button>' +
      '</div><p id="' + ids.message + '" class="boc-message"></p></aside>';
  }

  function bindUiEvents() {
    var panel = byId(ids.panel);
    byId(ids.closeBtn).addEventListener("click", function () { panel.classList.remove("open"); });
    byId(ids.refreshBtn).addEventListener("click", refreshClip);
    byId(ids.subtitleSelect).addEventListener("change", onSubtitleChange);
    byId(ids.copyBtn).addEventListener("click", copyMarkdown);
    byId(ids.downloadBtn).addEventListener("click", downloadSubtitle);
    byId(ids.sendBtn).addEventListener("click", sendToObsidian);
    byId(ids.settingsBtn).addEventListener("click", requestOpenOptions);
  }

  function startUrlWatcher() {
    window.setInterval(function () {
      if (location.href === state.currentUrl) { return; }
      state.fetchRunId += 1;
      state.currentUrl = location.href;
      resetClipState();
      setStatus('检测到页面变化，请点击"刷新抓取"加载当前视频字幕。');
    }, 1200);
  }

  function resetClipState() {
    state.bvid = "";
    state.aid = "";
    state.cid = "";
    state.cidSource = "";
    state.pageIndex = 1;
    state.pageCount = 0;
    state.pageTitle = "";
    state.videoDuration = 0;
    state.description = "";
    state.title = "";
    state.author = "";
    state.uploadDate = "";
    state.subtitles = [];
    state.selectedSubtitleId = "";
    state.selectedSubtitleUrl = "";
    state.selectedSubtitleLang = "";
    state.subtitleBody = [];
    state.chapters = [];
    state.markdown = "";
    state.srt = "";
    state.txt = "";
    renderMeta();
    renderSubtitleSelect();
    byId(ids.preview).value = "";
    setMessage("");
  }

  // --- Core orchestration: refreshClip ---
  async function refreshClip() {
    var runId = ++state.fetchRunId;
    try {
      setBusyState(true);
      setMessage("");
      setStatus("正在抓取视频信息...");
      state.settings = await getSettings();
      ensureRunActive(runId);

      state.bvid = BOC.api.extractBvid(location.href);
      if (!state.bvid) { throw new Error("当前页面不是标准 BV 视频地址，无法抓取字幕。"); }

      var pageIndex = BOC.api.extractPageIndex(location.href);
      var oid = BOC.api.extractOid(location.href);
      var hasPageParam = BOC.api.hasExplicitPageParam(location.href);

      var meta = await BOC.api.retryAsync(function () { return apiClient.fetchVideoMeta(state.bvid); }, 2, 250);
      ensureRunActive(runId);

      BOC.utils.logInfo("[BOC] raw meta data", { defaultCid: meta.defaultCid, pagesCount: (meta.pages || []).length });

      state.aid = meta.aid || "";
      state.title = meta.title || readVideoTitle();
      state.author = meta.author || readVideoAuthor();
      state.uploadDate = meta.uploadDate || readUploadDate();
      state.description = meta.description || "";
      state.pageCount = Array.isArray(meta.pages) ? meta.pages.length : 0;

      var resolvedPageIndex = pageIndex;
      if ((meta.pages || []).length > 1 && !hasPageParam) {
        var pageIndexFromOid = BOC.api.pickPageIndexFromOid(meta.pages, oid);
        if (pageIndexFromOid > 0) { resolvedPageIndex = pageIndexFromOid; }
        else { resolvedPageIndex = 1; }
      }

      var currentPage = BOC.api.pickPageFromPages(meta.pages, resolvedPageIndex);
      state.pageIndex = resolvedPageIndex;
      state.pageTitle = (currentPage && currentPage.part) || "";
      state.cid = (currentPage && currentPage.cid) || BOC.api.pickCidFromPages(meta.pages, resolvedPageIndex, meta.defaultCid);
      state.cidSource = "meta-pages";
      state.videoDuration = BOC.api.pickDurationFromPages(meta.pages, resolvedPageIndex, meta.defaultDuration);
      if (!(state.videoDuration > 0)) { state.videoDuration = readRuntimeVideoDuration(); }
      if (!(state.videoDuration > 0)) { throw new Error("无法获取当前视频时长，已停止抓取以避免串到错误字幕。"); }

      BOC.utils.logInfo("[BOC] resolved video ids", {
        url: location.href, aid: state.aid, bvid: state.bvid, cid: state.cid,
        cidSource: state.cidSource, pageIndex: resolvedPageIndex, videoDuration: state.videoDuration
      });

      setStatus("正在获取可用字幕...");
      var subtitleBundle = await BOC.api.retryAsync(
        function () { return apiClient.fetchSubtitleBundle(state.bvid, state.cid, state.aid); }, 3, 500
      );
      ensureRunActive(runId);

      state.subtitles = BOC.subtitle.normalizeTracks(subtitleBundle.tracks);
      state.chapters = BOC.subtitle.normalizeChapters(subtitleBundle.chapters);

      if (state.subtitles.length === 0) { throw new Error("这个视频暂时没有可用字幕。"); }

      var preferred = BOC.subtitle.pickPreferred(state.subtitles, {
        previousId: state.selectedSubtitleId,
        previousUrl: state.selectedSubtitleUrl,
        previousLang: state.selectedSubtitleLang
      });
      if (!preferred) { throw new Error("这个视频暂时没有可用字幕。"); }

      var candidates = BOC.subtitle.buildCandidates(state.subtitles, preferred);
      var selected = null;

      try {
        selected = await BOC.subtitle.tryLoadCandidates(candidates, runId, function (url, lang, rid, sid) {
          return loadSubtitle(url, lang, rid, sid, true);
        });
      } catch (error) {
        var message = BOC.utils.getErrorMessage(error, "");
        if (!message.match(/HTTP/) && (error && error.code) !== "SUBTITLE_DURATION_MISMATCH") { throw error; }
        subtitleBundle = await BOC.api.retryAsync(
          function () { return apiClient.fetchSubtitleBundle(state.bvid, state.cid, state.aid); }, 2, 500
        );
        ensureRunActive(runId);
        state.subtitles = BOC.subtitle.normalizeTracks(subtitleBundle.tracks);
        state.chapters = BOC.subtitle.normalizeChapters(subtitleBundle.chapters);
        var retryPreferred = BOC.subtitle.pickPreferred(state.subtitles, {
          previousId: preferred.id,
          previousUrl: preferred.subtitleUrl,
          previousLang: preferred.lanDoc || preferred.lan || ""
        });
        if (!retryPreferred) { throw error; }
        var retryCandidates = BOC.subtitle.buildCandidates(state.subtitles, retryPreferred);
        selected = await BOC.subtitle.tryLoadCandidates(retryCandidates, runId, function (url, lang, rid, sid) {
          return loadSubtitle(url, lang, rid, sid, true);
        });
      }
      ensureRunActive(runId);

      renderMeta();
      renderSubtitleSelect();
      setStatus("抓取完成，可以复制、下载或发送到 Obsidian。");
    } catch (error) {
      if (BOC.utils.isStaleRunError(error)) { return; }
      resetClipState();
      if ((error && error.code) === "SUBTITLE_DURATION_MISMATCH") {
        setStatus("抓取失败：未找到与当前视频时长匹配的字幕轨，可能该视频无可用字幕。");
        return;
      }
      setStatus("抓取失败：" + BOC.utils.getErrorMessage(error));
    } finally {
      if (runId === state.fetchRunId) { setBusyState(false); }
    }
  }

  async function onSubtitleChange(event) {
    var value = event.target.value;
    var option = event.target.options[event.target.selectedIndex];
    var lang = (option && option.dataset.lang) || "unknown";
    var subtitleId = (option && option.dataset.id) || "";
    if (!value) { return; }
    try {
      setBusyState(true);
      setStatus("正在切换字幕：" + lang);
      setMessage("");
      await loadSubtitle(value, lang, state.fetchRunId, subtitleId);
      setStatus("字幕切换完成。");
    } catch (error) {
      if (BOC.utils.isStaleRunError(error)) { return; }
      setStatus("切换字幕失败：" + BOC.utils.getErrorMessage(error));
    } finally { setBusyState(false); }
  }

  async function loadSubtitle(url, lang, runId, subtitleId, forceRefresh) {
    if (!url) { throw new Error("字幕 URL 为空。"); }
    runId = runId || state.fetchRunId;
    forceRefresh = forceRefresh || false;

    var cacheKey = BOC.cache.getCacheKey(state.bvid, state.cid, subtitleId, url, lang);

    if (!forceRefresh) {
      var cachedBody = await BOC.cache.load(cacheKey);
      if (cachedBody && Array.isArray(cachedBody) && cachedBody.length > 0) {
        var cachedCheck = BOC.subtitle.validateByDuration(cachedBody, state.videoDuration);
        if (!cachedCheck.ok) {
          BOC.utils.logWarn("[BOC] cached subtitle duration mismatch, clearing cache", { cacheKey: cacheKey, reason: cachedCheck.reason });
          await BOC.cache.clear(cacheKey);
        } else {
          BOC.utils.logInfo("[BOC] using cached subtitle", { cacheKey: cacheKey, itemCount: cachedBody.length });
          ensureRunActive(runId);
          state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
          state.selectedSubtitleUrl = url;
          state.selectedSubtitleLang = lang;
          state.subtitleBody = cachedBody;
          setOutputs(cachedBody);
          return;
        }
      }
    }

    var subtitle = await apiClient.fetchSubtitleBody(url);
    ensureRunActive(runId);
    var body = BOC.subtitle.parseBody(subtitle);
    if (body.length === 0) { throw new Error("字幕文件为空。"); }

    var durationCheck = BOC.subtitle.validateByDuration(body, state.videoDuration);
    if (!durationCheck.ok) {
      var mismatchError = new Error("字幕时长与当前视频不匹配。");
      mismatchError.code = "SUBTITLE_DURATION_MISMATCH";
      mismatchError.details = durationCheck;
      throw mismatchError;
    }

    await BOC.cache.save(cacheKey, body);

    state.selectedSubtitleId = subtitleId ? String(subtitleId) : state.selectedSubtitleId;
    state.selectedSubtitleUrl = url;
    state.selectedSubtitleLang = lang;
    state.subtitleBody = body;
    setOutputs(body);
  }

  function setOutputs(body) {
    var meta = {
      bvid: state.bvid, aid: state.aid, cid: state.cid,
      title: state.title, url: location.href,
      author: state.author, uploadDate: state.uploadDate,
      description: state.description, videoDuration: state.videoDuration,
      pageCount: state.pageCount, pageIndex: state.pageIndex,
      pageTitle: state.pageTitle,
      selectedSubtitleLang: state.selectedSubtitleLang,
      chapters: state.chapters
    };
    state.markdown = BOC.markdown.buildMarkdown(meta, body, state.settings);
    state.srt = BOC.markdown.buildSrt(body);
    state.txt = BOC.markdown.buildTxt(body, state.settings);
    byId(ids.preview).value = BOC.markdown.buildPreview(body, state.settings);
  }

  function renderMeta() {
    var meta = byId(ids.meta);
    if (!state.bvid) { meta.innerHTML = '<div class="boc-meta-item">尚未抓取视频信息</div>'; return; }
    var subtitleCount = state.subtitles.length;
    meta.innerHTML =
      '<div class="boc-meta-item"><strong>标题：</strong>' + BOC.utils.escapeHtml(state.title) + '</div>' +
      '<div class="boc-meta-item"><strong>URL：</strong>' + BOC.utils.escapeHtml(location.href) + '</div>' +
      '<div class="boc-meta-item"><strong>作者：</strong>' + BOC.utils.escapeHtml(state.author || "未知") + '</div>' +
      '<div class="boc-meta-item"><strong>日期：</strong>' + BOC.utils.escapeHtml(state.uploadDate || "未知") + '</div>' +
      '<div class="boc-meta-item"><strong>字幕轨：</strong>' + subtitleCount + '</div>';
  }

  function renderSubtitleSelect() {
    var select = byId(ids.subtitleSelect);
    var subtitles = state.subtitles || [];
    if (subtitles.length === 0) {
      select.innerHTML = '<option value="">暂无字幕</option>';
      select.disabled = true;
      return;
    }
    select.innerHTML = subtitles.map(function (item) {
      var selectedById = state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
      var selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
      var selected = selectedById || selectedByUrl ? "selected" : "";
      var label = item.lanDoc || item.lan || "unknown";
      var isAi = BOC.subtitle.isAiSubtitle(item);
      var aiTag = isAi ? " [AI自动]" : "";
      return '<option value="' + BOC.utils.escapeHtml(item.subtitleUrl) + '" data-lang="' + BOC.utils.escapeHtml(label) + '" data-id="' + BOC.utils.escapeHtml(String(item.id || "")) + '" ' + selected + '>' + BOC.utils.escapeHtml(label + aiTag) + '</option>';
    }).join("");
    select.disabled = false;
  }

  function getPopupPayload() {
    var subtitleOptions = (state.subtitles || []).map(function (item) {
      var label = item.lanDoc || item.lan || "unknown";
      var isAi = BOC.subtitle.isAiSubtitle(item);
      var selectedById = state.selectedSubtitleId && String(item.id) === String(state.selectedSubtitleId);
      var selectedByUrl = item.subtitleUrl === state.selectedSubtitleUrl;
      return { id: String(item.id || ""), url: item.subtitleUrl, lang: label, isAi: isAi, selected: selectedById || selectedByUrl };
    });
    return {
      url: location.href, title: state.title || "", author: state.author || "",
      uploadDate: state.uploadDate || "", tags: String(state.settings.tags || ""),
      status: state.statusText || "", message: state.messageText || "",
      subtitlePreview: BOC.markdown.buildPreview(state.subtitleBody || [], state.settings),
      markdown: state.markdown || "", srt: state.srt || "", txt: state.txt || "",
      downloadFormat: BOC.markdown.normalizeDownloadFormat(state.settings.downloadFormat),
      subtitleOptions: subtitleOptions
    };
  }

  async function copyMarkdown() {
    if (!state.markdown) { setMessage("没有可复制的内容，请先刷新抓取。"); return; }
    try {
      await navigator.clipboard.writeText(state.markdown);
      setMessage("Markdown 已复制到剪贴板。");
    } catch (error) { setMessage("复制失败：" + BOC.utils.getErrorMessage(error)); }
  }

  async function downloadSubtitle() {
    state.settings = await getSettings();
    var format = BOC.markdown.normalizeDownloadFormat(state.settings.downloadFormat);
    var content = format === "txt" ? state.txt : state.srt;
    if (!content) { setMessage("没有可下载的字幕，请先刷新抓取。"); return; }
    var safeTitle = BOC.utils.sanitizeFileName(state.title || state.bvid || "bilibili-subtitle");
    var langSuffix = BOC.utils.sanitizeFileName(state.selectedSubtitleLang || "subtitle") || "subtitle";
    var filename = safeTitle + "." + langSuffix + "." + format;
    var blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setMessage("已下载：" + filename);
  }

  async function sendToObsidian() {
    state.settings = await getSettings();
    if (!state.markdown) { setMessage("没有可发送内容，请先刷新抓取。"); return; }
    var filename = BOC.markdown.buildNoteFilename({
      bvid: state.bvid, title: state.title,
      pageCount: state.pageCount, pageIndex: state.pageIndex, pageTitle: state.pageTitle
    }, state.settings);
    var folder = BOC.obsidian.normalizeFolder(state.settings.noteFolder || "");
    var filepath = folder ? folder + "/" + filename : filename;
    var baseUrl = String(state.settings.obsidianApiBaseUrl || "").trim();
    var apiKey = String(state.settings.obsidianApiKey || "").trim();
    if (!baseUrl || !apiKey) {
      setMessage("请先在设置中填写 Obsidian Local REST API 地址和 API Key。");
      requestOpenOptions();
      return;
    }
    try {
      await BOC.obsidian.writeNote(
        chrome.runtime.sendMessage.bind(chrome.runtime), baseUrl, apiKey, filepath, state.markdown
      );
      setMessage("已写入 Obsidian：" + filepath);
    } catch (error) {
      if (BOC.utils.isExtensionContextInvalidated(error)) { setMessage("扩展刚刚更新，请刷新当前页面后重试。"); return; }
      setMessage("写入失败：" + BOC.utils.getErrorMessage(error));
    }
  }

  function setBusyState(disabled) {
    byId(ids.copyBtn).disabled = disabled;
    byId(ids.downloadBtn).disabled = disabled;
    byId(ids.sendBtn).disabled = disabled;
    byId(ids.refreshBtn).disabled = disabled;
    byId(ids.settingsBtn).disabled = disabled;
    byId(ids.subtitleSelect).disabled = disabled || state.subtitles.length === 0;
  }

  function setStatus(text) { state.statusText = String(text || ""); byId(ids.status).textContent = state.statusText; }
  function setMessage(text) { state.messageText = String(text || ""); byId(ids.message).textContent = state.messageText; }

  function ensureRunActive(runId) {
    if (runId !== state.fetchRunId) { var err = new Error("Stale refresh run"); err.code = "STALE_RUN"; throw err; }
  }

  function sendRuntimeMessage(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (resp) {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          resolve(resp);
        });
      } catch (error) { reject(error); }
    });
  }

  function requestOpenOptions() {
    sendRuntimeMessage({ type: "open-options" }).catch(function (error) {
      if (BOC.utils.isExtensionContextInvalidated(error)) { setMessage("扩展刚刚更新，请刷新当前页面后重试。"); }
    });
  }

  async function getSettings() {
    try {
      var resp = await sendRuntimeMessage({ type: "get-settings" });
      if (!resp || !resp.ok) { return Object.assign({}, BOC.DEFAULT_SETTINGS); }
      return Object.assign({}, BOC.DEFAULT_SETTINGS, resp.settings || {});
    } catch (error) { return Object.assign({}, BOC.DEFAULT_SETTINGS); }
  }

  function byId(id) { var node = document.getElementById(id); if (!node) { throw new Error("Missing node: " + id); } return node; }

  // --- DOM readers (platform-specific, stay in content script) ---
  function readVideoTitle() {
    var h1 = document.querySelector("h1.video-title");
    if (h1 && h1.textContent && h1.textContent.trim()) { return h1.textContent.trim(); }
    var metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle && metaTitle.getAttribute("content")) { return metaTitle.getAttribute("content").trim(); }
    return document.title.replace(/_哔哩哔哩_bilibili/i, "").trim();
  }

  function readVideoAuthor() {
    var owner = document.querySelector(".up-name");
    if (owner && owner.textContent && owner.textContent.trim()) { return owner.textContent.trim(); }
    var author = document.querySelector('meta[name="author"]');
    return (author && author.getAttribute("content") && author.getAttribute("content").trim()) || "";
  }

  function readUploadDate() {
    var publishNode = document.querySelector('meta[itemprop="uploadDate"]');
    if (publishNode && publishNode.getAttribute("content")) { return publishNode.getAttribute("content").trim(); }
    var dateText = (document.querySelector(".pubdate-ip-text") || {}).textContent;
    if (dateText) { return dateText.trim(); }
    return BOC.utils.formatLocalDate();
  }

  function readRuntimeVideoDuration() {
    var video = document.querySelector("video");
    var duration = Number(video && video.duration);
    return (isFinite(duration) && duration > 0) ? duration : 0;
  }

})();
