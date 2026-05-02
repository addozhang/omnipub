/**
 * Session health checker — uses Playwright's browserContext.cookies() API
 * instead of chrome.cookies.getAll(), which returns empty arrays under
 * Playwright automation due to MV3 cookie store isolation.
 *
 * Exports:
 *   - PLATFORM_SESSIONS — config for all 12 platforms
 *   - checkSessionHealth() — check specific or all platforms
 *   - checkAllSessions()  — convenience alias (no slug filter)
 *   - isProfileHealthy()  — pre-flight profile directory check
 *   - cleanStaleLocks()   — remove lock files after crash
 *   - fixProfileCrashState() — patch Preferences exit_type
 *   - printSessionReport() — formatted console output
 *   - buildReport()       — structured report object
 *
 * CLI:
 *   npx tsx e2e/session-health.ts                    # formatted table
 *   npx tsx e2e/session-health.ts --json              # JSON output
 *   npx tsx e2e/session-health.ts --slugs=juejin,csdn # filter platforms
 *   npx tsx e2e/session-health.ts --json -o report.json
 */
import { chromium, type BrowserContext } from "@playwright/test";
import os from "os";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Platform Configuration ─────────────────────────────────────────────────

export interface PlatformSession {
  slug: string;
  name: string;
  checkUrl: string;
  cookieName: string;
}

export const PLATFORM_SESSIONS: PlatformSession[] = [
  { slug: "juejin", name: "掘金", checkUrl: "https://juejin.cn", cookieName: "sessionid" },
  { slug: "csdn", name: "CSDN", checkUrl: "https://mp.csdn.net", cookieName: "UserToken" },
  { slug: "zhihu", name: "知乎", checkUrl: "https://zhuanlan.zhihu.com", cookieName: "z_c0" },
  { slug: "cnblogs", name: "博客园", checkUrl: "https://i.cnblogs.com", cookieName: ".CNBlogsCookie" },
  { slug: "toutiao", name: "今日头条", checkUrl: "https://mp.toutiao.com", cookieName: "sid_tt" },
  { slug: "tencent-cloud", name: "腾讯云", checkUrl: "https://cloud.tencent.com", cookieName: "qcloud_uid" },
  { slug: "51cto", name: "51CTO", checkUrl: "https://blog.51cto.com", cookieName: "pub_sauth1" },
  { slug: "segmentfault", name: "思否", checkUrl: "https://segmentfault.com", cookieName: "PHPSESSID" },
  { slug: "oschina", name: "开源中国", checkUrl: "https://my.oschina.net", cookieName: "oscid" },
  { slug: "infoq", name: "InfoQ", checkUrl: "https://xie.infoq.cn", cookieName: "GCID" },
  { slug: "bilibili", name: "哔哩哔哩", checkUrl: "https://member.bilibili.com", cookieName: "SESSDATA" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionStatus {
  slug: string;
  name: string;
  loggedIn: boolean;
  cookieFound: boolean;
  expired: boolean;
  cookieName: string;
  cookieExpires?: string;   // ISO string for easy serialization
  expiresAt?: Date;         // Date object for programmatic use
}

/** Alias for SessionStatus — used by real-world-fixtures */
export type SessionCheckResult = SessionStatus;

export interface ProfileHealth {
  exists: boolean;
  hasCookies: boolean;
  crashState: boolean;
}

export interface SessionReport {
  profileDir: string;
  checkedAt: string;
  summary: {
    total: number;
    active: number;
    expired: number;
    missing: number;
  };
  platforms: SessionStatus[];
}

// ─── Extension Host Permission Grant ─────────────────────────────────────────

/**
 * Chrome MV3 does not auto-grant host_permissions for extensions loaded via
 * --load-extension. This uses chrome.developerPrivate (available on
 * chrome://extensions pages) to set hostAccess = "ON_ALL_SITES", which is
 * equivalent to clicking "Allow on all sites" in the extension settings.
 *
 * Without this, chrome.cookies.getAll() returns empty arrays because the
 * extension lacks host permissions for the target domains.
 */
export async function grantExtensionHostPermissions(
  context: BrowserContext,
): Promise<void> {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent("serviceworker", { timeout: 5000 });
    } catch {
      sw = context.serviceWorkers()[0];
    }
  }

  if (!sw) {
    console.warn(
      "⚠️ No service worker found — cannot grant host permissions",
    );
    return;
  }

  const extensionId = sw.url().split("/")[2];

  const extPage = await context.newPage();
  try {
    // chrome:// URLs may abort the navigation lifecycle, so catch and
    // verify we actually landed on the page via url() check.
    try {
      await extPage.goto(`chrome://extensions/?id=${extensionId}`, {
        waitUntil: "commit",
        timeout: 10000,
      });
    } catch {
      // Some Chromium builds abort chrome:// navigations; if the URL
      // is correct we can still evaluate JS on the page.
    }

    // Wait briefly for the extensions page to initialise its APIs
    await extPage.waitForTimeout(1000);

    const currentUrl = extPage.url();
    if (!currentUrl.startsWith("chrome://extensions")) {
      console.warn(
        `⚠️ Failed to navigate to chrome://extensions (landed on ${currentUrl})`,
      );
      return;
    }

    const result = await extPage.evaluate(async (extId: string) => {
      const dp = (globalThis as any).chrome?.developerPrivate;
      if (!dp?.updateExtensionConfiguration) {
        return { ok: false, error: "developerPrivate API not available" };
      }
      try {
        await dp.updateExtensionConfiguration({
          extensionId: extId,
          hostAccess: "ON_ALL_SITES",
        });
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e.message ?? String(e) };
      }
    }, extensionId);

    if (result.ok) {
      console.log("✅ Extension host permissions granted (ON_ALL_SITES)");
    } else {
      console.warn(
        `⚠️ Failed to grant host permissions: ${result.error}`,
      );
    }
  } catch (err) {
    console.warn(
      `⚠️ Could not open chrome://extensions: ${(err as Error).message}`,
    );
  } finally {
    await extPage.close();
  }
}

// ─── Session Checking ────────────────────────────────────────────────────────

export async function checkSessionHealth(
  context: BrowserContext,
  slugs?: string[],
): Promise<SessionStatus[]> {
  const platforms = slugs
    ? PLATFORM_SESSIONS.filter((p) => slugs.includes(p.slug))
    : PLATFORM_SESSIONS;

  const results: SessionStatus[] = [];
  const now = Date.now() / 1000;

  for (const platform of platforms) {
    const cookies = await context.cookies(platform.checkUrl);
    const sessionCookie = cookies.find((c) => c.name === platform.cookieName);

    const expired = sessionCookie
      ? sessionCookie.expires > 0 && sessionCookie.expires < now
      : false;

    const expiresAt =
      sessionCookie?.expires && sessionCookie.expires > 0
        ? new Date(sessionCookie.expires * 1000)
        : undefined;

    results.push({
      slug: platform.slug,
      name: platform.name,
      loggedIn: !!sessionCookie && !expired,
      cookieFound: !!sessionCookie,
      expired,
      cookieName: platform.cookieName,
      cookieExpires: expiresAt?.toISOString(),
      expiresAt,
    });
  }

  return results;
}

/** Convenience alias — check all platforms (no slug filter) */
export async function checkAllSessions(
  context: BrowserContext,
): Promise<SessionStatus[]> {
  return checkSessionHealth(context);
}

// ─── Profile Health ──────────────────────────────────────────────────────────

export function isProfileHealthy(profileDir: string): ProfileHealth {
  const exists = fs.existsSync(profileDir);
  if (!exists) {
    return { exists: false, hasCookies: false, crashState: false };
  }

  const cookiePath = path.join(profileDir, "Default", "Cookies");
  const hasCookies = fs.existsSync(cookiePath);

  let crashState = false;
  const prefsPath = path.join(profileDir, "Default", "Preferences");
  if (fs.existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
      crashState =
        prefs.profile?.exit_type === "Crashed" ||
        prefs.profile?.exited_cleanly === false;
    } catch {
      /* corrupted prefs file */
    }
  }

  return { exists, hasCookies, crashState };
}

/**
 * Remove stale lock files left behind after Chromium crashes.
 * Returns the list of files that were actually removed.
 */
export function cleanStaleLocks(profileDir: string): string[] {
  const cleaned: string[] = [];
  if (!profileDir || !fs.existsSync(profileDir)) return cleaned;

  for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const lockPath = path.join(profileDir, lock);
    try {
      fs.unlinkSync(lockPath);
      cleaned.push(lock);
    } catch {
      /* file didn't exist or already removed */
    }
  }
  return cleaned;
}

export function fixProfileCrashState(profileDir: string): void {
  if (!profileDir) return;
  const prefsPath = path.join(profileDir, "Default", "Preferences");
  if (!fs.existsSync(prefsPath)) return;
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    if (
      prefs.profile?.exit_type === "Crashed" ||
      prefs.profile?.exited_cleanly === false
    ) {
      prefs.profile.exit_type = "Normal";
      prefs.profile.exited_cleanly = true;
      fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }
  } catch {
    /* no-op */
  }
}

// ─── Cookie Persistence (storageState save/restore) ─────────────────────────
//
// Playwright's context.close() triggers a CDP Browser.close() that wipes the
// Chromium cookie database.  Work around this by saving cookies to a sidecar
// JSON file *before* close, and restoring them via addCookies() *after* the
// next launch.

const COOKIE_STATE_FILENAME = "omnipub-cookie-state.json";

function cookieStatePath(profileDir: string): string {
  return path.join(profileDir, COOKIE_STATE_FILENAME);
}

/**
 * Save all browser cookies to a JSON sidecar file so they survive
 * Playwright's cookie-wiping close().  Call this *before* context.close().
 */
export async function saveCookies(
  context: BrowserContext,
  profileDir: string,
): Promise<number> {
  const state = await context.storageState();
  const filePath = cookieStatePath(profileDir);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state.cookies.length;
}

/**
 * Restore cookies from the sidecar file into a freshly-launched context.
 * Call this *after* launchPersistentContext and grantExtensionHostPermissions.
 * Returns the number of cookies restored (0 if no state file found).
 */
export async function restoreCookies(
  context: BrowserContext,
  profileDir: string,
): Promise<number> {
  const filePath = cookieStatePath(profileDir);
  if (!fs.existsSync(filePath)) return 0;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const cookies = state.cookies ?? [];
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
    return cookies.length;
  } catch {
    return 0;
  }
}

/**
 * Start a periodic auto-save timer that writes cookies every `intervalMs`.
 * Returns a cleanup function that saves one final time and stops the timer.
 *
 * Use this in long-lived sessions (e.g. launch-chromium.ts) where the user
 * may close the browser window directly — the periodic saves ensure we
 * capture cookies even if we can't run a final save on the close event.
 */
export function startCookieAutoSave(
  context: BrowserContext,
  profileDir: string,
  intervalMs = 15_000,
): { stop: () => Promise<void> } {
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    try {
      await saveCookies(context, profileDir);
    } catch {
      /* context may already be closing */
    }
  }, intervalMs);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      try {
        await saveCookies(context, profileDir);
      } catch {
        /* best-effort final save */
      }
    },
  };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

export function buildReport(
  statuses: SessionStatus[],
  profileDir: string,
): SessionReport {
  const active = statuses.filter((s) => s.loggedIn);
  const expiredList = statuses.filter((s) => s.expired);
  const missing = statuses.filter((s) => !s.loggedIn && !s.expired);

  return {
    profileDir,
    checkedAt: new Date().toISOString(),
    summary: {
      total: statuses.length,
      active: active.length,
      expired: expiredList.length,
      missing: missing.length,
    },
    platforms: statuses,
  };
}

export function printSessionReport(statuses: SessionStatus[]): void {
  const active = statuses.filter((s) => s.loggedIn);
  const expiredList = statuses.filter((s) => s.expired);
  const missing = statuses.filter((s) => !s.loggedIn && !s.expired);

  console.log("\n┌──────────── Platform Session Health ────────────┐");

  for (const s of statuses) {
    const icon = s.loggedIn ? "✅" : s.expired ? "⏰" : "❌";
    const status = s.loggedIn ? "OK" : s.expired ? "EXPIRED" : "MISSING";
    const expiry = s.expiresAt
      ? ` (expires: ${s.expiresAt.toISOString().slice(0, 16)})`
      : "";
    console.log(
      `│  ${icon} [${status.padEnd(7)}] ${s.name.padEnd(8)} (${s.slug})${expiry}`,
    );
  }

  console.log("├─────────────────────────────────────────────────┤");
  console.log(
    `│  ${active.length} active, ${expiredList.length} expired, ${missing.length} no session`,
  );
  console.log(
    `│  Total: ${active.length}/${statuses.length} platforms ready`,
  );
  console.log("└─────────────────────────────────────────────────┘\n");
}

export function getTargetSlugs(): string[] | undefined {
  const env = process.env.OMNIPUB_TEST_PLATFORMS;
  if (!env) return undefined;
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

const PROFILE_DIR =
  process.env.OMNIPUB_TEST_PROFILE ||
  path.join(os.homedir(), ".omnipub-test-profile");
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].includes("session-health") ||
    process.argv[1].endsWith("session-health.ts"));

if (isDirectRun) {
  (async () => {
    const args = process.argv.slice(2);
    const jsonMode = args.includes("--json");
    const outputIdx = args.indexOf("-o");
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    if (!jsonMode) {
      console.log("🔍 Checking platform session health...");
      console.log(`   Profile: ${PROFILE_DIR}`);
    }

    if (!fs.existsSync(PROFILE_DIR)) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: "Profile directory not found" }));
      } else {
        console.error(
          "\n❌ Profile directory not found. Run 'npm run seed-profile' first.\n",
        );
      }
      process.exit(1);
    }

    cleanStaleLocks(PROFILE_DIR);
    fixProfileCrashState(PROFILE_DIR);

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        "--no-first-run",
        "--use-mock-keychain",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    });

    await grantExtensionHostPermissions(context);
    const restored = await restoreCookies(context, PROFILE_DIR);
    if (!jsonMode && restored > 0) {
      console.log(`🍪 Restored ${restored} cookies from saved state`);
    }

    const slugArg = args.find((a) => a.startsWith("--slugs="));
    const slugs = slugArg?.split("=")[1]?.split(",");

    const statuses = await checkSessionHealth(context, slugs);
    await saveCookies(context, PROFILE_DIR);
    await context.close();

    if (jsonMode) {
      const report = buildReport(statuses, PROFILE_DIR);
      const json = JSON.stringify(report, null, 2);
      if (outputPath) {
        fs.writeFileSync(outputPath, json);
        console.error(`Report written to: ${outputPath}`);
      } else {
        console.log(json);
      }
    } else {
      printSessionReport(statuses);

      const reportPath = path.join(PROFILE_DIR, "session-status.json");
      fs.writeFileSync(reportPath, JSON.stringify(statuses, null, 2));
      console.log(`Report written to: ${reportPath}`);
    }

    const allActive = statuses.every((s) => s.loggedIn);
    process.exit(allActive ? 0 : 1);
  })();
}
