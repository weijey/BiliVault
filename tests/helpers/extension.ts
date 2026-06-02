import { Page, BrowserContext } from "@playwright/test";

export async function getExtensionId(
  context: BrowserContext
): Promise<string> {
  // Service workers may not spawn until an extension page or matching
  // content script page is opened. Trigger SW by opening a bilibili page.
  const triggerPage = await context.newPage();
  try {
    await triggerPage.goto(
      "https://www.bilibili.com/video/BV15bGv6WEPu/",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    // Wait for SW to spawn
    await triggerPage.waitForTimeout(3000);
  } catch {
    // Even if page load fails, SW might have spawned
  } finally {
    await triggerPage.close();
  }

  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    const url = workers[0].url();
    const match = url.match(/chrome-extension:\/\/([^/]+)/);
    if (match) return match[1];
  }

  throw new Error(
    "Could not determine extension ID. Ensure the extension is loaded."
  );
}

/**
 * Wait for content script to inject #boc-root into the page.
 * MV3 isolated worlds prevent checking window.BOC from main world;
 * we verify via DOM presence instead.
 * Also makes the panel visible since it's hidden by default.
 */
export async function waitForExtension(
  page: Page,
  timeoutMs = 15000
): Promise<void> {
  await page.waitForSelector("#boc-root", {
    state: "attached",
    timeout: timeoutMs,
  });
  // Make panel visible (default is hidden, relies on popup message to open)
  await page.evaluate(() => {
    const panel = document.getElementById("boc-panel");
    if (panel) {
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
    }
  });
}

/**
 * Configure mock Obsidian by navigating to the extension options page,
 * filling the form, and saving. This injects settings that the content
 * script reads via chrome.storage.
 */
export async function configureMockObsidian(
  context: BrowserContext,
  extensionId: string,
  mockObsidianUrl: string,
  mockApiKey = "test-api-key-12345"
): Promise<void> {
  const optsPage = await context.newPage();
  await optsPage.goto(
    `chrome-extension://${extensionId}/options/options.html`,
    { waitUntil: "domcontentloaded" }
  );

  // Fill Obsidian connection settings
  await optsPage.fill("#obsidianApiBaseUrl", mockObsidianUrl);
  await optsPage.fill("#obsidianApiKey", mockApiKey);

  // Click save
  await optsPage.click("#saveBtn");

  // Wait for save confirmation
  await optsPage.waitForFunction(
    () => {
      const status = document.getElementById("status");
      return status && status.textContent?.includes("保存成功");
    },
    {},
    { timeout: 10000 }
  );

  await optsPage.close();
}

/**
 * On extension pages (batch.html etc.), BOC is accessible because
 * <script> tags run in the main world. Check all core namespaces.
 */
export async function checkCoreNamespacesOnExtensionPage(
  page: Page
): Promise<string[]> {
  const missing: string[] = [];
  const namespaces = [
    "utils",
    "api",
    "subtitle",
    "markdown",
    "obsidian",
    "cache",
  ];
  for (const ns of namespaces) {
    const exists = await page.evaluate((name) => {
      return (
        typeof (window as any).BOC !== "undefined" &&
        typeof (window as any).BOC[name] !== "undefined"
      );
    }, ns);
    if (!exists) missing.push(ns);
  }
  return missing;
}
