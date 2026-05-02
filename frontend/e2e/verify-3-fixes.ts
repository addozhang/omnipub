/**
 * Verify publisher fixes via the actual frontend UI flow.
 *
 * Connects to an already-running Chrome for Testing instance via CDP
 * (Architecture B), so the browser can be shared with DevTools MCP.
 *
 * Prerequisites:
 *   - Chrome for Testing running with --remote-debugging-port=9222
 *   - Extension loaded via --load-extension
 *   - Persistent profile via --user-data-dir
 *   - Platforms logged in within that browser
 *
 * This script:
 *   1. Connects to Chrome via CDP (connectOverCDP)
 *   2. Logs into Omnipub via the login form
 *   3. Navigates to the publish page for a specific article
 *   4. Enables/selects target platforms
 *   5. Clicks the "一键发布" button in the UI
 *   6. Polls the progress DOM for success/failure
 *   7. Verifies article_url via the backend API
 *
 * Usage:
 *   ARTICLE_ID=90 npx tsx e2e/verify-3-fixes.ts
 *   ARTICLE_ID=90 PLATFORM=51cto npx tsx e2e/verify-3-fixes.ts
 *
 * Fallback (launch own Chrome, when CDP_URL is not reachable):
 *   LAUNCH=1 ARTICLE_ID=90 npx tsx e2e/verify-3-fixes.ts
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  cleanStaleLocks,
  fixProfileCrashState,
  isProfileHealthy,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
} from "./session-health";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_DIR =
  process.env.OMNIPUB_TEST_PROFILE ||
  path.join(os.homedir(), ".omnipub-test-profile");
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const ARTICLE_ID = parseInt(process.env.ARTICLE_ID || "0", 10);
const PLATFORM_FILTER = (process.env.PLATFORM || "").trim().toLowerCase();
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const FORCE_LAUNCH = process.env.LAUNCH === "1";
const LOGIN_EMAIL = "duwasai@gmail.com";
const LOGIN_PASSWORD = "Naitang1!";
const BASE_URL = "http://localhost:3000";

const PUBLISH_TIMEOUT_MS = 150_000; // 2.5 minutes
const OUTPUT_DIR = "/tmp/omnipub-verify-fixes";

const ALL_PLATFORMS = ["csdn", "51cto", "bilibili"];

interface PlatformResult {
  slug: string;
  status: "success" | "failed" | "timeout" | "skipped";
  message: string;
  articleUrl: string | null;
  durationMs: number;
  screenshotPath?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ─── Profile Health ─────────────────────────────────────────────────────────

function prepareProfile(): void {
  const health = isProfileHealthy(PROFILE_DIR);
  if (!health.exists) {
    console.error(`❌ Profile directory does not exist: ${PROFILE_DIR}`);
    console.error(
      "   Run: npx tsx e2e/launch-chromium.ts   to create and login",
    );
    process.exit(1);
  }

  const cleaned = cleanStaleLocks(PROFILE_DIR);
  if (cleaned.length > 0) {
    console.log(`🧹 Cleaned stale lock files: ${cleaned.join(", ")}`);
  }

  if (health.crashState) {
    fixProfileCrashState(PROFILE_DIR);
    console.log("🔧 Fixed crash state in profile");
  }
}

// ─── Login ──────────────────────────────────────────────────────────────────

async function loginOmnipub(page: Page): Promise<string> {
  await page.goto(`${BASE_URL}/login`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  const existingToken = await page.evaluate(() =>
    localStorage.getItem("token"),
  );
  if (existingToken) {
    const resp = await page.request.get(`${BASE_URL}/api/articles`, {
      headers: { Authorization: `Bearer ${existingToken}` },
    });
    if (resp.ok()) {
      console.log("✅ Already logged in (token valid)");
      return existingToken;
    }
    await page.evaluate(() => localStorage.removeItem("token"));
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
  }

  await page.getByPlaceholder("your@email.com").fill(LOGIN_EMAIL);
  await page.getByPlaceholder("至少 6 位密码").fill(LOGIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page
    .waitForURL("**/articles", { timeout: 10000 })
    .catch(() => {});

  const token = await page.evaluate(() => localStorage.getItem("token"));
  if (!token) throw new Error("Failed to login to Omnipub");
  console.log("✅ Logged in successfully");
  return token;
}

// ─── Ensure platforms are enabled ───────────────────────────────────────────

async function ensurePlatformsEnabled(
  page: Page,
  token: string,
  slugs: string[],
): Promise<void> {
  const platformsResp = await page.request.get(`${BASE_URL}/api/platforms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const allPlatforms = platformsResp.ok() ? (await platformsResp.json())?.data || [] : [];
  const allSlugs = allPlatforms.map((p: any) => p.slug).filter(Boolean);

  for (const slug of allSlugs) {
    const shouldEnable = slugs.includes(slug);
    const resp = await page.request.get(
      `${BASE_URL}/api/user/platform-configs/${slug}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const payload = resp.ok() ? await resp.json() : null;
    const isEnabled = payload?.data?.enabled ?? false;

    if (shouldEnable && !isEnabled) {
      console.log(`  ⚙️  Enabling platform: ${slug}`);
      await page.request.put(
        `${BASE_URL}/api/user/platform-configs/${slug}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: { enabled: true, publish_config: {} },
        },
      );
    } else if (!shouldEnable && isEnabled) {
      console.log(`  ⚙️  Disabling platform: ${slug}`);
      await page.request.put(
        `${BASE_URL}/api/user/platform-configs/${slug}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: { enabled: false, publish_config: {} },
        },
      );
    }
  }
}

// ─── Wait for publish progress via DOM ──────────────────────────────────────

interface ProgressEntry {
  platformName: string;
  status: string; // "等待中" | "填充内容中..." | "发布中..." | "发布成功 ✓" | "发布失败 ✗"
}

async function pollProgress(page: Page): Promise<ProgressEntry[]> {
  return page.evaluate(() => {
    const entries: { platformName: string; status: string }[] = [];
    const rows = document.querySelectorAll(".space-y-2 > div");
    for (const row of rows) {
      const nameEl = row.querySelector(
        ".text-sm.font-medium.text-gray-700, .text-sm.font-medium.dark\\:text-gray-300",
      );
      const statusEl = row.querySelector(
        ".ml-auto.text-sm.text-gray-400",
      );
      if (nameEl && statusEl) {
        entries.push({
          platformName: nameEl.textContent?.trim() || "",
          status: statusEl.textContent?.trim() || "",
        });
      }
    }
    return entries;
  });
}

function isTerminal(statusText: string): boolean {
  return statusText.includes("成功") || statusText.includes("失败");
}

function statusFromText(text: string): "success" | "failed" | "pending" {
  if (text.includes("成功")) return "success";
  if (text.includes("失败")) return "failed";
  return "pending";
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  Omnipub Publisher Fix Verification (UI Flow)     ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log();

  if (!ARTICLE_ID) {
    console.error(
      "❌ ARTICLE_ID is required. Usage: ARTICLE_ID=90 npx tsx e2e/verify-3-fixes.ts",
    );
    process.exit(1);
  }

  const platformsToTest = PLATFORM_FILTER
    ? ALL_PLATFORMS.filter((s) => s === PLATFORM_FILTER)
    : ALL_PLATFORMS;

  if (platformsToTest.length === 0) {
    console.error(
      `❌ Unknown platform: ${PLATFORM_FILTER}. Valid: ${ALL_PLATFORMS.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`📋 Article ID: ${ARTICLE_ID}`);
  console.log(`🎯 Platforms: ${platformsToTest.join(", ")}`);
  console.log(`📁 Profile: ${PROFILE_DIR}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── Connect to running Chrome or launch new one ──
  let browser: Browser | null = null;
  let context!: BrowserContext;
  let launchedOwnBrowser = false;

  if (!FORCE_LAUNCH) {
    try {
      const probe = await fetch(`${CDP_URL}/json/version`).catch(() => null);
      if (probe?.ok) {
        console.log(`🔗 Connecting to Chrome via CDP: ${CDP_URL}`);
        browser = await chromium.connectOverCDP(CDP_URL);
        const contexts = browser.contexts();
        context = contexts[0];
        if (!context) {
          throw new Error("No browser context found on running Chrome");
        }
        console.log(`✅ Connected — ${context.pages().length} existing page(s)`);
      } else {
        throw new Error("CDP not reachable");
      }
    } catch (err: any) {
      console.log(`⚠️  CDP not available (${err.message}), falling back to launch mode...`);
      FORCE_LAUNCH || process.env.__FORCE_LAUNCH_FALLBACK === undefined;
      // Fall through to launch below
      browser = null;
    }
  }

  if (!browser) {
    console.log("🌐 Launching Chromium with extension...");
    prepareProfile();
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
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
      viewport: { width: 1400, height: 900 },
      ignoreDefaultArgs: ["--disable-component-extensions-with-background-pages"],
      timeout: 30000,
    });
    launchedOwnBrowser = true;
    await grantExtensionHostPermissions(context);
    const restored = await restoreCookies(context, PROFILE_DIR);
    if (restored > 0) {
      console.log(`🍪 Restored ${restored} cookies from saved state`);
    }
  }

  const results: PlatformResult[] = [];
  const startTime = Date.now();

  try {
    // ── Attach console listeners to all pages ──
    const attachConsoleListener = (p: Page, label: string) => {
      p.on("console", (msg) => {
        const type = msg.type();
        if (type === "error" || type === "warning" || msg.text().includes("[page-bridge]") || msg.text().includes("[ServiceWorker]") || msg.text().includes("omnipub") || msg.text().includes("[51cto]") || msg.text().includes("[csdn]") || msg.text().includes("[bilibili]") || msg.text().includes("[base-publisher]")) {
          console.log(`  [${label}] ${type}: ${msg.text()}`);
        }
      });
    };
    context.on("page", (newPage) => {
      const url = newPage.url();
      const label = url.includes("51cto") ? "51cto-tab" : url.includes("csdn") ? "csdn-tab" : url.includes("bilibili") ? "bili-tab" : `new-${url.slice(0, 40)}`;
      attachConsoleListener(newPage, label);
      console.log(`  📄 New tab opened: ${url.slice(0, 80)}`);
    });

    // ── Login ──
    const page = context.pages()[0] || (await context.newPage());
    attachConsoleListener(page, "main-page");
    const token = await loginOmnipub(page);

    // Sync token to extension by dispatching the CustomEvent on the Omnipub page
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });

    // Verify page-bridge.js is active by checking for omnipub:ready event
    const bridgeReady = await page.evaluate(`
      new Promise((resolve) => {
        const handler = () => { resolve(true); window.removeEventListener("omnipub:ready", handler); };
        window.addEventListener("omnipub:ready", handler);
        window.dispatchEvent(new CustomEvent("omnipub:ping"));
        setTimeout(() => resolve(false), 3000);
      })
    `);
    if (bridgeReady) {
      console.log("✅ page-bridge.js is active (omnipub:ready received)");
    } else {
      console.error("❌ page-bridge.js NOT responding — extension content script not injected!");
      console.error("   This is why publishing will fail. Extension may not be loaded properly.");
    }

    await page.evaluate((t: string) => {
      window.dispatchEvent(
        new CustomEvent("omnipub:set-token", { detail: { token: t } }),
      );
    }, token);
    await delay(1000);
    console.log("🔑 Token synced to extension");

    // ── Ensure platforms enabled ──
    await ensurePlatformsEnabled(page, token, platformsToTest);

    // ── Navigate to publish page ──
    console.log(`\n📄 Navigating to publish page for article ${ARTICLE_ID}...`);
    await page.goto(`${BASE_URL}/articles/${ARTICLE_ID}/publish`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await delay(2000); // Wait for platform list to render

    // Take a "before" screenshot
    const beforeSS = path.join(OUTPUT_DIR, `before-publish-${timestamp()}.png`);
    await page.screenshot({ path: beforeSS, fullPage: true });
    console.log(`📸 Before screenshot: ${beforeSS}`);

    // ── Select "重新发布" for already-published platforms ──
    // The publish page shows platforms in a grid. Already-published platforms
    // show a "✓ 已发布" badge. Clicking on them toggles "🔄 重新发布".
    for (const slug of platformsToTest) {
      // Check if this platform is shown as "已发布"
      const card = page.locator(`.grid > div`).filter({ hasText: slug === "51cto" ? "51CTO" : slug === "csdn" ? "CSDN" : slug === "bilibili" ? "哔哩哔哩" : slug });
      const badgeText = await card.locator("span").allTextContents().catch(() => []);
      const isPublished = badgeText.some((t) => t.includes("已发布"));

      if (isPublished) {
        console.log(`  🔄 Clicking "${slug}" to toggle republish`);
        await card.click();
        await delay(300);
      }
    }

    // Verify the publish button is enabled and shows the correct count
    const publishBtn = page.locator(
      "button.bg-indigo-500:not([disabled])",
    );
    const btnText = await publishBtn.textContent({ timeout: 5000 }).catch(() => "");
    console.log(`\n🔘 Publish button text: "${btnText}"`);

    if (!btnText || btnText.includes("所有渠道已发布")) {
      console.error("❌ No platforms available for publishing. Button says:", btnText);
      // Take debug screenshot
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `no-platforms-${timestamp()}.png`),
        fullPage: true,
      });
      process.exit(1);
    }

    // ── CLICK PUBLISH ──
    console.log("\n🚀 Clicking publish button...");
    console.log("═══════════════════════════════════════════════════");
    const publishStart = Date.now();
    await publishBtn.click();

    // Give Vue a moment to process the click and dispatch events
    await delay(2000);

    // Check if any new tabs were opened by the extension (indicates SW is working)
    const tabsAfterClick = context.pages();
    console.log(`  📊 Open tabs after click: ${tabsAfterClick.length}`);
    for (const t of tabsAfterClick) {
      console.log(`    - ${t.url().slice(0, 100)}`);
    }

    // ── Poll progress DOM ──
    console.log("📡 Monitoring progress via DOM...\n");

    const seen = new Set<string>();
    const finalStatuses: Record<string, { status: string; message: string }> = {};

    const pollStart = Date.now();
    while (Date.now() - pollStart < PUBLISH_TIMEOUT_MS) {
      const entries = await pollProgress(page);

      for (const entry of entries) {
        const key = `${entry.platformName}:${entry.status}`;
        if (!seen.has(key)) {
          seen.add(key);
          const icon = entry.status.includes("成功")
            ? "✅"
            : entry.status.includes("失败")
              ? "❌"
              : "⏳";
          console.log(`  ${icon} ${entry.platformName}: ${entry.status}`);

          if (entry.status.includes("失败")) {
            const domainMap: Record<string, string[]> = {
              "51CTO": ["51cto.com"],
              CSDN: ["csdn.net"],
              "哔哩哔哩": ["bilibili.com"],
            };
            const domains = domainMap[entry.platformName] || [];
            for (const p of context.pages()) {
              if (domains.some((d) => p.url().includes(d))) {
                const ssPath = path.join(OUTPUT_DIR, `fail-${entry.platformName}-${timestamp()}.png`);
                await p.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
                console.log(`  📸 Failure screenshot: ${ssPath}`);
              }
            }
          }
        }
        // Track latest status per platform
        finalStatuses[entry.platformName] = {
          status: entry.status,
          message: entry.status,
        };
      }

      // Check if all target platforms are done
      const targetNames = platformsToTest.map((s) => {
        const nameMap: Record<string, string> = {
          csdn: "CSDN",
          "51cto": "51CTO",
          bilibili: "哔哩哔哩",
        };
        return nameMap[s] || s;
      });
      const allDone = targetNames.every((name) => {
        const entry = finalStatuses[name];
        return entry && isTerminal(entry.status);
      });

      if (allDone) {
        console.log("\n✅ All platforms finished!");
        break;
      }

      await delay(2000);
    }

    const publishDuration = Date.now() - publishStart;

    // Take "after" screenshot
    const afterSS = path.join(OUTPUT_DIR, `after-publish-${timestamp()}.png`);
    await page.screenshot({ path: afterSS, fullPage: true });
    console.log(`📸 After screenshot: ${afterSS}`);

    // ── Verify via API ──
    console.log("\n🔍 Verifying via API...");
    await delay(3000); // Give backend time to process

    const pubResp = await page.request.get(
      `${BASE_URL}/api/articles/${ARTICLE_ID}/publications`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const pubPayload = pubResp.ok() ? await pubResp.json() : null;
    const publications = pubPayload?.data || [];

    const nameToSlug: Record<string, string> = {
      CSDN: "csdn",
      "51CTO": "51cto",
      "哔哩哔哩": "bilibili",
    };

    for (const slug of platformsToTest) {
      const platformName =
        Object.entries(nameToSlug).find(([, s]) => s === slug)?.[0] || slug;

      // Find the latest publication for this platform
      const pubs = publications
        .filter(
          (p: any) => p.platform_slug === slug || p.platform?.slug === slug,
        )
        .sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
      const latest = pubs[0];

      const domStatus = finalStatuses[platformName];
      const uiStatus = domStatus
        ? statusFromText(domStatus.status)
        : "timeout";
      const apiStatus = latest
        ? (latest.status || "").toLowerCase()
        : "no-record";
      const articleUrl = latest?.article_url || null;

      // Take platform-specific screenshot
      let screenshotPath: string | undefined;
      try {
        const allPages = context.pages();
        const domains: Record<string, string[]> = {
          csdn: ["csdn.net"],
          "51cto": ["51cto.com"],
          bilibili: ["bilibili.com"],
        };
        for (const p of allPages) {
          const url = p.url();
          if ((domains[slug] || []).some((d) => url.includes(d))) {
            screenshotPath = path.join(
              OUTPUT_DIR,
              `${slug}-${timestamp()}.png`,
            );
            await p.screenshot({ path: screenshotPath }).catch(() => {});
            break;
          }
        }
      } catch {}

      const result: PlatformResult = {
        slug,
        status: uiStatus as any,
        message: `UI: ${domStatus?.status || "no progress"} | API: ${apiStatus}`,
        articleUrl,
        durationMs: publishDuration,
        screenshotPath,
      };
      results.push(result);

      const icon =
        uiStatus === "success" ? "✅" : uiStatus === "failed" ? "❌" : "⏱️";
      console.log(
        `  ${icon} ${slug.padEnd(12)} UI=${uiStatus.padEnd(8)} API=${apiStatus.padEnd(12)} article_url=${articleUrl || "none"}`,
      );
    }
  } catch (err: any) {
    console.error(`\n💀 Fatal error: ${err.message}`);
    console.error(err.stack);
    try {
      const p = context.pages()[0];
      if (p) {
        const ss = path.join(OUTPUT_DIR, `error-${timestamp()}.png`);
        await p.screenshot({ path: ss });
        console.log(`📸 Error screenshot: ${ss}`);
      }
    } catch {}
  } finally {
    // ── Summary ──
    console.log();
    console.log("╔════════════════════════════════════════════════════╗");
    console.log("║  SUMMARY                                         ║");
    console.log("╚════════════════════════════════════════════════════╝");

    const passed = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const timedOut = results.filter((r) => r.status === "timeout").length;

    for (const r of results) {
      const icon =
        r.status === "success" ? "✅" : r.status === "failed" ? "❌" : "⏱️";
      console.log(`  ${icon} ${r.slug}: ${r.status} — ${r.message}`);
      if (r.articleUrl) {
        console.log(`     🔗 ${r.articleUrl}`);
      }
      if (r.screenshotPath) {
        console.log(`     📸 ${r.screenshotPath}`);
      }
    }

    console.log();
    console.log(
      `  Total: ${results.length} | ✅ ${passed} | ❌ ${failed} | ⏱️ ${timedOut}`,
    );
    console.log(
      `  Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    );
    console.log();

    // Save JSON report
    const reportPath = path.join(OUTPUT_DIR, `report-${timestamp()}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          results,
          article_id: ARTICLE_ID,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`📄 Report saved: ${reportPath}`);

    await saveCookies(context, PROFILE_DIR).catch(() => {});
    if (launchedOwnBrowser) {
      await context.close().catch(() => {});
    } else if (browser) {
      await browser.close().catch(() => {});
    }

    if (timedOut > 0 || failed > 0) {
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
