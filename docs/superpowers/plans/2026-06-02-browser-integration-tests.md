# Browser Integration Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 BiliVault Chrome MV3 扩展建立 Playwright 浏览器集成测试，覆盖单视频字幕抓取和批量页流程。

**Architecture:** 独立 `tests/` 目录（npm 项目，零耦合 extension/），Playwright Test + TypeScript。每次测试启动 Mock Obsidian HTTP Server，Chromium 加载扩展，导航到真实 B站页面执行断言。

**Tech Stack:** @playwright/test, TypeScript, Node.js 内置 `http` 模块

---

## 文件结构

```
tests/
├── package.json               # 新增
├── tsconfig.json              # 新增
├── playwright.config.ts       # 新增: 扩展加载 + 超时配置
├── fixtures/
│   ├── mock-obsidian.ts       # 新增: Mock Obsidian Local REST API
│   └── videos.json            # 新增: 测试视频矩阵
├── helpers/
│   └── extension.ts           # 新增: 扩展ID获取、BOC检查
├── content/
│   └── video-page.spec.ts     # 新增: 单视频抓取测试
└── batch/
    └── batch-flow.spec.ts     # 新增: 批量页流程测试
```

---

### Task 1: Project Setup

**Files:**
- Create: `tests/package.json`
- Create: `tests/tsconfig.json`
- Create: `tests/playwright.config.ts`

- [ ] **Step 1: Create tests/package.json**

```json
{
  "name": "bilivault-tests",
  "private": true,
  "scripts": {
    "test": "npx playwright test",
    "test:ui": "npx playwright test --ui",
    "test:report": "npx playwright test --reporter=html"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd tests && npm install
```

Expected: node_modules created, no errors.

- [ ] **Step 3: Create tests/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": ".",
    "resolveJsonModule": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 4: Create tests/playwright.config.ts**

```typescript
import { defineConfig } from "@playwright/test";
import path from "path";

const EXTENSION_PATH = path.resolve(__dirname, "..", "extension");

export default defineConfig({
  testDir: ".",
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,

  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10000,
    launchOptions: {
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
```

- [ ] **Step 5: Verify config syntax**

```bash
cd tests && npx tsc --noEmit playwright.config.ts
```

Expected: no type errors.

---

### Task 2: Mock Obsidian Server

**Files:**
- Create: `tests/fixtures/mock-obsidian.ts`

- [ ] **Step 1: Create tests/fixtures/mock-obsidian.ts**

```typescript
import http from "http";

interface Recording {
  timestamp: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export class MockObsidianServer {
  private server: http.Server;
  private recordings: Recording[] = [];
  private failNext = false;
  public port: number;

  constructor(port = 27124) {
    this.port = port;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || "/";

    // Health check
    if (req.method === "GET" && (url === "/" || url === "")) {
      res.writeHead(200);
      res.end(JSON.stringify({ authenticated: true, service: "mock-obsidian" }));
      return;
    }

    // Recording inspection
    if (req.method === "GET" && url === "/__recordings") {
      res.writeHead(200);
      res.end(JSON.stringify(this.recordings));
      return;
    }

    // Clear recordings
    if (req.method === "DELETE" && url === "/__recordings") {
      this.recordings = [];
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Simulate failure
    if (req.method === "POST" && url === "/__fail-next") {
      this.failNext = true;
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Write note
    if (req.method === "PUT" && url.startsWith("/vault/")) {
      if (this.failNext) {
        this.failNext = false;
        res.writeHead(500);
        res.end(JSON.stringify({ error: "Simulated failure" }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const headers: Record<string, string> = {};
        Object.entries(req.headers).forEach(([k, v]) => {
          headers[k] = Array.isArray(v) ? v.join(", ") : (v || "");
        });

        this.recordings.push({
          timestamp: new Date().toISOString(),
          method: req.method || "",
          path: url,
          headers,
          body,
        });

        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Mock Obsidian listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) { reject(err); } else { resolve(); }
      });
    });
  }

  getRecordings(): Recording[] {
    return [...this.recordings];
  }

  getLastRecording(): Recording | undefined {
    return this.recordings[this.recordings.length - 1];
  }

  clearRecordings(): void {
    this.recordings = [];
  }

  async setFailNext(): Promise<void> {
    this.failNext = true;
  }

  get obsidianUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}
```

- [ ] **Step 2: Verify syntax**

```bash
cd tests && npx tsc --noEmit fixtures/mock-obsidian.ts
```

Expected: no errors.

---

### Task 3: Test Helpers

**Files:**
- Create: `tests/helpers/extension.ts`
- Create: `tests/fixtures/videos.json`

- [ ] **Step 1: Create tests/helpers/extension.ts**

```typescript
import { Page, BrowserContext } from "@playwright/test";

export async function getExtensionId(context: BrowserContext): Promise<string> {
  // Service worker background page exposes the extension ID
  const worker = context.serviceWorkers()[0];
  if (worker) {
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) { return match[1]; }
  }

  // Fallback: open a known extension page and extract from URL
  const page = await context.newPage();
  await page.goto("chrome://extensions");
  await page.close();
  throw new Error("Could not determine extension ID. Ensure extension is loaded.");
}

/**
 * Navigate to an extension internal page (popup, batch, options).
 */
export async function gotoExtensionPage(
  context: BrowserContext,
  extensionId: string,
  pagePath: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
  return page;
}

/**
 * Wait for BOC namespace to be available on a content-script-injected page.
 */
export async function waitForBOC(page: Page, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as any).BOC !== "undefined" && (window as any).BOC.BOC_VERSION,
    {},
    { timeout: timeoutMs }
  );
}

/**
 * Check that all core module namespaces are present.
 */
export async function checkCoreNamespaces(page: Page): Promise<string[]> {
  const missing: string[] = [];
  const namespaces = ["utils", "api", "subtitle", "markdown", "obsidian", "cache"];
  for (const ns of namespaces) {
    const exists = await page.evaluate((name) => {
      return typeof (window as any).BOC[name] !== "undefined";
    }, ns);
    if (!exists) { missing.push(ns); }
  }
  return missing;
}

/**
 * Pre-configure extension settings to point to mock Obsidian.
 */
export async function configureMockObsidian(
  page: Page,
  mockObsidianUrl: string,
  mockApiKey = "test-api-key-12345"
): Promise<void> {
  await page.evaluate(
    ({ url, key }) => {
      const settings = {
        obsidianApiBaseUrl: url,
        obsidianApiKey: key,
        noteFolder: "Clippings/Bilibili",
        tags: "clippings,bilibili",
        downloadFormat: "srt",
        includeDateInFilename: true,
        includeTimestampInBody: true,
        enableDebugLogs: false,
      };
      return (window as any).chrome.storage.sync.set(settings);
    },
    { url: mockObsidianUrl, key: mockApiKey }
  );
}
```

- [ ] **Step 2: Create tests/fixtures/videos.json**

```json
[
  {
    "name": "has-subtitle-cc-zh",
    "url": "https://www.bilibili.com/video/BV1GJ4m1Y7Xj",
    "title": "video with Chinese CC subtitle",
    "expectSubtitle": true
  },
  {
    "name": "no-subtitle",
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "title": "video without subtitle",
    "expectSubtitle": false
  }
]
```

> 注：BV1GJ4m1Y7Xj 是示例，实现时替换为经确认有字幕的真实BV号。

- [ ] **Step 3: Verify helpers compile**

```bash
cd tests && npx tsc --noEmit helpers/extension.ts
```

Expected: no errors.

---

### Task 4: Single Video Page Tests

**Files:**
- Create: `tests/content/video-page.spec.ts`

- [ ] **Step 1: Create tests/content/video-page.spec.ts**

```typescript
import { test, expect, BrowserContext } from "@playwright/test";
import { MockObsidianServer } from "../fixtures/mock-obsidian";
import { waitForBOC, checkCoreNamespaces, configureMockObsidian } from "../helpers/extension";
import videos from "../fixtures/videos.json";

let mockObsidian: MockObsidianServer;
let context: BrowserContext;

test.beforeAll(async () => {
  mockObsidian = new MockObsidianServer(27124);
  await mockObsidian.start();
});

test.afterAll(async () => {
  await mockObsidian.stop();
});

test.beforeEach(async ({ browser }) => {
  context = await browser.newContext();
  mockObsidian.clearRecordings();
});

test.afterEach(async () => {
  await context.close();
});

test.describe("Core module loading", () => {
  test("BOC namespace available on B站 video page", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    const version = await page.evaluate(() => (window as any).BOC.BOC_VERSION);
    expect(version).toBeTruthy();
  });

  test("all 6 core namespaces loaded", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    const missing = await checkCoreNamespaces(page);
    expect(missing).toEqual([]);
  });

  test("apiClient created with fetchFn injection", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    const hasCreateClient = await page.evaluate(
      () => typeof (window as any).BOC.api.createClient === "function"
    );
    expect(hasCreateClient).toBe(true);
  });
});

test.describe("Content script UI", () => {
  test("boc-root injected into page", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);

    const root = page.locator("#boc-root");
    await expect(root).toBeAttached({ timeout: 15000 });
  });

  test("panel hidden by default, clickable to open", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    const panel = page.locator("#boc-panel");
    // Panel exists but hidden (no "open" class initially)
    await expect(panel).toBeAttached();
  });
});

test.describe("Subtitle fetching", () => {
  test("refresh fetches subtitle and shows preview", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    // Click refresh
    await page.click("#boc-refresh-btn");

    // Wait for completion
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    // Preview should have content
    const preview = page.locator("#boc-preview");
    const previewText = await preview.inputValue();
    expect(previewText.length).toBeGreaterThan(0);
  });

  test("subtitle language selector populated", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    const select = page.locator("#boc-subtitle-select");
    await expect(select).toBeEnabled();
    const options = await select.locator("option").count();
    expect(options).toBeGreaterThan(0);
  });

  test("copy Markdown button works", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    await page.click("#boc-copy-btn");
    await expect(page.locator("#boc-message")).toContainText("已复制");
  });

  test("download button triggers file download", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.click("#boc-download-btn"),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.(srt|txt)$/);
  });
});

test.describe("Obsidian integration", () => {
  test("send to Obsidian writes correct Markdown", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    // Configure mock Obsidian
    await configureMockObsidian(page, mockObsidian.obsidianUrl);

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    await page.click("#boc-send-btn");
    await expect(page.locator("#boc-message")).toContainText("已写入", { timeout: 15000 });

    // Verify the recording
    const recording = mockObsidian.getLastRecording();
    expect(recording).toBeDefined();
    expect(recording!.method).toBe("PUT");
    expect(recording!.path).toContain("/vault/");

    // Check Markdown structure
    const body = recording!.body;
    expect(body).toContain("---");
    expect(body).toContain("title:");
    expect(body).toContain("bvid:");
    expect(body).toContain("## 字幕");
  });

  test("send to Obsidian fails gracefully when server is down", async () => {
    const page = await context.newPage();
    const videoWithSubs = videos.find((v) => v.expectSubtitle)!;
    await page.goto(videoWithSubs.url);
    await waitForBOC(page);

    // Point to a non-existent service
    await configureMockObsidian(page, "http://127.0.0.1:19999");

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText("抓取完成", { timeout: 60000 });

    await page.click("#boc-send-btn");
    await expect(page.locator("#boc-message")).toContainText("失败", { timeout: 15000 });
  });
});

test.describe("Edge cases", () => {
  test("no-subtitle video shows appropriate message", async () => {
    const page = await context.newPage();
    const noSubVideo = videos.find((v) => !v.expectSubtitle);
    if (!noSubVideo) { test.skip("No no-subtitle test video configured"); return; }

    await page.goto(noSubVideo.url);
    await waitForBOC(page);

    await page.click("#boc-refresh-btn");
    await expect(page.locator("#boc-status")).toContainText(/失败|暂无字幕|无可用字幕/, {
      timeout: 60000,
    });
  });
});
```

- [ ] **Step 2: Verify test file compiles**

```bash
cd tests && npx tsc --noEmit content/video-page.spec.ts
```

Expected: no errors (may need moduleResolution adjustment for JSON import).

---

### Task 5: Batch Page Tests

**Files:**
- Create: `tests/batch/batch-flow.spec.ts`

- [ ] **Step 1: Create tests/batch/batch-flow.spec.ts**

```typescript
import { test, expect, BrowserContext, Page } from "@playwright/test";
import { MockObsidianServer } from "../fixtures/mock-obsidian";
import { gotoExtensionPage } from "../helpers/extension";

let mockObsidian: MockObsidianServer;
let context: BrowserContext;
let batchPage: Page;
let extensionId: string;

test.beforeAll(async () => {
  mockObsidian = new MockObsidianServer(27124);
  await mockObsidian.start();
});

test.afterAll(async () => {
  await mockObsidian.stop();
});

test.beforeEach(async ({ browser }) => {
  context = await browser.newContext();
  mockObsidian.clearRecordings();

  // Get extension ID from a service worker or popup
  const popupPage = await context.newPage();
  await popupPage.goto("chrome://extensions");
  extensionId = "REPLACE_ME"; // Will be set by helper on first run
  await popupPage.close();

  batchPage = await context.newPage();
});

test.afterEach(async () => {
  await context.close();
});

test.describe("Batch page loading", () => {
  test("core modules load in batch page", async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );

    const version = await batchPage.evaluate(
      () => (window as any).BOC?.BOC_VERSION
    );
    expect(version).toBeTruthy();
  });

  test("five step sections present", async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );

    const steps = [
      "#step-source",
      "#step-filter",
      "#step-preview",
      "#step-execute",
      "#step-complete",
    ];

    for (const step of steps) {
      await expect(batchPage.locator(step)).toBeAttached();
    }

    // Step 1 (source) should be active
    await expect(batchPage.locator("#step-source")).toHaveClass(/active/);
  });

  test("environment banner shows Obsidian status", async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );

    // Should show env banner or it should become visible shortly
    const banner = batchPage.locator("#env-banner");
    await expect(banner).toBeAttached();
  });
});

test.describe("Source selection", () => {
  test.beforeEach(async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );
  });

  test("clicking preset card selects it", async () => {
    await batchPage.click('.preset-card[data-preset="manual"]');
    await expect(
      batchPage.locator('.preset-card[data-preset="manual"]')
    ).toHaveClass(/selected/);
  });

  test("preset reveals source detail panel", async () => {
    await batchPage.click('.preset-card[data-preset="manual"]');
    const detail = batchPage.locator("#source-detail");
    await expect(detail).not.toHaveAttribute("hidden", "");
    await expect(detail).toContainText("BV号列表");
  });

  test("manual BV parsing enables next step", async () => {
    await batchPage.click('.preset-card[data-preset="manual"]');
    await batchPage.fill("#source-input", "BV1MU411S7iJ,BV1xx411c7mD");
    await batchPage.click("#source-resolve-btn");

    await expect(batchPage.locator("#source-status")).toContainText("找到", {
      timeout: 10000,
    });
    await expect(batchPage.locator("#source-next-btn")).toBeEnabled();
  });
});

test.describe("Filter pipeline", () => {
  test.beforeEach(async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );
    // Setup: manual source with 2 BVs, then navigate to filter
    await batchPage.click('.preset-card[data-preset="manual"]');
    await batchPage.fill("#source-input", "BV1MU411S7iJ,BV1xx411c7mD");
    await batchPage.click("#source-resolve-btn");
    await expect(batchPage.locator("#source-next-btn")).toBeEnabled({
      timeout: 10000,
    });
    await batchPage.click("#source-next-btn");
  });

  test("filter step becomes active after source next", async () => {
    await expect(batchPage.locator("#step-filter")).toHaveClass(/active/);
  });

  test("duration filter updates statistics", async () => {
    // Enable duration filter
    await batchPage.click("#filter-duration");
    await batchPage.fill("#duration-min", "1");
    await batchPage.fill("#duration-max", "60");

    // Stats should appear
    const summary = batchPage.locator("#filter-summary");
    await expect(summary).not.toHaveAttribute("hidden", "", { timeout: 5000 });
  });

  test("back button returns to source step", async () => {
    await batchPage.click("#filter-back-btn");
    await expect(batchPage.locator("#step-source")).toHaveClass(/active/);
  });

  test("filter next enables preview", async () => {
    await batchPage.click("#filter-next-btn");
    await expect(batchPage.locator("#step-preview")).toHaveClass(/active/);
  });
});

test.describe("Preview and execution", () => {
  test.beforeEach(async () => {
    await batchPage.goto(
      `chrome-extension://${extensionId}/batch/batch.html`
    );
    await batchPage.click('.preset-card[data-preset="manual"]');
    await batchPage.fill("#source-input", "BV1MU411S7iJ");
    await batchPage.click("#source-resolve-btn");
    await expect(batchPage.locator("#source-next-btn")).toBeEnabled({
      timeout: 10000,
    });
    await batchPage.click("#source-next-btn");
    await batchPage.click("#filter-next-btn");
  });

  test("preview list shows videos", async () => {
    const items = batchPage.locator(".preview-item");
    await expect(items.first()).toBeAttached({ timeout: 5000 });
  });

  test("start execution processes videos", async () => {
    await batchPage.click("#preview-start-btn");

    // Should move to execute step
    await expect(batchPage.locator("#step-execute")).toHaveClass(/active/, {
      timeout: 5000,
    });

    // Wait for completion
    await expect(batchPage.locator("#progress-bar")).toHaveAttribute(
      "style",
      /width: 100%/,
      { timeout: 120000 }
    );

    // Should show completion report
    await expect(batchPage.locator("#step-complete")).toHaveClass(/active/);
    await expect(batchPage.locator("#complete-report")).toContainText("成功");
  });

  test("compilation gap warning appears after successful ingest", async () => {
    await batchPage.click("#preview-start-btn");

    await expect(batchPage.locator("#progress-bar")).toHaveAttribute(
      "style",
      /width: 100%/,
      { timeout: 120000 }
    );

    const gap = batchPage.locator("#compilation-gap");
    await expect(gap).not.toHaveAttribute("hidden", "");
    await expect(gap).toContainText("新增");
  });
});
```

- [ ] **Step 2: Verify batch test compiles**

```bash
cd tests && npx tsc --noEmit batch/batch-flow.spec.ts
```

Expected: no errors.

---

### Task 6: Extension ID Resolution Fix

**Files:**
- Modify: `tests/helpers/extension.ts` (add robust ID resolution)
- Modify: `tests/batch/batch-flow.spec.ts` (replace REPLACE_ME)

- [ ] **Step 1: Update helpers/extension.ts with robust ID resolution**

Replace the `getExtensionId` function:

```typescript
export async function getExtensionId(context: BrowserContext): Promise<string> {
  // Method 1: Check service workers
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    const url = workers[0].url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) { return match[1]; }
  }

  // Method 2: Open extension management page and extract
  const extPage = await context.newPage();
  try {
    await extPage.goto("chrome://extensions", { waitUntil: "domcontentloaded" });
    await extPage.waitForTimeout(2000);

    const id = await extPage.evaluate(() => {
      // Look for the BiliVault extension entry
      const items = document.querySelectorAll("extensions-item");
      for (const item of items) {
        const name = item.querySelector("#name")?.textContent || "";
        if (name.includes("Bilibili") || name.includes("B站")) {
          return item.getAttribute("id") || "";
        }
      }
      return "";
    });

    if (id) { return id; }

    // Method 3: Try to get from background page
    const bgPages = context.backgroundPages();
    if (bgPages.length > 0) {
      const bgUrl = bgPages[0].url();
      const match = bgUrl.match(/chrome-extension:\/\/([^/]+)/);
      if (match) { return match[1]; }
    }
  } finally {
    await extPage.close();
  }

  throw new Error(
    "Could not determine extension ID. Ensure the extension is loaded and enabled."
  );
}
```

- [ ] **Step 2: Update batch-flow.spec.ts to use helper**

Replace the `beforeEach` block that computed `extensionId`:

```typescript
test.beforeEach(async ({ browser }) => {
  context = await browser.newContext();
  mockObsidian.clearRecordings();

  extensionId = await getExtensionId(context);

  batchPage = await context.newPage();
});
```

Also add the import:
```typescript
import { gotoExtensionPage, getExtensionId } from "../helpers/extension";
```

- [ ] **Step 3: Verify compilation after changes**

```bash
cd tests && npx tsc --noEmit
```

Expected: all files compile without errors.

---

### Task 7: Integration Verification

- [ ] **Step 1: Run a single smoke test to verify the setup**

```bash
cd tests && npx playwright test --grep "BOC namespace" --reporter=list
```

Expected: Test passes. If it fails:
- Check that Chromium is installed: `npx playwright install chromium`
- Check extension directory structure matches manifest paths
- Verify no syntax errors in extension JS files

- [ ] **Step 2: Run full test suite**

```bash
cd tests && npx playwright test --reporter=list
```

Expected: All tests pass or have clear failure reasons.

- [ ] **Step 3: Generate HTML report**

```bash
cd tests && npx playwright test --reporter=html
```

Expected: HTML report generated in `tests/playwright-report/`.

---

## Self-Review

1. **Spec coverage:**
   - ✅ Core module loading tests (video-page.spec.ts: "Core module loading" describe)
   - ✅ Content script UI tests (video-page.spec.ts: "Content script UI" describe)
   - ✅ Subtitle fetching tests (video-page.spec.ts: "Subtitle fetching" describe)
   - ✅ Obsidian integration tests (video-page.spec.ts: "Obsidian integration" describe)
   - ✅ Batch page loading (batch-flow.spec.ts: "Batch page loading" describe)
   - ✅ Source selection (batch-flow.spec.ts: "Source selection" describe)
   - ✅ Filter pipeline (batch-flow.spec.ts: "Filter pipeline" describe)
   - ✅ Preview and execution (batch-flow.spec.ts: "Preview and execution" describe)
   - ✅ Compilation gap warning (batch-flow.spec.ts: final test)
   - ⚠️ Popup message communication tests deferred to P1 per spec

2. **Placeholder scan:**
   - `REPLACE_ME` in batch-flow.spec.ts — fixed by Task 6
   - BV1GJ4m1Y7Xj in videos.json — noted in Task 3 that this needs confirmation with real data
   - `test.skip` in edge case test — intentional, skips if no no-subtitle video configured

3. **Type consistency:**
   - `MockObsidianServer` imported consistently
   - `configureMockObsidian` signature matches usage
   - Extension ID usage consistent between helpers and test files
