import { beforeEach, describe, expect, it, vi } from "vitest";

const API_BASE = "http://localhost:3000";

const createFetchResponse = ({ ok = true, status = 200, json, text }) => ({
  ok,
  status,
  json: vi.fn(async () => json),
  text: vi.fn(async () => text ?? ""),
});

const loadServiceWorker = async () => {
  await import("../../background/service-worker.js");
  const messageHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  const externalHandler = chrome.runtime.onMessageExternal.addListener.mock.calls[0][0];
  return { messageHandler, externalHandler };
};

const callHandler = (handler, message, sender = {}) =>
  new Promise((resolve) => {
    handler(message, sender, resolve);
  });

describe("service-worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("Session Management", () => {
    it("getSession returns null when no session stored", async () => {
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, { action: "getSession" });
      expect(result).toEqual({ success: true, data: null });
    });

    it("getSession returns stored token", async () => {
      await chrome.storage.local.set({ mp_session: "token-123" });
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, { action: "getSession" });
      expect(result).toEqual({ success: true, data: "token-123" });
    });

    it("saveSession stores token and getSession retrieves it", async () => {
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, { action: "saveSession", token: "saved-token" });
      const result = await callHandler(messageHandler, { action: "getSession" });
      expect(result).toEqual({ success: true, data: "saved-token" });
    });

    it("clearSession removes stored token", async () => {
      await chrome.storage.local.set({ mp_session: "old-token" });
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, { action: "clearSession" });
      const result = await callHandler(messageHandler, { action: "getSession" });
      expect(result).toEqual({ success: true, data: null });
    });

    it("verifySession calls /api/ext/auth/me and returns user data", async () => {
      await chrome.storage.local.set({ mp_session: "jwt-token" });
      global.fetch.mockResolvedValue(
        createFetchResponse({ json: { data: { id: 7, name: "Ada" } } })
      );
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, { action: "verifySession" });
      expect(result).toEqual({ success: true, data: { id: 7, name: "Ada" } });
      expect(global.fetch).toHaveBeenCalledWith(`${API_BASE}/api/ext/auth/me`, expect.any(Object));
      const options = global.fetch.mock.calls[0][1];
      expect(options.headers.Authorization).toBe("Bearer jwt-token");
    });
  });

  describe("Message Routing", () => {
    it("handleMessage routes getSession/saveSession/clearSession actions", async () => {
      const { messageHandler } = await loadServiceWorker();
      const saveResult = await callHandler(messageHandler, { action: "saveSession", token: "abc" });
      expect(saveResult.success).toBe(true);
      const getResult = await callHandler(messageHandler, { action: "getSession" });
      expect(getResult.data).toBe("abc");
      const clearResult = await callHandler(messageHandler, { action: "clearSession" });
      expect(clearResult.success).toBe(true);
    });

    it("handleMessage routes reportPublishResult to API", async () => {
      global.fetch.mockResolvedValue(
        createFetchResponse({ json: { success: true } })
      );
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, {
        action: "reportPublishResult",
        data: { publication_id: 1, status: "published" },
      });
      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/articles/report-publish-result`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("handleMessage routes getApiBase returning API_BASE", async () => {
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, { action: "getApiBase" });
      expect(result).toEqual({ success: true, data: API_BASE });
    });

    it("handleMessage returns error for unknown action", async () => {
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, { action: "unknown" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知的消息类型");
    });
  });

  describe("API Request", () => {
    it("apiRequest adds Authorization header when session exists", async () => {
      await chrome.storage.local.set({ mp_session: "header-token" });
      global.fetch.mockResolvedValue(
        createFetchResponse({ json: { ok: true } })
      );
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, {
        action: "reportPublishResult",
        data: { publication_id: 2, status: "published" },
      });
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers.Authorization).toBe("Bearer header-token");
    });

    it("apiRequest throws on non-ok response", async () => {
      global.fetch.mockResolvedValue(
        createFetchResponse({ ok: false, status: 500, text: "Boom" })
      );
      const { messageHandler } = await loadServiceWorker();
      const result = await callHandler(messageHandler, {
        action: "reportPublishResult",
        data: { publication_id: 3, status: "failed" },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("failed");
    });
  });

  describe("External Messages", () => {
    const validSender = { origin: "http://localhost:3000" };

    it("OMNIPUB_PING returns installed:true with version", async () => {
      const { externalHandler } = await loadServiceWorker();
      const sendResponse = vi.fn();
      const result = externalHandler({ type: "OMNIPUB_PING" }, validSender, sendResponse);
      expect(result).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ installed: true, version: "1.0.0" }));
    });

    it("Non-OMNIPUB_PING messages are handled gracefully", async () => {
      const { externalHandler } = await loadServiceWorker();
      const sendResponse = vi.fn();
      const result = externalHandler({ type: "OTHER" }, validSender, sendResponse);
      expect(result).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ error: "unknown message type" }));
    });

    it("rejects messages from disallowed origins", async () => {
      const { externalHandler } = await loadServiceWorker();
      const sendResponse = vi.fn();
      const result = externalHandler({ type: "OMNIPUB_PING" }, { origin: "https://evil.com" }, sendResponse);
      expect(result).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ error: "origin not allowed" }));
    });
  });

  describe("Dynamic Bridge Script Registration", () => {
    it("setApiBase registers bridge scripts for non-localhost URL", async () => {
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, { action: "setApiBase", url: "http://150.109.196.70:3000" });

      expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
        ids: ["omnipub-bridge-main", "omnipub-bridge-isolated"],
      });
      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
        {
          id: "omnipub-bridge-main",
          matches: ["http://150.109.196.70:3000/*"],
          js: ["content-scripts/main-world-bridge.js"],
          world: "MAIN",
          runAt: "document_start",
        },
        {
          id: "omnipub-bridge-isolated",
          matches: ["http://150.109.196.70:3000/*"],
          js: ["content-scripts/page-bridge.js"],
          runAt: "document_start",
        },
      ]);
    });

    it("setApiBase skips registration for localhost (already in manifest)", async () => {
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, { action: "setApiBase", url: "http://localhost:3000" });

      expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalled();
      expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
    });

    it("setApiBase strips trailing slashes before registering", async () => {
      const { messageHandler } = await loadServiceWorker();
      await callHandler(messageHandler, { action: "setApiBase", url: "http://example.com:8080///" });

      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ matches: ["http://example.com:8080/*"] }),
        ])
      );
    });

    it("onInstalled registers bridge scripts from stored API base", async () => {
      await chrome.storage.local.set({ omnipub_api_base: "http://myserver.com:9000" });
      global.fetch.mockResolvedValue(
        createFetchResponse({ json: { data: [] } })
      );
      await loadServiceWorker();

      const onInstalledCb = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
      await onInstalledCb({ reason: "install" });

      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ matches: ["http://myserver.com:9000/*"] }),
        ])
      );
    });

    it("onStartup registers bridge scripts from stored API base", async () => {
      await chrome.storage.local.set({ omnipub_api_base: "https://omnipub.example.com" });
      global.fetch.mockResolvedValue(
        createFetchResponse({ json: { data: [] } })
      );
      await loadServiceWorker();

      const onStartupCb = chrome.runtime.onStartup.addListener.mock.calls[0][0];
      await onStartupCb();

      expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ matches: ["https://omnipub.example.com/*"] }),
        ])
      );
    });
  });

  describe("checkLogin (with verify)", () => {
    beforeEach(() => {
      globalThis.PLATFORM_CONFIGS = [
        {
          slug: "oschina",
          name: "开源中国",
          loginCheck: {
            check_url: "https://my.oschina.net",
            login_cookie: "oscid",
            verify: {
              url: "https://apiv1.oschina.net/oschinapi/user/myDetails",
              headers: { Referer: "https://my.oschina.net/" },
              success_path: "success",
              success_value: true,
            },
          },
        },
        {
          slug: "segmentfault",
          name: "思否",
          loginCheck: {
            check_url: "https://segmentfault.com",
            login_cookie: "PHPSESSID",
          },
        },
      ];
    });

    const platformWithVerify = {
      slug: "oschina",
      name: "开源中国",
    };

    it("returns loggedIn=false when login cookie missing (skips verify)", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "other", value: "x" }]);
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [platformWithVerify],
      });

      expect(result.results[0].loggedIn).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns loggedIn=true when cookie present and verify succeeds", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "oscid", value: "abc" }]);
      global.fetch.mockResolvedValueOnce(
        createFetchResponse({ json: { success: true, code: 200, result: { userId: 1 } } })
      );
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [platformWithVerify],
      });

      expect(result.results[0].loggedIn).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://apiv1.oschina.net/oschinapi/user/myDetails",
        expect.objectContaining({
          credentials: "include",
          headers: expect.objectContaining({ Referer: "https://my.oschina.net/" }),
        })
      );
    });

    it("returns loggedIn=false when cookie present but verify says not logged in", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "oscid", value: "stale" }]);
      global.fetch.mockResolvedValueOnce(
        createFetchResponse({ json: { success: false, code: 40001, message: "用户未登录" } })
      );
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [platformWithVerify],
      });

      expect(result.results[0].loggedIn).toBe(false);
    });

    it("falls back to cookie-only result when verify request throws (network error)", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "oscid", value: "abc" }]);
      global.fetch.mockRejectedValueOnce(new Error("network down"));
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [platformWithVerify],
      });

      expect(result.results[0].loggedIn).toBe(true);
    });

    it("returns loggedIn=false when verify HTTP status is not ok", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "oscid", value: "abc" }]);
      global.fetch.mockResolvedValueOnce(
        createFetchResponse({ ok: false, status: 401, json: {} })
      );
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [platformWithVerify],
      });

      expect(result.results[0].loggedIn).toBe(false);
    });

    it("preserves cookie-only behavior for platforms without verify config", async () => {
      chrome.cookies.getAll.mockResolvedValueOnce([{ name: "PHPSESSID", value: "x" }]);
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [
          {
            slug: "segmentfault",
            name: "思否",
          },
        ],
      });

      expect(result.results[0].loggedIn).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns loggedIn=false when PLATFORM_CONFIGS slug not found (no fallback to 'any cookie')", async () => {
      // 回归测试：旧实现会 fallback 到 platform.new_article_url + "任意 cookie 即登录"，
      // 在 SW 里 PLATFORM_CONFIGS 丢失或平台未配置时把所有平台误判为已登录
      chrome.cookies.getAll.mockResolvedValueOnce([
        { name: "_ga", value: "x" },
        { name: "Hm_lvt", value: "y" },
      ]);
      const { messageHandler } = await loadServiceWorker();

      const result = await callHandler(messageHandler, {
        action: "checkLogin",
        platforms: [
          {
            slug: "unknown-platform",
            name: "未知平台",
            new_article_url: "https://example.com/write",
          },
        ],
      });

      expect(result.results[0].loggedIn).toBe(false);
      // 不应调用 cookies.getAll，因为找不到配置就直接返回 false
      expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    });

    it("returns all loggedIn=false and surfaces error when PLATFORM_CONFIGS unavailable", async () => {
      // 回归测试：SW 重启后偶发 PLATFORM_CONFIGS 丢失的情形
      const { messageHandler } = await loadServiceWorker();
      // 清空全局配置模拟丢失
      delete globalThis.PLATFORM_CONFIGS;
      if (typeof self !== "undefined") delete self.PLATFORM_CONFIGS;
      // 阻止 importScripts 重新加载
      const origImport = globalThis.importScripts;
      globalThis.importScripts = () => { throw new Error("simulated import failure"); };

      try {
        const result = await callHandler(messageHandler, {
          action: "checkLogin",
          platforms: [
            { slug: "juejin", name: "掘金" },
            { slug: "csdn", name: "CSDN" },
          ],
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("PLATFORM_CONFIGS");
        expect(result.results).toHaveLength(2);
        expect(result.results.every((r) => r.loggedIn === false)).toBe(true);
      } finally {
        globalThis.importScripts = origImport;
      }
    });
  });
});
