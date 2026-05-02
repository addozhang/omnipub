import { test, expect } from "@playwright/test";
import { register, uniqueEmail, uniqueUsername } from "./helpers";

test.describe("Settings — 平台启用切换", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    await register(page, uniqueEmail(), uniqueUsername(), "password123");
    token = (await page.evaluate(() => localStorage.getItem("token"))) ?? "";
  });

  test("未启用任何平台时，发布页显示空状态提示", async ({ page }) => {
    // 先创建一篇文章
    const res = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "空平台测试", markdown_content: "内容" },
    });
    const articleId = (await res.json()).data.id;

    // 直接访问发布页（新用户默认无启用平台）
    await page.goto(`/articles/${articleId}/publish`);
    await expect(page.getByText("暂无已启用的平台")).toBeVisible({ timeout: 5000 });
  });

  test("在设置页点击平台卡片 checkbox → 平台变为选中状态", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "渠道设置" })).toBeVisible();
    // 等待平台加载
    await expect(page.getByText("掘金").first()).toBeVisible({ timeout: 5000 });

    // 找到第一个平台的 checkbox（未选中）
    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await expect(firstCheckbox).not.toBeChecked();

    // 点击 checkbox 启用
    const toggleResponse = page.waitForResponse(
      (resp) => resp.url().includes("/platform-configs/") && resp.url().includes("/toggle") && resp.request().method() === "PATCH"
    );
    await firstCheckbox.check();
    await toggleResponse;

    // checkbox 应变为选中
    await expect(firstCheckbox).toBeChecked();
  });

  test("再次点击已选中的 checkbox → 取消选中", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("掘金").first()).toBeVisible({ timeout: 5000 });

    const firstCheckbox = page.locator('input[type="checkbox"]').first();

    // 先启用
    const toggleResp1 = page.waitForResponse(
      (resp) => resp.url().includes("/toggle") && resp.request().method() === "PATCH"
    );
    await firstCheckbox.check();
    await toggleResp1;
    await expect(firstCheckbox).toBeChecked();

    // 再取消
    const toggleResp2 = page.waitForResponse(
      (resp) => resp.url().includes("/toggle") && resp.request().method() === "PATCH"
    );
    await firstCheckbox.uncheck();
    await toggleResp2;
    await expect(firstCheckbox).not.toBeChecked();
  });

  test("启用平台后，发布页能看到该平台", async ({ page }) => {
    // 在设置页启用掘金
    await page.goto("/settings");
    await expect(page.getByText("掘金").first()).toBeVisible({ timeout: 5000 });

    // 找到掘金对应的 checkbox
    const juejinCard = page.locator("div").filter({ hasText: /^掘金/ }).first();
    const checkbox = juejinCard.locator('input[type="checkbox"]');

    const toggleResp = page.waitForResponse(
      (resp) => resp.url().includes("/toggle") && resp.request().method() === "PATCH"
    );
    await checkbox.check();
    await toggleResp;

    // 创建文章
    const res = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "平台可见测试", markdown_content: "内容" },
    });
    const articleId = (await res.json()).data.id;

    // 访问发布页
    await page.goto(`/articles/${articleId}/publish`);
    await expect(page.getByText("掘金").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("暂无已启用的平台")).not.toBeVisible();
  });
});
