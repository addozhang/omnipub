import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  fixProfileCrashState,
  cleanStaleLocks,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
} from "./session-health";

/**
 * Extension test fixtures — launches Chromium with the Omnipub extension loaded.
 *
 * MUST use `channel: 'chromium'` (not 'chrome') because Google Chrome
 * removed the --load-extension CLI flag needed for side-loading.
 *
 * Supports two modes:
 *   - Ephemeral profile (test) — fresh cookies per run, for isolation
 *   - Persistent profile (persistentTest) — reuses login sessions, for real-world tests
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const PERSISTENT_PROFILE =
  process.env.OMNIPUB_TEST_PROFILE ||
  path.join(os.homedir(), ".omnipub-test-profile");

/**
 * Create a fixture factory. `profileDir` = "" for ephemeral, or a path for persistent.
 */
function createExtensionTest(profileDir: string) {
  return base.extend<{
    context: BrowserContext;
    extensionId: string;
  }>({
    context: async ({}, use) => {
      if (profileDir) {
        // Clean up profile state before launch to prevent crash dialogs
        cleanStaleLocks(profileDir);
        fixProfileCrashState(profileDir);
      }

      const context = await chromium.launchPersistentContext(profileDir, {
        channel: "chromium",
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_DIR}`,
          `--load-extension=${EXTENSION_DIR}`,
          "--no-first-run",
          "--disable-session-crashed-bubble",
          "--hide-crash-restore-bubble",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--use-mock-keychain",
        ],
      });
      await grantExtensionHostPermissions(context);
      await restoreCookies(context, profileDir);
      await use(context);
      await saveCookies(context, profileDir).catch(() => {});
      await context.close();
    },

    extensionId: async ({ context }, use) => {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker");
      }
      const extensionId = serviceWorker.url().split("/")[2];
      await use(extensionId);
    },
  });
}

/** Ephemeral profile — fresh every run (default for unit-style extension tests) */
export const test = createExtensionTest("");

/** Persistent profile — reuses saved login sessions (for real-world E2E) */
export const persistentTest = createExtensionTest(PERSISTENT_PROFILE);

export const expect = test.expect;
