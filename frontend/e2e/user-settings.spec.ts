import { test, expect } from "@playwright/test";
import { register, login, uniqueEmail, uniqueUsername } from "./helpers";

test.describe("User Settings — 用户设置", () => {
  const password = "password123";

  test.beforeEach(async ({ page }) => {
    await register(page, uniqueEmail(), uniqueUsername(), password);
  });

  test("侧边栏用户区域链接到用户设置页", async ({ page }) => {
    await page.goto("/articles");
    // 侧边栏底部用户区域有 router-link 指向 /user/settings
    await page.locator('a[href="/user/settings"]').click();
    await expect(page).toHaveURL(/\/user\/settings/);
    await expect(
      page.getByRole("heading", { name: "用户设置" })
    ).toBeVisible();
  });

  test("默认显示修改密码 tab", async ({ page }) => {
    await page.goto("/user/settings");
    const passwordTab = page.locator("nav button", { hasText: "修改密码" });
    await expect(passwordTab).toBeVisible();
    await expect(page.getByText("当前密码", { exact: true })).toBeVisible();
    await expect(page.getByText("新密码", { exact: true })).toBeVisible();
    await expect(page.getByText("确认新密码")).toBeVisible();
  });

  test("切换到 API 密钥 tab 显示密钥管理", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();
    // API 密钥管理内容可见
    await expect(page.getByText("创建密钥")).toBeVisible();
    await expect(page.getByText("POST /api/articles")).toBeVisible();
    await expect(page.getByText("暂无 API 密钥")).toBeVisible();
  });
});

test.describe("Change Password — 修改密码", () => {
  const password = "password123";
  let email: string;

  test.beforeEach(async ({ page }) => {
    email = uniqueEmail();
    await register(page, email, uniqueUsername(), password);
  });

  test("成功修改密码", async ({ page }) => {
    await page.goto("/user/settings");

    // 填写修改密码表单
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page
      .locator('input[autocomplete="new-password"]')
      .first()
      .fill("newpassword456");
    await page
      .locator('input[autocomplete="new-password"]')
      .last()
      .fill("newpassword456");

    const changeResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/user/password") &&
        resp.request().method() === "PUT"
    );
    await page.locator('button[type="submit"]').click();
    await changeResp;

    await expect(page.getByText("密码修改成功")).toBeVisible();

    // 用新密码登录验证
    await page.getByText("退出登录").click();
    await login(page, email, "newpassword456");
    await expect(page).toHaveURL(/articles/);
  });

  test("两次新密码不一致显示错误", async ({ page }) => {
    await page.goto("/user/settings");

    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page
      .locator('input[autocomplete="new-password"]')
      .first()
      .fill("newpass1");
    await page
      .locator('input[autocomplete="new-password"]')
      .last()
      .fill("newpass2");

    await page.locator('button[type="submit"]').click();

    await expect(page.getByText("两次输入的新密码不一致")).toBeVisible();
  });

  test("当前密码错误显示错误信息", async ({ page }) => {
    await page.goto("/user/settings");

    await page
      .locator('input[autocomplete="current-password"]')
      .fill("wrongpassword");
    await page
      .locator('input[autocomplete="new-password"]')
      .first()
      .fill("newpassword456");
    await page
      .locator('input[autocomplete="new-password"]')
      .last()
      .fill("newpassword456");

    const changeResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/user/password") &&
        resp.request().method() === "PUT"
    );
    await page.locator('button[type="submit"]').click();
    await changeResp;

    // 应显示错误提示（当前密码错误）
    await expect(page.locator("p.text-red-600, p.text-red-400")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("API Key Management — API 密钥管理", () => {
  const password = "password123";

  test.beforeEach(async ({ page }) => {
    await register(page, uniqueEmail(), uniqueUsername(), password);
  });

  test("创建 API 密钥并显示明文", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();

    // 点击"创建密钥"
    await page.getByRole("button", { name: "创建密钥" }).click();

    // 弹窗出现 — 输入名称
    await expect(page.getByText("创建 API 密钥")).toBeVisible();
    await page.getByPlaceholder("例如: CI/CD Pipeline").fill("Test Key");

    const createResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/api-keys") &&
        resp.request().method() === "POST"
    );
    await page.locator('.fixed button[type="submit"]').click();
    await createResp;

    // reveal 弹窗出现 — 显示明文密钥
    await expect(page.getByText("API 密钥已创建")).toBeVisible();
    await expect(page.getByText("请立即复制此密钥")).toBeVisible();
    // reveal 弹窗内密钥以 omnk_ 开头
    await expect(page.locator(".fixed code.break-all")).toBeVisible();

    // 关闭 reveal 弹窗
    await page.getByRole("button", { name: "我已保存密钥" }).click();

    // 密钥出现在列表中
    await expect(page.getByText("Test Key")).toBeVisible();
  });

  test("空状态显示提示文案", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();

    await expect(page.getByText("暂无 API 密钥")).toBeVisible();
  });

  test("重新生成密钥", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();

    await page.getByRole("button", { name: "创建密钥" }).click();
    await page.getByPlaceholder("例如: CI/CD Pipeline").fill("Regen Key");
    const createResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/api-keys") &&
        resp.request().method() === "POST"
    );
    await page.locator('.fixed button[type="submit"]').click();
    await createResp;
    await page.getByRole("button", { name: "我已保存密钥" }).click();

    // 密钥在列表中
    await expect(page.getByText("Regen Key")).toBeVisible();

    // 拦截 confirm 对话框 → 自动接受
    page.on("dialog", (dialog) => dialog.accept());

    // 点击"重新生成"
    const regenResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/regenerate") &&
        resp.request().method() === "POST"
    );
    await page.getByRole("button", { name: "重新生成" }).click();
    await regenResp;

    // reveal 弹窗出现 — 新密钥
    await expect(page.getByText("密钥已重新生成")).toBeVisible();
    await expect(page.locator(".fixed code.break-all")).toBeVisible();

    await page.getByRole("button", { name: "我已保存密钥" }).click();
  });

  test("删除密钥后从列表消失", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();

    await page.getByRole("button", { name: "创建密钥" }).click();
    await page.getByPlaceholder("例如: CI/CD Pipeline").fill("Delete Me");
    const createResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/api-keys") &&
        resp.request().method() === "POST"
    );
    await page.locator('.fixed button[type="submit"]').click();
    await createResp;
    await page.getByRole("button", { name: "我已保存密钥" }).click();

    await expect(page.getByText("Delete Me")).toBeVisible();

    // 拦截 confirm 对话框
    page.on("dialog", (dialog) => dialog.accept());

    // 点击"删除"
    const deleteResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/api-keys") &&
        resp.request().method() === "DELETE"
    );
    await page.getByRole("button", { name: "删除" }).click();
    await deleteResp;

    // 密钥消失，回到空状态
    await expect(page.getByText("Delete Me")).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText("暂无 API 密钥")).toBeVisible();
  });

  test("API 密钥可用于创建文章", async ({ page }) => {
    await page.goto("/user/settings");
    await page.getByRole("button", { name: "API 密钥" }).click();

    await page.getByRole("button", { name: "创建密钥" }).click();
    await page.getByPlaceholder("例如: CI/CD Pipeline").fill("API Auth Key");
    const createResp = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/api-keys") &&
        resp.request().method() === "POST"
    );
    await page.locator('.fixed button[type="submit"]').click();
    const createResult = await createResp;
    const createBody = await createResult.json();
    const apiKey = createBody.data.key;

    // 用 API 密钥调用创建文章接口
    const articleResp = await page.request.post("/api/articles", {
      headers: { Authorization: `Bearer ${apiKey}` },
      data: {
        title: "API Key 创建的文章",
        markdown_content: "# 通过 API Key 创建\n内容",
      },
    });

    expect(articleResp.ok()).toBeTruthy();
    const articleBody = await articleResp.json();
    expect(articleBody.success).toBe(true);
    expect(articleBody.data.title).toBe("API Key 创建的文章");

    // 在文章列表中验证
    await page.goto("/articles");
    await expect(page.getByText("API Key 创建的文章")).toBeVisible();
  });
});
