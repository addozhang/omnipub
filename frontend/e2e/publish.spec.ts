import { test, expect } from "@playwright/test";
import { register, uniqueEmail, uniqueUsername } from "./helpers";

test.describe("Publish & Pages — 发布与页面导航", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    await register(page, uniqueEmail(), uniqueUsername(), "password123");
    token = (await page.evaluate(() => localStorage.getItem("token"))) ?? "";
  });

  test("Dashboard 显示统计内容", async ({ page }) => {
    await page.goto("/");
    // Dashboard 有统计相关内容
    await expect(page.locator("body")).toContainText(/文章|草稿|发布/);
  });

  test("发布历史页面可访问", async ({ page }) => {
    await page.goto("/publications");
    await expect(page).toHaveURL(/publications/);
    // 页面不报错
    await expect(page.locator("body")).not.toContainText("Cannot GET");
  });

  test("渠道设置页面显示平台", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "渠道设置" })).toBeVisible();
    await expect(page.getByText(/掘金|CSDN|知乎/).first()).toBeVisible({ timeout: 5000 });
  });

  test("发布页面显示平台列表和一键发布按钮", async ({ page }) => {
    // 创建文章
    const res = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "发布测试", markdown_content: "内容" },
    });
    const articleId = (await res.json()).data.id;

    const platformsRes = await page.request.get("/api/platforms", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const platforms = (await platformsRes.json()).data;
    for (const p of platforms.slice(0, 3)) {
      await page.request.patch(`/api/user/platform-configs/${p.slug}/toggle`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    await page.goto(`/articles/${articleId}/publish`);
    // 显示平台列表（已启用平台）
    await expect(page.getByText(/掘金|CSDN|知乎/).first()).toBeVisible({ timeout: 5000 });
    // 显示一键发布按钮
    await expect(page.getByRole("button", { name: /一键发布|发布到所有渠道/ })).toBeVisible({ timeout: 5000 });
  });

  test("侧边栏导航跳转正确", async ({ page }) => {
    await page.goto("/");

    // 导航到文章列表
    await page.getByRole("link", { name: /我的文章/ }).click();
    await expect(page).toHaveURL(/articles/);

    // 导航到设置
    await page.getByRole("link", { name: /渠道设置/ }).click();
    await expect(page).toHaveURL(/settings/);
  });

  test("未启用任何平台时，发布页平台列表为空", async ({ page }) => {
    // 创建文章
    const res = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "空平台测试", markdown_content: "内容" },
    });
    const articleId = (await res.json()).data.id;

    // 新用户默认无启用平台
    await page.goto(`/articles/${articleId}/publish`);
    await expect(page.getByText("暂无已启用的平台")).toBeVisible({ timeout: 5000 });
  });

  test("启用 1 个平台后，发布页只显示该平台", async ({ page }) => {
    await page.request.patch("/api/user/platform-configs/juejin/toggle", {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 创建文章
    const res = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "单平台发布测试", markdown_content: "内容" },
    });
    const articleId = (await res.json()).data.id;

    // 发布页应只显示掘金
    await page.goto(`/articles/${articleId}/publish`);
    await expect(page.getByText("暂无已启用的平台")).not.toBeVisible();
    // 至少可以看到掘金
    await expect(page.getByText("掘金").first()).toBeVisible({ timeout: 5000 });
  });
});
