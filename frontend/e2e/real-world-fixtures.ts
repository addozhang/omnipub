/**
 * Real-World Test Fixtures — extends persistent profile fixtures with
 * session-aware platform skip logic.
 *
 * Usage in test files:
 *
 *   import { test, expect } from "./real-world-fixtures";
 *
 *   test("publish to juejin", async ({ page, context, requirePlatform }) => {
 *     await requirePlatform("juejin");   // skips if not logged in
 *     // ... test code ...
 *   });
 *
 *   test("publish to multiple", async ({ page, context, requirePlatform }) => {
 *     await requirePlatform("juejin", "csdn");  // skips if ANY are missing
 *     // ... test code ...
 *   });
 *
 * The session check happens once per test worker (cached), not per test.
 */
import { type BrowserContext } from "@playwright/test";
import { persistentTest } from "./extension-fixtures";
import {
  checkAllSessions,
  PLATFORM_SESSIONS,
  type SessionStatus,
} from "./session-health";

// ─── Session Cache ───────────────────────────────────────────────────────────
// Cache session results per worker to avoid re-checking for every test.
// The cache is invalidated when the BrowserContext changes (new worker).

let cachedResults: SessionStatus[] | null = null;
let cachedContextId: string | null = null;

async function getSessionResults(
  context: BrowserContext,
): Promise<SessionStatus[]> {
  // Use a rough identity check — if the context object reference changed,
  // invalidate the cache. This works because Playwright creates one context
  // per worker in persistent mode.
  const contextId = (context as any)._guid ?? String(context);
  if (cachedResults && cachedContextId === contextId) {
    return cachedResults;
  }

  cachedResults = await checkAllSessions(context);
  cachedContextId = contextId;
  return cachedResults;
}

// ─── Fixture Extension ───────────────────────────────────────────────────────

export const test = persistentTest.extend<{
  /**
   * Skip the current test if any of the specified platforms don't have
   * an active session. Accepts one or more platform slugs.
   *
   * @example
   *   await requirePlatform("juejin");
   *   await requirePlatform("juejin", "csdn", "zhihu");
   */
  requirePlatform: (...slugs: string[]) => Promise<void>;

  /**
   * Get the full session health results for all platforms.
   * Useful for tests that want to dynamically select which platforms to test.
   *
   * @example
   *   const sessions = await getSessionHealth();
   *   const active = sessions.filter(s => s.loggedIn);
   *   console.log(`Testing ${active.length} platforms`);
   */
  getSessionHealth: () => Promise<SessionStatus[]>;

  /**
   * Get slugs of all platforms with active sessions.
   * Convenience wrapper around getSessionHealth().
   */
  activePlatforms: string[];
}>({
  requirePlatform: async ({ context }, use, testInfo) => {
    const fn = async (...slugs: string[]) => {
      if (slugs.length === 0) {
        throw new Error("requirePlatform() needs at least one platform slug");
      }

      const results = await getSessionResults(context);

      for (const slug of slugs) {
        const config = PLATFORM_SESSIONS.find((p) => p.slug === slug);
        if (!config) {
          throw new Error(
            `Unknown platform slug: "${slug}". ` +
              `Valid slugs: ${PLATFORM_SESSIONS.map((p) => p.slug).join(", ")}`,
          );
        }

        const result = results.find((r) => r.slug === slug);
        if (!result?.loggedIn) {
          const reason = result?.expired
            ? `session expired (${result.cookieName} expired at ${result.cookieExpires})`
            : `not logged in (cookie "${config.cookieName}" not found)`;

          testInfo.skip(
            true,
            `Platform "${config.name}" (${slug}): ${reason}. Run: npm run seed-profile`,
          );
          return; // skip() throws, but TypeScript doesn't know that
        }
      }
    };

    await use(fn);
  },

  getSessionHealth: async ({ context }, use) => {
    const fn = async () => getSessionResults(context);
    await use(fn);
  },

  activePlatforms: async ({ context }, use) => {
    const results = await getSessionResults(context);
    const active = results.filter((r) => r.loggedIn).map((r) => r.slug);
    await use(active);
  },
});

export const expect = test.expect;

// Re-export types for convenience
export type { SessionStatus } from "./session-health";
