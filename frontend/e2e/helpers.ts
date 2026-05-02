import { Page } from "@playwright/test";

export async function register(
  page: Page,
  email: string,
  username: string,
  password: string
) {
  await page.goto("/login");
  const buttons = page.locator("button");
  await buttons.filter({ hasText: "注册" }).first().click();
  await page.getByPlaceholder("请输入用户名").waitFor({ state: "visible" });

  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("请输入用户名").fill(username);
  await page.getByPlaceholder("至少 6 位密码").fill(password);

  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/articles", { timeout: 10000 });
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("your@email.com").fill(email);
  await page.getByPlaceholder("至少 6 位密码").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/articles", { timeout: 10000 });
}

const _uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function uniqueEmail() {
  return `test_${_uid()}@example.com`;
}

export function uniqueUsername() {
  return `user_${_uid()}`;
}
