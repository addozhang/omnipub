import { persistentTest as test, expect } from "./extension-fixtures";

test("basic persistent profile test", async ({ page }) => {
  test.setTimeout(30000);
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-results/profile-basic.png" });
  console.log("URL:", page.url());
  const title = await page.title();
  console.log("Title:", title);
});
