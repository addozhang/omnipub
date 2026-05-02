import { test, expect } from "@playwright/test";
import { register, login, uniqueEmail, uniqueUsername } from "./helpers";

const email = uniqueEmail();
const password = "password123";

test.describe("Auth — 登录注册", () => {
  test("注册新用户并跳转到文章列表", async ({ page }) => {
    await register(page, email, uniqueUsername(), password);
    await expect(page).toHaveURL(/articles/);
  });

  test("登录态下访问 /login 自动跳转", async ({ page }) => {
    await login(page, email, password);
    await page.goto("/login");
    // 路由守卫跳转到 Dashboard（/）
    await expect(page).not.toHaveURL(/login/);
  });

  test("未登录访问受保护页面跳转到登录页", async ({ page }) => {
    await page.goto("/articles");
    await expect(page).toHaveURL(/login/);
  });

  test("注册重复邮箱显示错误信息", async ({ page }) => {
    await page.goto("/login");
    await page.locator("button").filter({ hasText: "注册" }).first().click();
    await page.getByPlaceholder("请输入用户名").waitFor({ state: "visible" });

    await page.getByPlaceholder("your@email.com").fill(email); // 已注册
    await page.getByPlaceholder("请输入用户名").fill(uniqueUsername());
    await page.getByPlaceholder("至少 6 位密码").fill(password);
    await page.locator('button[type="submit"]').click();

    // 应出现错误提示，且停留在登录页
    await expect(page.locator("p.text-red-600, p.text-red-400, .bg-red-50")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/login/);
  });

  test("密码错误停留在登录页", async ({ page }) => {
    // 先注册账号
    const wrongPwEmail = uniqueEmail();
    await register(page, wrongPwEmail, uniqueUsername(), password);
    // 退出
    await page.getByText("退出登录").click();
    // 用错误密码登录
    await page.getByPlaceholder("your@email.com").fill(wrongPwEmail);
    await page.getByPlaceholder("至少 6 位密码").fill("wrong-password");
    await page.locator('button[type="submit"]').click();
    // 停留在登录页且不跳转
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/login/);
  });

  test("退出登录后跳转到登录页", async ({ page }) => {
    // 在本测试内独立注册再登录，避免 localStorage 隔离问题
    const logoutEmail = uniqueEmail();
    await register(page, logoutEmail, uniqueUsername(), password);
    await page.getByText("退出登录").click();
    await expect(page).toHaveURL(/login/);
  });
});
