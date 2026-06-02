// BiliVault — Batch Ingestion Controller
(function () {
  if (typeof BOC === "undefined") {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:red;">Core modules not loaded. Reload extension.</div>';
    return;
  }

  var state = {
    step: "source",
    sourceType: null,
    sourceInput: null,
    sourceData: null,
    allVideos: [],
    filteredVideos: [],
    settings: {},
    apiClient: null,
    taskQueue: [],
    active: false,
    paused: false,
    completed: 0,
    skipped: 0,
    failed: 0,
    rawFileCount: 0,
    newFileCount: 0
  };

  // --- Environment Readiness Check ---
  function checkEnvironment() {
    var banner = document.getElementById("env-banner");
    loadSettings().then(function (settings) {
      state.settings = settings;
      BOC.utils.setDebugEnabled(settings.enableDebugLogs);
      state.apiClient = BOC.api.createClient(BOC.api._chromeFetch);

      var issues = [];
      if (!settings.obsidianApiBaseUrl || !settings.obsidianApiKey) {
        issues.push("Obsidian Local REST API 未配置");
      }
      if (issues.length > 0) {
        banner.removeAttribute("hidden");
        banner.className = "env-banner";
        banner.innerHTML = "环境问题：<br>" + issues.map(function (i) { return "  " + i; }).join("<br>");
        return;
      }
      BOC.obsidian.testConnection(
        chrome.runtime.sendMessage.bind(chrome.runtime),
        settings.obsidianApiBaseUrl,
        settings.obsidianApiKey
      ).then(function () {
        banner.removeAttribute("hidden");
        banner.className = "env-banner ok";
        banner.textContent = "Obsidian 连接正常 | " + settings.noteFolder;
      }).catch(function () {
        banner.removeAttribute("hidden");
        banner.className = "env-banner";
        banner.textContent = "无法连接 Obsidian";
      });
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

  // --- Source Resolution ---
  function resolveSource() {
    showSourceStatus("正在解析来源...", "loading");
    if (state.sourceType === "favorite") { resolveFavoriteSource(); }
    else if (state.sourceType === "space") { resolveSpaceSource(); }
    else if (state.sourceType === "manual") { resolveManualSource(); }
  }

  function resolveFavoriteSource() {
    var match = state.sourceInput.match(/ml(\d+)/);
    if (!match) {
      var num = parseInt(state.sourceInput, 10);
      if (!isNaN(num) && num > 0) { match = [null, String(num)]; }
    }
    if (!match) {
      showSourceStatus("无法识别收藏夹 ID。请粘贴完整收藏夹页面 URL", "error");
      return;
    }
    var mediaId = match[1];
    state.sourceData = { mediaId: mediaId };
    fetchFavoritePages(mediaId, 1, []);
  }

  function fetchFavoritePages(mediaId, page, allMedias) {
    var url = "https://api.bilibili.com/medialist/gateway/base/spaceDetail" +
      "?media_id=" + mediaId + "&pn=" + page + "&ps=20&order=mtime&type=0&tid=0&jsonp=jsonp";

    chrome.runtime.sendMessage({ type: "fetch-json", url: url }, function (resp) {
      if (!resp || !resp.ok) {
        showSourceStatus("获取收藏夹失败（请确认收藏夹是公开的）", "error");
        return;
      }
      var data = resp.data;
      var medias = (data && data.data && data.data.medias) || [];
      allMedias = allMedias.concat(medias);

      var hasMore = data && data.data && data.data.has_more;
      if (hasMore && page < 50) {
        BOC.utils.sleep(400).then(function () { fetchFavoritePages(mediaId, page + 1, allMedias); });
      } else {
        state.allVideos = allMedias.map(normalizeFavoriteItem);
        showSourceStatus("收藏夹: 找到 " + state.allVideos.length + " 个视频", "success");
        enableNextStep();
      }
    });
  }

  function resolveSpaceSource() {
    var match = state.sourceInput.match(/space\.bilibili\.com\/(\d+)/);
    if (!match) {
      var num = parseInt(state.sourceInput, 10);
      if (!isNaN(num) && num > 0) { match = [null, String(num)]; }
    }
    if (!match) {
      showSourceStatus("无法识别 UP主 UID", "error");
      return;
    }
    var uid = match[1];
    state.sourceData = { uid: uid };
    showSourceStatus("UP主空间来源尚在开发中，请使用收藏夹导入", "error");
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
      return { bvid: bv, title: bv, duration: 0, author: "", uploadDate: "", source: "手动输入", sourceType: "manual" };
    });
    showSourceStatus("手动输入: " + bvList.length + " 个 BV 号", "success");
    enableNextStep();
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

  function showSourceStatus(text, type) {
    var el = document.getElementById("source-status");
    el.removeAttribute("hidden");
    el.textContent = text;
    el.className = "source-status " + (type || "loading");
  }

  function enableNextStep() {
    document.getElementById("source-next-btn").disabled = false;
  }

  // --- Filter Pipeline ---
  function applyFilters() {
    var videos = state.allVideos.slice();
    if (document.getElementById("filter-duration").checked) {
      var minDur = parseInt(document.getElementById("duration-min").value, 10) * 60 || 0;
      var maxDur = parseInt(document.getElementById("duration-max").value, 10) * 60 || Infinity;
      videos = videos.filter(function (v) { return v.duration >= minDur && v.duration <= maxDur; });
    }
    if (document.getElementById("filter-keyword").checked) {
      var include = document.getElementById("keyword-include").value.split(/[,，]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      var exclude = document.getElementById("keyword-exclude").value.split(/[,，]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      if (include.length > 0) {
        videos = videos.filter(function (v) { return include.some(function (kw) { return v.title.toLowerCase().indexOf(kw) !== -1; }); });
      }
      if (exclude.length > 0) {
        videos = videos.filter(function (v) { return !exclude.some(function (kw) { return v.title.toLowerCase().indexOf(kw) !== -1; }); });
      }
    }
    if (document.getElementById("filter-daterange").checked) {
      var months = parseInt(document.getElementById("date-range-select").value, 10);
      if (months > 0) {
        var cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
        videos = videos.filter(function (v) {
          if (!v.uploadDate) { return true; }
          return new Date(v.uploadDate).getTime() >= cutoff;
        });
      }
    }
    if (videos.length > 200) { videos = videos.slice(0, 200); }
    state.filteredVideos = videos;
    updateFilterSummary();
    document.getElementById("filter-next-btn").disabled = videos.length === 0;
  }

  function updateFilterSummary() {
    var el = document.getElementById("filter-summary");
    el.removeAttribute("hidden");
    var total = state.allVideos.length;
    var filtered = state.filteredVideos.length;
    document.getElementById("filter-stats").innerHTML =
      "来源获取: " + total + "  → 筛选后: " + filtered +
      (filtered >= 200 ? " (已截断至 200 个)" : "") +
      "<br>预计耗时: 约 " + Math.ceil(filtered * 8 / 60) + " 分钟";
  }

  // --- Execution Engine ---
  function startExecution() {
    state.step = "execute";
    state.active = true;
    state.paused = false;
    state.completed = 0;
    state.skipped = 0;
    state.failed = 0;
    state.taskQueue = state.filteredVideos.slice();
    showStep("execute");
    updateProgress();
    processNext();
  }

  function processNext() {
    if (!state.active || state.paused) { return; }
    if (state.taskQueue.length === 0) { finishExecution(); return; }

    var video = state.taskQueue.shift();
    logProgress("正在抓取: " + video.title, "log-info");

    state.apiClient.fetchVideoMeta(video.bvid)
      .then(function (meta) {
        video.aid = meta.aid;
        video.cid = meta.defaultCid || "";
        video.title = meta.title || video.title;
        video.author = meta.author || video.author;
        video.uploadDate = meta.uploadDate || video.uploadDate;
        video.description = meta.description || "";
        video.duration = meta.defaultDuration || video.duration;

        if (document.getElementById("filter-duration").checked) {
          var minDur = parseInt(document.getElementById("duration-min").value, 10) * 60 || 0;
          var maxDur = parseInt(document.getElementById("duration-max").value, 10) * 60 || Infinity;
          if (video.duration < minDur || video.duration > maxDur) {
            state.skipped++;
            logProgress("跳过（时长不符）: " + video.title, "log-skip");
            updateProgress();
            return scheduleNext();
          }
        }
        return state.apiClient.fetchSubtitleBundle(video.bvid, video.cid, video.aid);
      })
      .then(function (bundle) {
        if (!bundle) { throw new Error("No bundle"); }
        var tracks = BOC.subtitle.normalizeTracks(bundle.tracks);
        if (tracks.length === 0) {
          state.skipped++;
          logProgress("跳过（无字幕）: " + video.title, "log-skip");
          updateProgress();
          return scheduleNext();
        }

        var ccOnly = document.getElementById("filter-cc-only").checked;
        if (ccOnly) {
          tracks = tracks.filter(function (t) { return !BOC.subtitle.isAiSubtitle(t); });
          if (tracks.length === 0) {
            state.skipped++;
            logProgress("跳过（无人工CC字幕）: " + video.title, "log-skip");
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
            logProgress("跳过（字幕校验失败: " + validation.reason + "）: " + video.title, "log-skip");
            updateProgress();
            return scheduleNext();
          }

          var meta = {
            bvid: video.bvid, aid: video.aid, cid: video.cid,
            title: video.title,
            url: "https://www.bilibili.com/video/" + video.bvid,
            author: video.author,
            authorUid: video.authorUid || "",
            uploadDate: video.uploadDate,
            description: video.description || "",
            videoDuration: video.duration,
            pageCount: 1, pageIndex: 1, pageTitle: "",
            selectedSubtitleLang: preferred.lanDoc || preferred.lan || "unknown",
            subtitleType: BOC.subtitle.isAiSubtitle(preferred) ? "ai" : "manual",
            chapters: BOC.subtitle.normalizeChapters(bundle.chapters),
            source: video.source || "",
            sourceType: video.sourceType || state.sourceType,
            durationSeconds: video.duration
          };

          var markdown = BOC.markdown.buildMarkdown(meta, body, state.settings);
          var filename = BOC.markdown.buildNoteFilename(meta, state.settings);
          var folder = BOC.obsidian.normalizeFolder(state.settings.noteFolder || "");
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
            state.settings.obsidianApiBaseUrl,
            state.settings.obsidianApiKey,
            filepath,
            markdown
          ).then(function () {
            state.completed++;
            state.newFileCount++;
            logProgress("OK: " + video.title, "log-ok");
            updateProgress();
            return scheduleNext();
          });
        });
      })
      .catch(function (error) {
        state.failed++;
        logProgress("失败: " + video.title + " — " + BOC.utils.getErrorMessage(error), "log-fail");
        updateProgress();
        return scheduleNext();
      });
  }

  function scheduleNext() {
    var delay = 800 + Math.floor(Math.random() * 1000);
    setTimeout(function () { processNext(); }, delay);
  }

  function updateProgress() {
    var total = state.filteredVideos.length;
    var processed = state.completed + state.skipped + state.failed;
    var pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-stats").innerHTML =
      "OK: " + state.completed + " | 跳过: " + state.skipped +
      " | 失败: " + state.failed + " | " + pct + "% (" + processed + "/" + total + ")";
  }

  function logProgress(text, className) {
    var log = document.getElementById("progress-log");
    var line = document.createElement("div");
    line.className = className || "";
    line.textContent = new Date().toLocaleTimeString() + " " + text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function finishExecution() {
    state.step = "complete";
    state.active = false;
    showStep("complete");
    document.getElementById("complete-report").innerHTML =
      "<p>成功写入 Obsidian: <strong>" + state.completed + "</strong> 个</p>" +
      "<p>跳过（无字幕/校验失败）: <strong>" + state.skipped + "</strong> 个</p>" +
      "<p>失败: <strong>" + state.failed + "</strong> 个</p>";
    showCompilationGap();
  }

  // --- Compilation Gap Exposure ---
  function showCompilationGap() {
    var gap = document.getElementById("compilation-gap");
    var estimatedTotal = state.rawFileCount + state.newFileCount;
    var severity = estimatedTotal > 50 ? "critical" : "warning";
    gap.removeAttribute("hidden");
    gap.className = "compilation-gap " + severity;
    gap.innerHTML =
      "<h3>知识库编译提醒</h3>" +
      "<p>本次新增 <strong>" + state.newFileCount + "</strong> 个文件到 raw/ 层。</p>" +
      "<p>raw/ 现在约有 <strong>" + estimatedTotal + "</strong> 个源文件。</p>" +
      (severity === "critical"
        ? "<p><strong>建议：</strong>在继续抓取之前，先让 LLM 编译至少 50 个文件到 wiki/。未编译的 raw/ 只是知识的占位符。</p>"
        : "<p>编译覆盖率跟踪将在后续 Phase 中自动提醒。</p>");
  }

  // --- Step Navigation ---
  function showStep(step) {
    state.step = step;
    document.querySelectorAll(".batch-step").forEach(function (el) { el.classList.remove("active"); });
    var stepEl = document.getElementById("step-" + step);
    if (stepEl) { stepEl.classList.add("active"); }
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
        '<span class="meta">' + (v.author || "?") + " " + durMin + ":" + String(durSec).padStart(2, "0") + '</span>' +
        '</div>';
    }).join("");
  }

  // --- Event Bindings ---
  function bindEvents() {
    document.querySelectorAll(".preset-card").forEach(function (card) {
      card.addEventListener("click", function () {
        document.querySelectorAll(".preset-card").forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        state.sourceType = card.dataset.preset;
        showSourceDetail(card.dataset.preset);
      });
    });

    document.querySelectorAll(".filter-toggle input[type='checkbox']").forEach(function (cb) {
      cb.addEventListener("change", applyFilters);
    });
    document.querySelectorAll(".filter-options input, .filter-options select").forEach(function (el) {
      el.addEventListener("change", applyFilters);
      el.addEventListener("input", applyFilters);
    });

    document.getElementById("source-next-btn").addEventListener("click", function () {
      applyFilters();
      showStep("filter");
    });

    document.getElementById("filter-back-btn").addEventListener("click", function () { showStep("source"); });
    document.getElementById("filter-next-btn").addEventListener("click", function () {
      renderPreview();
      showStep("preview");
    });

    document.getElementById("preview-back-btn").addEventListener("click", function () { showStep("filter"); });
    document.getElementById("preview-start-btn").addEventListener("click", startExecution);

    document.getElementById("execute-pause-btn").addEventListener("click", function () {
      state.paused = !state.paused;
      this.textContent = state.paused ? "继续" : "暂停";
      if (!state.paused) { processNext(); }
    });
    document.getElementById("execute-stop-btn").addEventListener("click", function () {
      state.active = false;
      finishExecution();
    });

    document.getElementById("complete-close-btn").addEventListener("click", function () { window.close(); });
    document.getElementById("complete-retry-btn").addEventListener("click", function () {
      state.taskQueue = state.filteredVideos.slice();
      state.completed = 0; state.skipped = 0; state.failed = 0;
      startExecution();
    });
  }

  function showSourceDetail(preset) {
    var detail = document.getElementById("source-detail");
    detail.removeAttribute("hidden");
    if (preset === "favorite") {
      detail.innerHTML =
        '<label>收藏夹链接 或 收藏夹ID</label>' +
        '<input type="text" id="source-input" placeholder="https://www.bilibili.com/medialist/detail/ml88854277" />' +
        '<button id="source-resolve-btn" class="btn-primary" style="margin-top:8px;">解析收藏夹</button>';
    } else if (preset === "space") {
      detail.innerHTML =
        '<label>UP主主页链接 或 UID</label>' +
        '<input type="text" id="source-input" placeholder="https://space.bilibili.com/243917657" />' +
        '<p style="color:#888;font-size:12px;margin-top:4px;">尚在开发中，请使用收藏夹导入</p>' +
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

  // --- Init ---
  function init() {
    bindEvents();
    checkEnvironment();
  }

  init();
})();
