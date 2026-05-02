/**
 * Real-World Chrome Profile Fixtures — launches system Chrome with a dedicated
 * persistent profile for real-world publishing tests.
 *
 * Uses system-installed Google Chrome (channel: "chrome") instead of bundled
 * Chromium, with a dedicated profile directory that doesn't interfere with
 * daily Chrome usage.
 *
 * Environment variables:
 *   - OMNIPUB_TEST_PROFILE — profile directory (default: ~/.omnipub-test-profile)
 *   - OMNIPUB_EXT_PATH    — extension source path (default: ../../extension)
 *   - ONLY_PLATFORMS      — comma-separated platform slugs to test (default: all)
 *
 * Usage:
 *   import { test, expect } from "./real-world-chrome-fixtures";
 *
 *   test("publish to juejin", async ({ page, context, requirePlatform }) => {
 *     await requirePlatform("juejin");
 *     // ... test code ...
 *   });
 */
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  cleanStaleLocks,
  fixProfileCrashState,
  checkAllSessions,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
  PLATFORM_SESSIONS,
  type SessionStatus,
} from "./session-health";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_PROFILE = path.join(os.homedir(), ".omnipub-test-profile");
const DEFAULT_EXT_PATH = path.resolve(__dirname, "../../extension");

function getProfileDir(): string {
  return process.env.OMNIPUB_TEST_PROFILE || DEFAULT_PROFILE;
}

function getExtensionPath(): string {
  return process.env.OMNIPUB_EXT_PATH || DEFAULT_EXT_PATH;
}

// ─── Session Cache ───────────────────────────────────────────────────────────

let cachedResults: SessionStatus[] | null = null;
let cachedContextId: string | null = null;

async function getSessionResults(
  context: BrowserContext,
): Promise<SessionStatus[]> {
  const contextId = (context as any)._guid ?? String(context);
  if (cachedResults && cachedContextId === contextId) {
    return cachedResults;
  }

  cachedResults = await checkAllSessions(context);
  cachedContextId = contextId;
  return cachedResults;
}

// ─── ONLY_PLATFORMS filter ───────────────────────────────────────────────────

function getOnlyPlatforms(): string[] | null {
  const env = process.env.ONLY_PLATFORMS;
  if (!env) return null;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;

  /**
   * Skip the current test if any of the specified platforms don't have
   * an active session. Also skips if the platform is not in ONLY_PLATFORMS
   * (when that env var is set).
   */
  requirePlatform: (...slugs: string[]) => Promise<void>;

  /** Get the full session health results for all platforms. */
  getSessionHealth: () => Promise<SessionStatus[]>;

  /** Get slugs of all platforms with active sessions. */
  activePlatforms: string[];
}>({
  context: async ({}, use) => {
    const profileDir = getProfileDir();
    const extensionDir = getExtensionPath();

    // Clean up profile state before launch
    cleanStaleLocks(profileDir);
    fixProfileCrashState(profileDir);

    // Clear extension service worker cache to ensure latest code is loaded
    // SW cache lives under Default/ subdirectory in persistent profiles
    const swBase = path.join(profileDir, "Default", "Service Worker");
    for (const subdir of ["ScriptCache", "CacheStorage", "Database"]) {
      const dir = path.join(swBase, subdir);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    // Also clear Extension Scripts cache (compiled extension JS)
    const extScripts = path.join(profileDir, "Default", "Extension Scripts");
    if (fs.existsSync(extScripts)) {
      fs.rmSync(extScripts, { recursive: true, force: true });
    }

    const context = await chromium.launchPersistentContext(profileDir, {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--use-mock-keychain",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
      ],
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: [
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
      ],
    });

    await grantExtensionHostPermissions(context);
    await restoreCookies(context, profileDir);
    await use(context);
    await saveCookies(context, profileDir).catch(() => {});
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    // Workaround for Playwright #39075: SW may be created before Playwright
    // attaches, so waitForEvent("serviceworker") hangs. Use CDP to force restart.
    let serviceWorker = context.serviceWorkers()[0];

    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent("serviceworker", {
          timeout: 3000,
        });
      } catch {
        serviceWorker = context.serviceWorkers()[0];
      }
    }

    if (!serviceWorker) {
      const page = context.pages()[0] || (await context.newPage());
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send("ServiceWorker.enable");
        await cdp.send("ServiceWorker.stopAllWorkers");
        const trigger = await context.newPage();
        await trigger.goto("about:blank");
        await trigger.close();
      } finally {
        await cdp.detach().catch(() => {});
      }

      serviceWorker = context.serviceWorkers()[0];
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker", {
          timeout: 5000,
        });
      }
    }

    const extensionId = serviceWorker.url().split("/")[2];
    await use(extensionId);
  },

  requirePlatform: async ({ context }, use, testInfo) => {
    const fn = async (...slugs: string[]) => {
      if (slugs.length === 0) {
        throw new Error("requirePlatform() needs at least one platform slug");
      }

      // Check ONLY_PLATFORMS filter
      const onlyPlatforms = getOnlyPlatforms();
      if (onlyPlatforms) {
        for (const slug of slugs) {
          if (!onlyPlatforms.includes(slug)) {
            testInfo.skip(
              true,
              `Platform "${slug}" not in ONLY_PLATFORMS (${onlyPlatforms.join(", ")})`,
            );
            return;
          }
        }
      }

      const results = await getSessionResults(context);

      for (const slug of slugs) {
        const config = PLATFORM_SESSIONS.find((p) => p.slug === slug);
        if (!config) {
          throw new Error(
            `Unknown platform slug: "${slug}". ` +
              `Valid slugs: ${PLATFORM_SESSIONS.map((p) => p.slug).join(", ")}`,
          );
        }

        const result = results.find((r) => r.slug === slug);
        if (!result?.loggedIn) {
          const reason = result?.expired
            ? `session expired (${result.cookieName} expired at ${result.cookieExpires})`
            : `not logged in (cookie "${config.cookieName}" not found)`;

          testInfo.skip(
            true,
            `Platform "${config.name}" (${slug}): ${reason}. Run: npm run setup:test-profile`,
          );
          return;
        }
      }
    };

    await use(fn);
  },

  getSessionHealth: async ({ context }, use) => {
    const fn = async () => getSessionResults(context);
    await use(fn);
  },

  activePlatforms: async ({ context }, use) => {
    const results = await getSessionResults(context);
    const active = results.filter((r) => r.loggedIn).map((r) => r.slug);
    await use(active);
  },
});

export const expect = test.expect;

// Re-export types for convenience
export type { SessionStatus } from "./session-health";
