import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4187",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/preview.mjs --port 4187",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
  },
});
