# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

BiliVault — B站视频字幕 → Obsidian 知识库摄取系统。Chrome Manifest V3 扩展。

不是"字幕下载器"，是 **Karpathy 式知识库 raw/ 层构建器**。输出进入 `raw/` 后，由 LLM 编译为 `wiki/` 层结构化知识。

## 常用命令

```bash
# 语法检查所有 JS 文件
find extension -name '*.js' -exec node --check {} \;

# 打包扩展到桌面
python3 -c "import zipfile,os;ext='extension';z=zipfile.ZipFile('/mnt/c/Users/weijey/Desktop/BiliVault.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.relpath(os.path.join(r,f),ext)) for r,_,fs in os.walk(ext) for f in fs];z.close()"
```

## 架构

```
extension/
├── core/           # 纯逻辑，零 DOM/Chrome API 依赖（唯一例外: _chromeFetch 传输层）
│   ├── utils.js        # 格式化、转义、结构化日志（auth_key 脱敏）
│   ├── bilibili-api.js # B站 API 封装，createClient(fetchFn) 依赖注入
│   ├── subtitle-fetcher.js  # 字幕轨排序/选择、body 解析、时长校验
│   ├── markdown-builder.js  # Markdown/SRT/TXT 生成、frontmatter
│   ├── obsidian-client.js   # Obsidian Local REST API 写入
│   └── subtitle-cache.js    # chrome.storage.local 缓存
├── content/        # 视频页注入(UI 壳)
├── batch/          # 批量摄取独立页面
├── popup/          # 扩展弹出面板 + "批量抓取"入口
├── options/        # 设置页
├── background.js   # Service Worker: 消息路由 + CORS 代理 + Obsidian API
└── manifest.json   # v2.0.0
```

**依赖方向**：`core/` ← `content/` `batch/` `popup/` `background.js`

**全局命名空间**：所有模块通过 `BOC.*` 暴露。非 ES module，使用 `var BOC = BOC || {}` 模式。加载方式：
- Content script: manifest.json `content_scripts.js` 数组按依赖顺序加载
- Service Worker: `importScripts()` 加载
- batch.html: `<script>` 标签按依赖顺序加载

**核心设计模式 — fetchFn 注入**：`BOC.api.createClient(fetchFn)` 接收网络传输函数，不直接依赖 `chrome.runtime.sendMessage`。`BOC.api._chromeFetch` 是 Chrome 扩展传输实现。这使核心逻辑可脱离浏览器环境测试。

**消息通信**：Popup → Content Script (`chrome.tabs.sendMessage`) → Background (`chrome.runtime.sendMessage`)。Background 代理所有 B站 API 请求以绕过 CORS。

## 当前阶段

**Phase A — Core Refactor** ✅ 完成。content.js 从 1999 行拆分为 6 个 core 模块 + 574 行 UI 壳。

**UP主空间来源** — 标记为"尚在开发中"。需要实现 B站 WBI 签名算法（`/x/space/wbi/arc/search`）。

## 非显而易见模式

- `content.js` 必须在 manifest `content_scripts.js` 数组的**最后**（依赖前面的 core 模块）
- `chrome.storage.local` 仅用于字幕缓存和 API Key — 大体积数据后续应迁移到 IndexedDB
- 所有 B站 API 调用通过 background.js 的 `fetch-json` 消息代理，不在 content script 中直接 fetch
- 字幕缓存 key 格式：`boc_subtitle_cache_{bvid}_{cid}_{sourceKey}`
- batch.js 的筛选管道在视频详情获取**前**做粗筛，获取**后**做精筛（例如时长通过 API 返回的 duration 再次校验）

## 关键设计文档

- 批量摄取实现计划: `docs/superpowers/plans/2026-06-02-batch-ingestion.md`
- 全局工程方法论: `/home/weijey/CLAUDE.md`
