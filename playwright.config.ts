import { defineConfig } from "@playwright/test";
const state = `.wrangler/browser-tests-${Date.now()}`;
const firefox = process.env.FS_TEST_BROWSER === "firefox";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8791",
    browserName: firefox ? "firefox" : "chromium",
    launchOptions: firefox
      ? {}
      : {
          executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
          args: ["--no-sandbox"],
        },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/wrangler.mjs d1 migrations apply DB --local --env local --persist-to ${state} && node scripts/wrangler.mjs dev --env local --ip 127.0.0.1 --port 8791 --persist-to ${state}`,
    url: "http://127.0.0.1:8791/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
