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
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        `--headless=new`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        `--no-sandbox`,
        `--disable-dev-shm-usage`,
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
