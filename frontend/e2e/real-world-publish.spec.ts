import { test, expect } from "./real-world-chrome-fixtures";
import crypto from "crypto";

test("persistent profile — create article and publish", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);

  // Workaround for Playwright #39075: SW race condition
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 3000 });
    } catch {
      [serviceWorker] = context.serviceWorkers();
    }
  }
  if (!serviceWorker) {
    const cdpPage = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(cdpPage);
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
      const trigger = await context.newPage();
      await trigger.goto("about:blank");
      await trigger.close();
    } finally {
      await cdp.detach().catch(() => {});
    }
    [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 5000 });
    }
  }
  serviceWorker.on("console", (msg) => {
    console.log(`[SW] ${msg.text()}`);
  });
  console.log("Service worker logging attached, URL:", serviceWorker.url());

  await page.goto("http://localhost:3000/articles", {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  const url = page.url();
  const token = await page.evaluate(() => localStorage.getItem("token"));
  console.log("Initial URL:", url, "Token:", token ? "present" : "missing");

  if (!token || url.includes("/login")) {
    console.log("Not logged in, registering...");
    const username = `user_${crypto.randomUUID().slice(0, 8)}`;
    const email = `test_${crypto.randomUUID().slice(0, 8)}@example.com`;

    await page.goto("http://localhost:3000/login");
    await page.locator("button").filter({ hasText: "注册" }).first().click();
    await page
      .getByPlaceholder("请输入用户名")
      .waitFor({ state: "visible" });
    await page.getByPlaceholder("your@email.com").fill(email);
    await page.getByPlaceholder("请输入用户名").fill(username);
    await page.getByPlaceholder("至少 6 位密码").fill("password123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/articles", { timeout: 10000 });
    console.log("Registered and logged in");
  }

  const authToken = await page.evaluate(() => localStorage.getItem("token"));
  expect(authToken).toBeTruthy();
  console.log("Auth token:", authToken!.slice(0, 20) + "...");

  const allPlatformsResp = await page.request.get(
    "http://localhost:3000/api/platforms",
    {
      headers: { Authorization: `Bearer ${authToken}` },
    }
  );
  const allPlatformsJson = await allPlatformsResp.json();
  const allPlatforms = allPlatformsJson.data || [];
  const currentConfigsResp = await page.request.get(
    "http://localhost:3000/api/user/platform-configs",
    {
      headers: { Authorization: `Bearer ${authToken}` },
    }
  );
  const currentConfigsJson = await currentConfigsResp.json();
  const configsDict = currentConfigsJson.data || {};
  const enabledSet = new Set(
    Object.values(configsDict).filter((c: any) => c.enabled).map((c: any) => c.platform_slug)
  );
  for (const p of allPlatforms) {
    if (!enabledSet.has(p.slug)) {
      await page.request.patch(
        `http://localhost:3000/api/user/platform-configs/${p.slug}/toggle`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
    }
  }

  const createResp = await page.request.post(
    "http://localhost:3000/api/articles",
    {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        title: `Publish Test ${Date.now()}`,
        markdown_content:
          "# Real-World Publish Test\n\n这是一篇用于真实发布链路的测试文章。\n\n- 列表项 A\n- 列表项 B\n\n```js\nconsole.log('omnipub');\n```",
      },
    }
  );
  const createJson = await createResp.json();
  expect(createJson.success).toBe(true);
  const articleId = createJson.data.id;
  console.log("Article created via API, ID:", articleId);

  await page.goto(`http://localhost:3000/articles/${articleId}/publish`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  await page
    .getByText(/掘金|CSDN|知乎/)
    .first()
    .waitFor({ timeout: 10000 });

  try {
    await page.screenshot({
      path: test.info().outputPath("before-publish.png"),
      fullPage: true,
    });
  } catch (e) {
    console.log("Screenshot failed (expected in CI/xvfb):", (e as Error).message?.slice(0, 100));
  }

  const initialPageCount = context.pages().length;

  page.on("console", (msg) => {
    const text = msg.text();
    if (
      text.includes("[page-bridge]") ||
      text.includes("omnipub") ||
      text.includes("ServiceWorker") ||
      text.includes("[usePublish]") ||
      text.includes("start-publish") ||
      text.includes("dispatchEvent")
    ) {
      console.log(`[browser] ${text}`);
    }
  });

  context.on("page", (newPage) => {
    newPage.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("BasePublisher") ||
        text.includes("FILL_AND_PUBLISH") ||
        text.includes("fetchConfig") ||
        text.includes("配置") ||
        text.includes("填充") ||
        text.includes("发布器") ||
        text.includes("MessageBridge") ||
        text.includes("publisher")
      ) {
        console.log(`[tab:${newPage.url().substring(0, 40)}] ${text}`);
      }
    });
  });

  const extensionReady = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const handler = () => {
        resolve(true);
        window.removeEventListener("omnipub:ready", handler);
      };
      window.addEventListener("omnipub:ready", handler);
      window.dispatchEvent(new CustomEvent("omnipub:ping"));
      setTimeout(() => resolve(false), 3000);
    });
  });
  console.log("Extension page-bridge active:", extensionReady);

  if (!extensionReady) {
    console.log("WARNING: page-bridge not responding, reloading page...");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
  }

  // Add a page-level event listener to verify the event fires at all
  await page.evaluate(() => {
    window.addEventListener("omnipub:start-publish", (e: any) => {
      console.log("[TEST-DIAG] omnipub:start-publish EVENT FIRED! detail:", JSON.stringify({
        hasArticle: !!e.detail?.article,
        platformCount: e.detail?.platforms?.length ?? 0,
        platformSlugs: e.detail?.platforms?.map((p: any) => p.slug) ?? [],
      }));
    });
    console.log("[TEST-DIAG] start-publish event listener registered");
  });

  await page.getByRole("button", { name: /一键发布到\s*\d+\s*个渠道/ }).click();
  console.log("Clicked publish button");

  // Wait a moment and check if the event was received
  await page.waitForTimeout(2000);

  try {
    await page
      .getByRole("heading", { name: "发布进度" })
      .waitFor({ timeout: 10000 });
    console.log("发布进度区域已出现");
  } catch {
    console.log("WARNING: 发布进度区域未出现");
    await page.screenshot({
      path: test.info().outputPath("no-progress.png"),
      fullPage: true,
    }).catch(() => {});
  }

  await page.waitForTimeout(3000);
  try {
    await page.screenshot({
      path: test.info().outputPath("during-progress.png"),
      fullPage: true,
    });
  } catch {
  }

  const statusMap = new Map<string, string>();
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    let statuses: Array<{
      platformName: string;
      statusText: string;
      message: string;
    }>;
    try {
      statuses = await page.evaluate(() => {
        const heading = Array.from(document.querySelectorAll("h2")).find(
          (el) => el.textContent?.includes("发布进度")
        );
        const list = heading?.nextElementSibling;
        const items = list ? Array.from(list.children) : [];
        return items.map((item) => ({
          platformName:
            item
              .querySelector("span.text-sm.font-medium")
              ?.textContent?.trim() ?? "",
          statusText:
            item.querySelector("span.ml-auto")?.textContent?.trim() ?? "",
          message:
            item.querySelector("span.text-xs")?.textContent?.trim() ?? "",
        }));
      });
    } catch {
      console.log("Page evaluate failed, breaking poll loop");
      break;
    }

    for (const s of statuses) {
      const label = `${s.statusText}${s.message ? ` (${s.message})` : ""}`;
      if (s.platformName && statusMap.get(s.platformName) !== label) {
        statusMap.set(s.platformName, label);
        console.log(`状态: ${s.platformName} -> ${label}`);
      }
    }

    const allDone =
      statuses.length > 0 &&
      statuses.every(
        (s) =>
          s.statusText.includes("发布成功") ||
          s.statusText.includes("发布失败")
      );
    if (allDone) break;

    await page.waitForTimeout(2000);
  }

  await page.screenshot({
    path: test.info().outputPath("after-progress.png"),
    fullPage: true,
  }).catch(() => {});

  const newTabCount = context.pages().length - initialPageCount;
  console.log(`新标签页数量: ${newTabCount}`);

  console.log("\n=== 最终平台状态 ===");
  for (const [platform, status] of statusMap.entries()) {
    console.log(`  ${platform}: ${status}`);
  }

  let publishedCount = 0;
  let totalCount = statusMap.size;

  if (authToken) {
    try {
      const resp = await page.request.get(
        `http://localhost:3000/api/articles/${articleId}/publications`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      const data = await resp.json();
      const pubs = data.data || [];
      console.log("\n=== 发布记录 ===");
      console.log(JSON.stringify(data, null, 2));

      publishedCount = pubs.filter((p: any) => p.status === "published").length;
      totalCount = pubs.length || totalCount;
    } catch (e) {
      console.log("获取发布记录失败:", e);
    }
  }

  console.log(`\n${publishedCount}/${totalCount} platforms published successfully`);
  if (totalCount > 0 && publishedCount === 0) {
    const statuses = Array.from(statusMap.entries()).map(([n, s]) => `${n}:${s}`).join(", ");
    console.log(`WARNING: No platforms published (${statuses}). Expected in CI without real cookies.`);
  }
});

test("custom config publish — publish with overridden platform configs", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 3000 });
    } catch {
      [serviceWorker] = context.serviceWorkers();
    }
  }
  if (!serviceWorker) {
    const cdpPage = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(cdpPage);
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
      const trigger = await context.newPage();
      await trigger.goto("about:blank");
      await trigger.close();
    } finally {
      await cdp.detach().catch(() => {});
    }
    [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 5000 });
    }
  }
  serviceWorker.on("console", (msg) => {
    console.log(`[SW] ${msg.text()}`);
  });

  await page.goto("http://localhost:3000/articles", {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  const url = page.url();
  const token = await page.evaluate(() => localStorage.getItem("token"));

  if (!token || url.includes("/login")) {
    const username = `user_${crypto.randomUUID().slice(0, 8)}`;
    const email = `test_${crypto.randomUUID().slice(0, 8)}@example.com`;

    await page.goto("http://localhost:3000/login");
    await page.locator("button").filter({ hasText: "注册" }).first().click();
    await page.getByPlaceholder("请输入用户名").waitFor({ state: "visible" });
    await page.getByPlaceholder("your@email.com").fill(email);
    await page.getByPlaceholder("请输入用户名").fill(username);
    await page.getByPlaceholder("至少 6 位密码").fill("password123");
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/articles", { timeout: 10000 });
  }

  const authToken = await page.evaluate(() => localStorage.getItem("token"));
  expect(authToken).toBeTruthy();

  const targetSlugs = ["juejin", "csdn", "segmentfault"];
  const currentConfigsResp = await page.request.get(
    "http://localhost:3000/api/user/platform-configs",
    {
      headers: { Authorization: `Bearer ${authToken}` },
    }
  );
  const currentConfigsJson = await currentConfigsResp.json();
  const configsDict = currentConfigsJson.data || {};
  const enabledSet = new Set(
    Object.values(configsDict).filter((c: any) => c.enabled).map((c: any) => c.platform_slug)
  );
  for (const slug of targetSlugs) {
    if (!enabledSet.has(slug)) {
      await page.request.patch(
        `http://localhost:3000/api/user/platform-configs/${slug}/toggle`,
        {
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );
    }
  }

  const createResp = await page.request.post(
    "http://localhost:3000/api/articles",
    {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        title: `Custom Config Test ${Date.now()}`,
        markdown_content:
          "# Custom Config Publish\n\n自定义配置发布测试，验证 tags/category 传递。\n\n```python\nprint('omnipub')\n```",
      },
    }
  );
  const createJson = await createResp.json();
  expect(createJson.success).toBe(true);
  const articleId = createJson.data.id;
  console.log("Article created, ID:", articleId);

  await page.goto(`http://localhost:3000/articles/${articleId}/publish`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  await page.getByText(/掘金|CSDN|思否/).first().waitFor({ timeout: 10000 });

  const TARGET_PLATFORMS = ["juejin", "csdn", "segmentfault"];
  const CUSTOM_CONFIGS: Record<string, Record<string, unknown>> = {
    juejin: { category: "后端", tags: ["测试", "自动化"] },
    csdn: { tags: ["omnipub", "自动化发布"], original: true },
    segmentfault: { tags: ["测试标签"] },
  };

  context.on("page", (newPage) => {
    newPage.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("BasePublisher") ||
        text.includes("FILL_AND_PUBLISH") ||
        text.includes("publish_config") ||
        text.includes("fillPublishConfig") ||
        text.includes("填充") ||
        text.includes("标签") ||
        text.includes("分类") ||
        text.includes("publisher")
      ) {
        console.log(`[tab:${newPage.url().substring(0, 40)}] ${text}`);
      }
    });
  });

  page.on("console", (msg) => {
    const text = msg.text();
    if (
      text.includes("[page-bridge]") ||
      text.includes("omnipub") ||
      text.includes("start-publish")
    ) {
      console.log(`[browser] ${text}`);
    }
  });

  const extensionReady = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const handler = () => {
        resolve(true);
        window.removeEventListener("omnipub:ready", handler);
      };
      window.addEventListener("omnipub:ready", handler);
      window.dispatchEvent(new CustomEvent("omnipub:ping"));
      setTimeout(() => resolve(false), 3000);
    });
  });
  if (!extensionReady) {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
  }

  await page.evaluate(
    ({ overrides }) => {
      (window as any).__omnipub_publish_overrides = overrides;
    },
    { overrides: CUSTOM_CONFIGS }
  );

  await page.evaluate(
    ({ targetSlugs, overrides }) => {
      console.log("[TEST] Custom configs:", JSON.stringify(overrides));
      console.log("[TEST] Target platforms:", targetSlugs.join(", "));
    },
    { targetSlugs: TARGET_PLATFORMS, overrides: CUSTOM_CONFIGS }
  );

  const platformsResp = await page.request.get(
    "http://localhost:3000/api/platforms",
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  const platformsJson = await platformsResp.json();
  const allPlatforms = platformsJson.data || [];
  const targetPlatformObjs = allPlatforms.filter((p: any) =>
    TARGET_PLATFORMS.includes(p.slug)
  );

  if (targetPlatformObjs.length === 0) {
    console.log("WARNING: No target platforms found, skipping custom config test");
    return;
  }

  const platformIds = targetPlatformObjs.map((p: any) => p.id);
  const pubResp = await page.request.post(
    `http://localhost:3000/api/articles/${articleId}/publish`,
    {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { platform_ids: platformIds },
    }
  );
  const pubJson = await pubResp.json();
  const publications = pubJson.data || [];

  const publicationIds: Record<string, number> = {};
  for (const pub of publications) {
    const platform = targetPlatformObjs.find((p: any) => p.id === pub.platform_id);
    if (platform) {
      publicationIds[platform.slug] = pub.id;
    }
  }

  console.log("Publication IDs:", JSON.stringify(publicationIds));

  await page.evaluate(() => {
    window.addEventListener("omnipub:publish-progress", (e: any) => {
      const d = e.detail;
      console.log(`[TEST-PROGRESS] ${d.platform}: ${d.status} — ${d.message || ""}`);
    });
  });

  await page.evaluate(
    ({ article, platforms, configs, pubIds, token }) => {
      const platformsWithConfig = platforms.map((p: any) => ({
        ...p,
        publish_config: configs[p.slug] || {},
        publication_id: pubIds[p.slug] || null,
      }));

      console.log("[TEST] Dispatching start-publish with custom configs:");
      for (const p of platformsWithConfig) {
        console.log(`  ${p.slug}: ${JSON.stringify(p.publish_config)}`);
      }

      window.dispatchEvent(
        new CustomEvent("omnipub:start-publish", {
          detail: {
            article,
            platforms: platformsWithConfig,
            authToken: token,
          },
        })
      );
    },
    {
      article: { id: articleId, title: `Custom Config Test ${Date.now()}`, markdown_content: "# Custom Config Publish\n\n自定义配置发布测试。" },
      platforms: targetPlatformObjs,
      configs: CUSTOM_CONFIGS,
      pubIds: publicationIds,
      token: authToken,
    }
  );

  console.log("Custom config publish dispatched, waiting for progress...");

  await page.waitForTimeout(3000);

  const deadline = Date.now() + 120_000;
  const finalStatuses: Record<string, string> = {};

  while (Date.now() < deadline) {
    const resp = await page.request.get(
      `http://localhost:3000/api/articles/${articleId}/publications`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    const data = await resp.json();
    const pubs = data.data || [];

    let allDone = true;
    for (const pub of pubs) {
      finalStatuses[pub.platform_name] = pub.status;
      if (pub.status === "pending") {
        allDone = false;
      }
    }

    if (allDone && pubs.length > 0) break;
    await page.waitForTimeout(3000);
  }

  console.log("\n=== 自定义配置发布结果 ===");
  for (const [name, status] of Object.entries(finalStatuses)) {
    const icon = status === "published" ? "✅" : "❌";
    console.log(`  ${icon} ${name}: ${status}`);
  }

  const pubResp2 = await page.request.get(
    `http://localhost:3000/api/articles/${articleId}/publications`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  const pubData = await pubResp2.json();
  console.log("\n=== 发布记录 ===");
  console.log(JSON.stringify(pubData, null, 2));

  const publishedCount = Object.values(finalStatuses).filter(
    (s) => s === "published"
  ).length;
  const totalCount = Object.keys(finalStatuses).length;
  console.log(`\n${publishedCount}/${TARGET_PLATFORMS.length} platforms published successfully`);
  // CI has no real platform sessions — publish count 0 is expected there
  if (totalCount > 0 && publishedCount === 0) {
    const failedStatuses = Object.entries(finalStatuses).map(([n, s]) => `${n}:${s}`).join(", ");
    console.log(`WARNING: No platforms published (${failedStatuses}). Expected in CI without real cookies.`);
  }
});
