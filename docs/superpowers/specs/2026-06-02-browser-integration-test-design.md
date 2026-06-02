# BiliVault 浏览器集成测试 — Design Spec

**Date:** 2026-06-02
**Status:** APPROVED
**Target:** `tests/` directory at project root

## 1. 目标

为 BiliVault Chrome MV3 扩展建立可重复运行的浏览器实机验证体系。
覆盖三个关键路径：

| 路径 | 优先级 | 说明 |
|------|--------|------|
| 视频页字幕抓取 | P0 | content.js 注入 → 抓取字幕 → 输出 Markdown/SRT |
| 批量页5步流程 | P0 | 来源选择 → 筛选 → 预览 → 执行 → 完成报告 |
| Popup 消息通信 | P1 | popup → content script round-trip |

## 2. 技术选型

**Playwright Test** — 理由：

- 内置 Chromium 扩展加载支持 (`launchOptions.args: [--load-extension]`)
- `page.evaluate()` 直接访问页面内 BOC.* 命名空间
- 自动等待 + trace viewer + HTML 报告
- 比 Puppeteer 更好的 worker 进程管理和超时处理
- `browserContext.backgroundPages()` 可访问 Service Worker

## 3. 架构

```
tests/
├── playwright.config.ts       # 全局配置
├── fixtures/
│   ├── videos.json            # 测试视频矩阵
│   └── mock-obsidian.ts       # Mock Obsidian Local REST API Server
├── helpers/
│   ├── extension.ts           # 扩展工具函数
│   └── networks.ts            # API 响应拦截
├── content/
│   └── video-page.spec.ts     # 单视频抓取测试
├── batch/
│   └── batch-flow.spec.ts     # 批量页测试
└── package.json
```

### 3.1 Mock Obsidian Server

测试前启动一个 HTTP server（Node.js `http` 模块），监听 `localhost:27124`：

- `GET /` → 返回 `{"authenticated": true, "service": "mock-obsidian"}`
- `PUT /vault/*` → 记录请求 body 到内存数组，返回 200
- `GET /__recordings` → 返回所有记录的写入（供断言用）
- `DELETE /__recordings` → 清空记录
- `POST /__fail-next` → 下次写入返回 500（模拟 Obsidian 离线）

测试前在 options 页设置 `obsidianApiBaseUrl=http://127.0.0.1:27124`。

### 3.2 测试视频矩阵 (fixtures/videos.json)

```json
[
  {
    "name": "single-paged-with-cc",
    "url": "https://www.bilibili.com/video/BV1MU411S7iJ",
    "expectSubtitle": true
  },
  {
    "name": "no-subtitle-video",
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "expectSubtitle": false
  }
]
```

实际 BV 号在实现时确认（需要真实有字幕的视频）。

### 3.3 扩展加载

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    launchOptions: {
      args: [
        `--disable-extensions-except=${path.resolve('extension')}`,
        `--load-extension=${path.resolve('extension')}`,
      ],
    },
  },
});
```

## 4. 测试用例设计

### 4.1 视频页注入 (video-page.spec.ts)

```
Test: "Core modules load on B站 video page"
  1. 导航到测试视频 URL
  2. 等待 #boc-root 出现
  3. page.evaluate(() => typeof BOC.BOC_VERSION) 断言为非 undefined
  4. page.evaluate(() => BOC.api.createClient) 断言为 function
  5. 确认所有 6 个 core 模块命名空间存在

Test: "Refresh clip fetches subtitle"
  1. 导航到测试视频 URL
  2. 等待 #boc-root 可见
  3. page.click('#boc-refresh-btn')
  4. 等待 #boc-status 包含 "抓取完成"
  5. 断言 #boc-preview textarea 非空
  6. 断言 BOC.subtitle.VideoClip（内存状态）有 title/bvid/cid

Test: "Subtitle language switching"
  1. 完成 refresh clip
  2. page.selectOption('#boc-subtitle-select', { index: 1 })  // 切到第二轨
  3. 等待 #boc-status 包含 "字幕切换完成"
  4. 断言 preview 内容已变化

Test: "Copy Markdown to clipboard"
  1. 完成 refresh clip
  2. page.click('#boc-copy-btn')
  3. 断言 #boc-message 包含 "已复制"

Test: "Send to Obsidian writes correct data"
  1. 完成 refresh clip
  2. 设置 obsidianApiBaseUrl = http://127.0.0.1:27124
  3. page.click('#boc-send-btn')
  4. 等待 #boc-message 包含 "已写入"
  5. fetch mock server /__recordings → 断言 PUT 请求存在
  6. 断言 PUT body 包含 frontmatter（title/bvid/author）
  7. 断言 PUT body 包含 "## 字幕" 章节
  8. 断言 PUT path 格式为 {folder}/{date}-{title}.md

Test: "Download produces file"
  1. 完成 refresh clip
  2. 监听 download 事件
  3. page.click('#boc-download-btn')
  4. 断言下载文件名匹配 *.srt 或 *.txt

Test: "No-subtitle video shows error"
  1. 导航到无字幕视频
  2. page.click('#boc-refresh-btn')
  3. 等待 #boc-status 包含 "失败" 或 "无可用字幕"
```

### 4.2 批量页流程 (batch-flow.spec.ts)

```
Test: "Batch page loads core modules"
  1. 获取 extension ID
  2. 导航到 chrome-extension://{id}/batch/batch.html
  3. page.evaluate(() => BOC.BOC_VERSION) → 非空
  4. 断言 5 个 step section 存在

Test: "Environment check shows Obsidian status"
  1. 打开 batch.html
  2. Mock server 在线 → 等待 #env-banner 出现且 class 包含 "ok"
  3. Mock server 离线 → 等待 #env-banner 出现且含 "无法连接"

Test: "Favorite source resolution"
  1. 打开 batch.html
  2. page.click('.preset-card[data-preset="favorite"]')
  3. page.fill('#source-input', 'https://www.bilibili.com/medialist/detail/ml88854277')
  4. page.click('#source-resolve-btn')
  5. 等待 #source-status 且 class 包含 "success"
  6. 如果收藏夹公开且有视频 → 断言显示 "找到 N 个视频"
  7. page.click('#source-next-btn') → 断言跳转至 filter step

Test: "Manual BV source resolution"
  1. 打开 batch.html
  2. page.click('.preset-card[data-preset="manual"]')
  3. page.fill('#source-input', 'BV1MU411S7iJ,BV1xx411c7mD')
  4. page.click('#source-resolve-btn')
  5. 等待显示 "找到 2 个 BV 号"

Test: "Filter pipeline updates stats"
  1. 从收藏夹或手动输入获取视频列表
  2. 进入 filter step
  3. 切换 filter-duration 开关 → 输入 min=10, max=60
  4. 断言 #filter-stats 更新（筛选后数量 ≤ 原始数量）

Test: "Preview renders video list"
  1. 完成 filter
  2. page.click('#filter-next-btn')
  3. 断言 #preview-list 有 .preview-item 元素
  4. 断言 #preview-summary 显示待抓取数量

Test: "Execution processes videos"
  1. 从手动 BV 完成 preview
  2. page.click('#preview-start-btn')
  3. 等待 #progress-bar width 变为 "100%"
  4. 断言 #complete-report 显示成功/跳过/失败数
  5. 断言 Mock Obsidian 收到对应数量的 PUT 请求

Test: "Pause and resume"
  1. 开始执行（至少 3 个视频）
  2. page.click('#execute-pause-btn') → 按钮变为 "继续"
  3. 等待 2 秒 → 断言 progress 不再变化
  4. page.click('#execute-pause-btn') → 恢复
  5. 等待完成

Test: "Compilation gap warning"
  1. 完成执行（写入 > 0 个文件）
  2. 断言 #compilation-gap 显示且含 "新增 N 个文件"
  3. 如果 total > 50 → class 为 "critical"

Test: "Failure handling — non-existent BV"
  1. 手动输入一个不存在的 BV 号
  2. 执行 → 断言显示 "失败" 而非页面崩溃
```

### 4.3 API 拦截优化（可选）

为避免真实 B站 API 调用频率限制，可以拦截部分请求：

```typescript
// helpers/networks.ts
// 只在本地测试时启用
await page.route('**/api.bilibili.com/x/web-interface/view**', (route) => {
  route.fulfill({ body: JSON.stringify(mockVideoMeta) });
});
```

默认使用真实 B站 API（验证在线行为），仅在 `--mock-api` flag 下启用拦截。

## 5. 运行方式

```bash
# 安装依赖
cd tests && npm install

# 全量测试（需要网络 + B站可访问）
npx playwright test

# 只跑核心路径
npx playwright test --grep "Core modules"

# UI 模式（调试用）
npx playwright test --ui

# 生成 HTML 报告
npx playwright test --reporter=html
```

## 6. 不与现有 extension/ 耦合

- `tests/` 是独立 npm 项目，不影响 extension/ 的任何文件
- extension/ 不需要任何修改即可被测试加载
- 唯一耦合点：测试脚本知道 BOC.* 命名空间结构

## 7. CI 适应性

- GitHub Actions: `ubuntu-latest` + `apt install chromium`
- 需要 B站可访问（中国大陆网络或代理）
- Mock Obsidian 零外部依赖，纯 Node.js 内置模块

## 8. 已知局限

- 无法测试真实的 Service Worker 后台轮询（MV3 限制，SW 在测试中被动唤醒）
- 字幕签名 URL 过期问题（B站 subtitle_url 有 auth_key 时效，测试中 fetchSubtitleBody 可能因签名过期失败）
- 真实 B站 API 频率限制可能影响连续测试运行
- 无法测试多分P视频的 page switching（URL 无 ?p= 参数的场景依赖 DOM 状态）
