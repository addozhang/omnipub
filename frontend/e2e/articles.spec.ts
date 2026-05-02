import { test, expect } from "@playwright/test";
import { register, uniqueEmail, uniqueUsername } from "./helpers";

test.describe("Articles — 文章管理", () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    await register(page, uniqueEmail(), uniqueUsername(), "password123");
    token = (await page.evaluate(() => localStorage.getItem("token"))) ?? "";
  });

  test("新建文章页面加载正常", async ({ page }) => {
    await page.goto("/articles/new");
    // 标题输入框
    await expect(page.getByPlaceholder("请输入文章标题")).toBeVisible();
    // Vditor 编辑器
    await expect(page.locator("#vditor")).toBeVisible();
    // 保存按钮
    await expect(page.getByText("保存草稿")).toBeVisible();
  });

  test("文章列表 - 空状态显示提示文案", async ({ page }) => {
    await page.goto("/articles");
    await expect(page.getByText(/还没有文章/)).toBeVisible();
  });

  test("文章列表 - 创建后显示文章", async ({ page }) => {
    // 通过 API 创建
    await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "列表测试文章", markdown_content: "# 测试\n内容" },
    });

    await page.goto("/articles");
    await expect(page.getByText("列表测试文章")).toBeVisible();
  });

  test("删除文章后从列表消失", async ({ page }) => {
    await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: "待删除文章", markdown_content: "内容" },
    });

    await page.goto("/articles");
    await expect(page.getByText("待删除文章")).toBeVisible();

    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByText("确认删除")).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (resp) => resp.url().includes("/api/articles/") && resp.request().method() === "DELETE"
    );
    await page.locator(".fixed button", { hasText: "删除" }).click();
    await deleteResponse;

    await expect(page.getByText("待删除文章")).not.toBeVisible({ timeout: 5000 });
  });
});
