import { test, expect, chromium, BrowserContext, Page } from "@playwright/test";
import path from "path";
import { MockObsidianServer } from "../fixtures/mock-obsidian";
import {
  getExtensionId,
  checkCoreNamespacesOnExtensionPage,
  configureMockObsidian,
} from "../helpers/extension";

const EXT_PATH = path.resolve(__dirname, "..", "..", "extension");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ||
  "/home/weijey/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome";

let mockObsidian: MockObsidianServer;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  mockObsidian = new MockObsidianServer(27124);
  await mockObsidian.start();

  context = await chromium.launchPersistentContext(
    "/tmp/bilivault-test-batch-" + Date.now(),
    {
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        "--headless=new",
        "--disable-extensions-except=" + EXT_PATH,
        "--load-extension=" + EXT_PATH,
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
      viewport: { width: 1280, height: 800 },
    }
  );
  extensionId = await getExtensionId(context);
});

test.afterAll(async () => {
  await context.close();
  await mockObsidian.stop();
});

test.beforeEach(() => {
  mockObsidian.clearRecordings();
});

async function openBatchPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/pages/batch/batch.html`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForTimeout(1500); // let env check complete
  return page;
}

test.describe("Batch page loading", () => {
  test("core modules load in batch page", async () => {
    const page = await openBatchPage();
    const version = await page.evaluate(
      () => (window as any).BOC?.BOC_VERSION
    );
    expect(version).toBeTruthy();
    await page.close();
  });

  test("all 6 core namespaces available", async () => {
    const page = await openBatchPage();
    const missing = await checkCoreNamespacesOnExtensionPage(page);
    expect(missing).toEqual([]);
    await page.close();
  });

  test("five step sections present", async () => {
    const page = await openBatchPage();
    for (const step of [
      "#step-source",
      "#step-filter",
      "#step-preview",
      "#step-execute",
      "#step-complete",
    ]) {
      await expect(page.locator(step)).toBeAttached();
    }
    await expect(page.locator("#step-source")).toHaveClass(/active/);
    await page.close();
  });

  test("environment banner visible after load", async () => {
    const page = await openBatchPage();
    await expect(page.locator("#env-banner")).toBeAttached();
    await page.close();
  });
});

test.describe("Source selection", () => {
  test("clicking preset card selects it", async () => {
    const page = await openBatchPage();
    await page.click('.preset-card[data-preset="manual"]');
    await expect(
      page.locator('.preset-card[data-preset="manual"]')
    ).toHaveClass(/selected/);
    await page.close();
  });

  test("preset reveals source detail panel", async () => {
    const page = await openBatchPage();
    await page.click('.preset-card[data-preset="manual"]');
    await expect(page.locator("#source-detail")).not.toHaveAttribute(
      "hidden", ""
    );
    await expect(page.locator("#source-detail")).toContainText("BV号列表");
    await page.close();
  });

  test("manual BV parsing enables next step", async () => {
    const page = await openBatchPage();
    await page.click('.preset-card[data-preset="manual"]');
    await page.fill("#source-input", "BV15bGv6WEPu");
    await page.click("#source-resolve-btn");
    await expect(page.locator("#source-status")).toContainText("手动输入", {
      timeout: 10000,
    });
    await expect(page.locator("#source-next-btn")).toBeEnabled();
    await page.close();
  });
});

test.describe("Filter pipeline", () => {
  async function setupFilter(page: Page) {
    await page.click('.preset-card[data-preset="manual"]');
    await page.fill("#source-input", "BV15bGv6WEPu");
    await page.click("#source-resolve-btn");
    await expect(page.locator("#source-next-btn")).toBeEnabled({
      timeout: 10000,
    });
    await page.click("#source-next-btn");
  }

  test("filter step becomes active", async () => {
    const page = await openBatchPage();
    await setupFilter(page);
    await expect(page.locator("#step-filter")).toHaveClass(/active/);
    await page.close();
  });

  test("duration filter shows statistics", async () => {
    const page = await openBatchPage();
    await setupFilter(page);
    await page.click("#filter-duration");
    await page.fill("#duration-min", "1");
    await page.fill("#duration-max", "120");
    await expect(page.locator("#filter-summary")).not.toHaveAttribute(
      "hidden", "", { timeout: 5000 }
    );
    await page.close();
  });

  test("back returns to source step", async () => {
    const page = await openBatchPage();
    await setupFilter(page);
    await page.click("#filter-back-btn");
    await expect(page.locator("#step-source")).toHaveClass(/active/);
    await page.close();
  });

  test("filter next shows preview", async () => {
    const page = await openBatchPage();
    await setupFilter(page);
    await page.click("#filter-next-btn");
    await expect(page.locator("#step-preview")).toHaveClass(/active/);
    await page.close();
  });
});

test.describe("Preview and execution", () => {
  async function setupPreview(page: Page) {
    await configureMockObsidian(context, extensionId, mockObsidian.obsidianUrl);
    await page.click('.preset-card[data-preset="manual"]');
    await page.fill("#source-input", "BV15bGv6WEPu");
    await page.click("#source-resolve-btn");
    await expect(page.locator("#source-next-btn")).toBeEnabled({
      timeout: 10000,
    });
    await page.click("#source-next-btn");
    await page.click("#filter-next-btn");
  }

  test("preview list shows video", async () => {
    const page = await openBatchPage();
    await setupPreview(page);
    await expect(page.locator(".preview-item").first()).toBeAttached({
      timeout: 5000,
    });
    await page.close();
  });

  test("full execution: preview → execute → complete", async () => {
    const page = await openBatchPage();
    await setupPreview(page);
    await page.click("#preview-start-btn");

    await expect(page.locator("#step-execute")).toHaveClass(/active/, {
      timeout: 5000,
    });
    await expect(page.locator("#progress-bar")).toHaveAttribute(
      "style", /width: 100%/, { timeout: 120000 }
    );
    await expect(page.locator("#step-complete")).toHaveClass(/active/);
    await expect(page.locator("#complete-report")).toContainText("成功");
    await page.close();
  });

  test("compilation gap warning appears", async () => {
    const page = await openBatchPage();
    await setupPreview(page);
    await page.click("#preview-start-btn");

    await expect(page.locator("#progress-bar")).toHaveAttribute(
      "style", /width: 100%/, { timeout: 120000 }
    );
    const gap = page.locator("#compilation-gap");
    await expect(gap).not.toHaveAttribute("hidden", "");
    await expect(gap).toContainText("新增");
    await page.close();
  });
});
