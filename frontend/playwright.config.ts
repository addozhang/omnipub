import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  workers: 1,

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/real-world-*.spec.ts"],
    },
    {
      name: "real-world",
      testMatch: "**/real-world-*.spec.ts",
      timeout: 180_000,
      retries: 0,
      use: {
        channel: "chrome",
        headless: false,
        screenshot: "on",
        video: "retain-on-failure",
      },
    },
  ],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
});
