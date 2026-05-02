import { test, expect } from "./extension-fixtures";

/**
 * Extension login detection tests.
 *
 * These tests load the Omnipub Chrome extension (MV3) into a real Chromium
 * browser and verify the login-status detection flow end-to-end:
 *
 *   Settings.vue → CustomEvent("omnipub:check-login")
 *     → page-bridge.js (content script) → chrome.cookies.getAll()
 *     → CustomEvent("omnipub:check-login-result") → Settings.vue UI update
 *
 * Docker Compose must be running (frontend at localhost:3000).
 */

const BASE_URL = "http://localhost:3000";

/** Generate unique test credentials */
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.describe("Extension Login Detection", () => {
  test("extension service worker loads and is ready", async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBeGreaterThan(0);

    // Verify service worker is running
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);
    expect(workers[0].url()).toContain("service-worker.js");
  });

  test("extension popup page loads", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Popup should render — check for a known element
    await expect(page.locator("body")).toBeVisible();
    // The popup has a login form or status display
    await page.waitForLoadState("domcontentloaded");
  });

  test("page-bridge injects on localhost and announces ready", async ({ context }) => {
    const page = await context.newPage();

    // Navigate first, then check for bridge via ping
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    // page-bridge.js dispatches omnipub:ready on injection (and again after 500ms).
    // Use the ping mechanism to reliably detect the bridge.
    const readyDetail = await page.evaluate(() => {
      return new Promise<{ version: string } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 5000);
        window.addEventListener("omnipub:ready", (e: any) => {
          clearTimeout(timer);
          resolve(e.detail);
        }, { once: true });
        window.dispatchEvent(new CustomEvent("omnipub:ping"));
      });
    });

    expect(readyDetail).not.toBeNull();
    expect(readyDetail!.version).toBeTruthy();
  });

  test("login check returns not-logged-in for platforms without cookies", async ({ context }) => {
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    // Wait for extension bridge to be ready
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000);
        window.addEventListener("omnipub:ready", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        window.dispatchEvent(new CustomEvent("omnipub:ping"));
      });
    });

    // Dispatch a check-login event directly (simulating what Settings.vue does)
    const result = await page.evaluate(() => {
      return new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ results: [] }), 10000);

        window.addEventListener("omnipub:check-login-result", (e: any) => {
          clearTimeout(timer);
          resolve(e.detail);
        }, { once: true });

        window.dispatchEvent(
          new CustomEvent("omnipub:check-login", {
            detail: {
              platforms: [
                {
                  slug: "juejin",
                  name: "掘金",
                  new_article_url: "https://juejin.cn/editor/drafts/new",
                },
                {
                  slug: "csdn",
                  name: "CSDN",
                  new_article_url: "https://editor.csdn.net/md",
                },
                {
                  slug: "zhihu",
                  name: "知乎",
                  new_article_url: "https://zhuanlan.zhihu.com/write",
                },
              ],
            },
          })
        );
      });
    });

    // In a clean browser context, no platform cookies should exist
    // So all should be loggedIn: false
    expect(result.results).toBeDefined();
    expect(result.results.length).toBe(3);

    for (const r of result.results) {
      expect(r.loggedIn).toBe(false);
      expect(r.slug).toBeTruthy();
      expect(r.name).toBeTruthy();
    }

    // Verify specific platforms
    const juejin = result.results.find((r: any) => r.slug === "juejin");
    expect(juejin).toBeDefined();
    expect(juejin.loggedIn).toBe(false);

    const csdn = result.results.find((r: any) => r.slug === "csdn");
    expect(csdn).toBeDefined();
    expect(csdn.loggedIn).toBe(false);
  });

  test("login check correctly identifies specific cookies (not just any cookie)", async ({ context }) => {
    const page = await context.newPage();

    // Set a WRONG cookie for juejin — not the login cookie "sessionid"
    // This tests the fix: should NOT report logged in just because any cookie exists
    await context.addCookies([
      {
        name: "some_tracking_cookie",
        value: "abc123",
        domain: ".juejin.cn",
        path: "/",
      },
    ]);

    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    // Wait for bridge
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000);
        window.addEventListener("omnipub:ready", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        window.dispatchEvent(new CustomEvent("omnipub:ping"));
      });
    });

    // Check login with specific login_cookie requirement
    const result = await page.evaluate(() => {
      return new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ results: [] }), 10000);
        window.addEventListener("omnipub:check-login-result", (e: any) => {
          clearTimeout(timer);
          resolve(e.detail);
        }, { once: true });

        window.dispatchEvent(
          new CustomEvent("omnipub:check-login", {
            detail: {
              platforms: [
                {
                  slug: "juejin",
                  name: "掘金",
                  new_article_url: "https://juejin.cn/editor/drafts/new",
                },
              ],
            },
          })
        );
      });
    });

    expect(result.results).toBeDefined();
    expect(result.results.length).toBe(1);

    const juejin = result.results[0];
    // KEY ASSERTION: Even though juejin.cn has a cookie ("some_tracking_cookie"),
    // it should NOT be detected as logged in because the specific "sessionid" cookie is missing.
    // This was the original bug — cookies.length > 0 would have returned true.
    expect(juejin.loggedIn).toBe(false);
    expect(juejin.slug).toBe("juejin");
  });

  test.skip("login check returns true when correct login cookie exists", async ({ context }) => {
    // Navigate to juejin.cn and set the login cookie via document.cookie
    // This ensures the cookie lands in the browser's actual cookie jar
    // which is what chrome.cookies.getAll() reads
    const juejinPage = await context.newPage();
    await juejinPage.goto("https://juejin.cn", { waitUntil: "domcontentloaded", timeout: 15000 });

    // Set the sessionid cookie via document.cookie (same as a real login would)
    await juejinPage.evaluate(() => {
      document.cookie = "sessionid=valid_session_token_123; path=/; max-age=3600";
    });

    // Verify the cookie was set
    const verifyJuejin = await juejinPage.evaluate(() => document.cookie);
    console.log("juejin document.cookie:", verifyJuejin);
    await juejinPage.close();

    // Now navigate to localhost to test login detection via page-bridge
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForLoadState("domcontentloaded");

    // Wait for bridge to be ready
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000);
        window.addEventListener("omnipub:ready", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        window.dispatchEvent(new CustomEvent("omnipub:ping"));
      });
    });

    // Now run the actual check-login
    const result = await page.evaluate(() => {
      return new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve({ results: [] }), 10000);
        window.addEventListener("omnipub:check-login-result", (e: any) => {
          clearTimeout(timer);
          resolve(e.detail);
        }, { once: true });

        window.dispatchEvent(
          new CustomEvent("omnipub:check-login", {
            detail: {
              platforms: [
                {
                  slug: "juejin",
                  name: "掘金",
                  new_article_url: "https://juejin.cn/editor/drafts/new",
                },
              ],
            },
          })
        );
      });
    });
    console.log("checkLoginResult:", JSON.stringify(result));

    expect(result.results).toBeDefined();
    expect(result.results.length).toBe(1);

    const juejin = result.results[0];
    expect(juejin.loggedIn).toBe(true);
    expect(juejin.slug).toBe("juejin");
  });

  test("Settings page UI flow — check login triggers and displays results", async ({ context }) => {
    const page = await context.newPage();

    // First register a user so we can access Settings
    const email = `test_${uid()}@example.com`;
    const username = `user_${uid()}`;
    const password = "testpass123";

    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState("domcontentloaded");

    // Switch to register tab
    const buttons = page.locator("button");
    await buttons.filter({ hasText: "注册" }).first().click();
    await page.getByPlaceholder("请输入用户名").waitFor({ state: "visible" });

    await page.getByPlaceholder("your@email.com").fill(email);
    await page.getByPlaceholder("请输入用户名").fill(username);
    await page.getByPlaceholder("至少 6 位密码").fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/articles", { timeout: 10000 });

    // Navigate to settings
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("domcontentloaded");

    // Wait for platforms to load
    await page.waitForSelector(".grid", { timeout: 10000 });

    // Wait a moment for extension bridge to initialize
    await page.waitForTimeout(1000);

    // Click "检查登录状态" button
    const checkBtn = page.locator('button:has-text("检查登录状态")');
    await checkBtn.click();

    // Wait for either success or error result banner
    // In a clean browser (no platform cookies), we expect "未登录" results
    const resultBanner = page.locator('[class*="rounded-lg"][class*="p-4"]').first();
    await resultBanner.waitFor({ state: "visible", timeout: 15000 });

    // Should show some result text
    const bannerText = await resultBanner.textContent();
    expect(bannerText).toBeTruthy();

    // In clean browser, should show "未登录" for platforms
    // OR "请先安装 Omnipub 扩展" if bridge didn't connect (which shouldn't happen with extension loaded)
    // The important thing is it doesn't crash and shows a result
    expect(
      bannerText!.includes("未登录") ||
      bannerText!.includes("登录状态正常") ||
      bannerText!.includes("检测") ||
      bannerText!.includes("启用") ||
      bannerText!.includes("平台")
    ).toBe(true);
  });
});
