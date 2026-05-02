/**
 * Launch a headed Chromium with the Omnipub extension loaded and a
 * persistent profile so the user can log into platforms manually.
 *
 * Usage:
 *   npx tsx e2e/launch-chromium.ts                  # open localhost + all platform login pages
 *   npx tsx e2e/launch-chromium.ts --no-platforms   # only open localhost
 *   npx tsx e2e/launch-chromium.ts --only juejin csdn  # only open specific platforms
 *
 * The browser stays open until you close it. Cookies/sessions are
 * persisted to ~/.omnipub-test-profile so follow-up test runs can read them.
 */
import { chromium } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  cleanStaleLocks,
  fixProfileCrashState,
  isProfileHealthy,
  checkAllSessions,
  buildReport,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
  startCookieAutoSave,
  PLATFORM_SESSIONS,
} from "./session-health";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_DIR =
  process.env.OMNIPUB_TEST_PROFILE ||
  path.join(os.homedir(), ".omnipub-test-profile");
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");

// ─── Platform Login URLs ─────────────────────────────────────────────────────
// These are the URLs where users can log in to each platform.
// Different from new_article_url — these are the login/home pages.

const PLATFORM_LOGIN_URLS: Record<string, string> = {
  juejin: "https://juejin.cn/login",
  csdn: "https://passport.csdn.net/login",
  zhihu: "https://www.zhihu.com/signin",
  cnblogs: "https://account.cnblogs.com/signin",
  toutiao: "https://sso.toutiao.com/login/",
  "tencent-cloud": "https://cloud.tencent.com/login",
  "51cto": "https://blog.51cto.com/",
  segmentfault: "https://segmentfault.com/user/login",
  oschina: "https://www.oschina.net/home/login",
  infoq: "https://xie.infoq.cn/",
  bilibili: "https://passport.bilibili.com/login",
};

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const noPlatforms = args.includes("--no-platforms");
  const onlyIndex = args.indexOf("--only");

  let platformFilter: string[] | null = null;
  if (onlyIndex !== -1) {
    platformFilter = [];
    for (let i = onlyIndex + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      platformFilter.push(args[i]);
    }
  }

  return { noPlatforms, platformFilter };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { noPlatforms, platformFilter } = parseArgs();

  console.log("🚀 Omnipub Profile Seeding Tool");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Profile:   ${PROFILE_DIR}`);
  console.log(`  Extension: ${EXTENSION_DIR}`);
  console.log("");

  // ── Pre-flight: Profile health check ──────────────────────────────────────
  const health = isProfileHealthy(PROFILE_DIR);

  if (!health.exists) {
    console.log("📁 Creating new profile directory...");
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  } else {
    console.log(`📁 Profile exists (cookies: ${health.hasCookies ? "yes" : "no"})`);
  }

  // Clean stale locks from crashed sessions
  const cleaned = cleanStaleLocks(PROFILE_DIR);
  if (cleaned.length > 0) {
    console.log(`🧹 Cleaned stale lock files: ${cleaned.join(", ")}`);
  }

  // Fix crash state
  if (health.crashState) {
    fixProfileCrashState(PROFILE_DIR);
    console.log("🔧 Fixed crash state in profile preferences");
  }

  console.log("");

  // ── Launch browser ────────────────────────────────────────────────────────
  console.log("🌐 Launching Chromium...");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--use-mock-keychain",
    ],
    viewport: null, // use default window size
    ignoreDefaultArgs: ["--disable-component-extensions-with-background-pages"],
  });

  // ── Grant extension host permissions ────────────────────────────────────────
  await grantExtensionHostPermissions(context);

  // ── Restore cookies from previous session ─────────────────────────────────
  const restored = await restoreCookies(context, PROFILE_DIR);
  if (restored > 0) {
    console.log(`🍪 Restored ${restored} cookies from saved state`);
  }

  // ── Start periodic cookie auto-save ───────────────────────────────────────
  // Because the user closes the browser manually, we can't reliably save on
  // the close event (context is already destroyed). Auto-save every 15s.
  const autoSave = startCookieAutoSave(context, PROFILE_DIR);

  // ── Check existing sessions ───────────────────────────────────────────────
  const results = await checkAllSessions(context);
  const report = buildReport(results, PROFILE_DIR);

  const alreadyLoggedIn = results.filter((r) => r.loggedIn);
  const needsLogin = results.filter((r) => !r.loggedIn);

  if (alreadyLoggedIn.length > 0) {
    console.log(`\n✅ Already logged in (${alreadyLoggedIn.length}):`);
    for (const r of alreadyLoggedIn) {
      const expiry = r.cookieExpires
        ? `expires ${r.cookieExpires.slice(0, 19)}`
        : "session cookie";
      console.log(`   ${r.name} (${r.slug}) — ${expiry}`);
    }
  }

  if (needsLogin.length > 0) {
    console.log(`\n❌ Not logged in (${needsLogin.length}):`);
    for (const r of needsLogin) {
      console.log(`   ${r.name} (${r.slug})`);
    }
  }

  // ── Open tabs ─────────────────────────────────────────────────────────────
  // Open localhost first
  const firstPage = context.pages()[0] || (await context.newPage());
  await firstPage.goto("http://localhost:3000");

  if (!noPlatforms) {
    // Determine which platforms to open
    let platformsToOpen: string[];

    if (platformFilter) {
      // --only flag: open only specified platforms
      platformsToOpen = platformFilter;
      console.log(`\n📂 Opening specified platforms: ${platformsToOpen.join(", ")}`);
    } else {
      // Default: open platforms that need login
      platformsToOpen = needsLogin.map((r) => r.slug);
      if (platformsToOpen.length === 0) {
        console.log("\n🎉 All platforms already logged in! No tabs to open.");
      } else {
        console.log(`\n📂 Opening ${platformsToOpen.length} platform login pages...`);
      }
    }

    // Open platform tabs with a small delay to avoid overwhelming the browser
    for (const slug of platformsToOpen) {
      const loginUrl = PLATFORM_LOGIN_URLS[slug];
      if (!loginUrl) {
        console.log(`   ⚠️ No login URL for: ${slug}`);
        continue;
      }
      const platformName =
        PLATFORM_SESSIONS.find((p) => p.slug === slug)?.name ?? slug;
      try {
        const tab = await context.newPage();
        await tab.goto(loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        console.log(`   ✅ ${platformName}: ${loginUrl}`);
      } catch (err) {
        console.log(
          `   ⚠️ ${platformName}: failed to load (${(err as Error).message?.slice(0, 50)})`,
        );
      }
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("👉 Log into platforms in the browser tabs above.");
  console.log("   Close the browser when done — sessions will be saved.");
  console.log("   Then run: npm run check-sessions");
  console.log("═══════════════════════════════════════════════════");

  // Keep running until the user closes the browser
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });

  await autoSave.stop();

  console.log("\n✅ Browser closed. Cookies & profile saved to:", PROFILE_DIR);
  console.log("   Run `npm run check-sessions` to verify login status.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
