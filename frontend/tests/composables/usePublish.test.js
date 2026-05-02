import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Helper: auto-respond to omnipub:verify-session with a valid session.
 * startPublish() now calls verifyExtensionSession() first, which dispatches
 * omnipub:verify-session and waits for omnipub:verify-session-result.
 */
function autoApproveSession() {
  const handler = () => {
    window.dispatchEvent(
      new CustomEvent("omnipub:verify-session-result", {
        detail: { valid: true, resynced: false },
      })
    );
  };
  window.addEventListener("omnipub:verify-session", handler);
  return () => window.removeEventListener("omnipub:verify-session", handler);
}

describe("usePublish", () => {
  let cleanupSession;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    cleanupSession = autoApproveSession();
  });

  afterEach(() => {
    cleanupSession();
  });

  async function loadUsePublish() {
    vi.resetModules();
    const { usePublish } = await import("../../src/composables/usePublish");
    return usePublish();
  }

  it("initializes platformStatuses with pending status for each platform", async () => {
    const { startPublish, platformStatuses } = await loadUsePublish();

    const platforms = [
      { slug: "juejin", name: "掘金", new_article_url: "https://juejin.cn/editor" },
      { slug: "csdn", name: "CSDN", new_article_url: "https://csdn.net/editor" },
    ];

    await startPublish({ id: 1, title: "Test" }, platforms);

    expect(Object.keys(platformStatuses.value)).toHaveLength(2);
    expect(platformStatuses.value.juejin.status).toBe("pending");
    expect(platformStatuses.value.juejin.platformName).toBe("掘金");
    expect(platformStatuses.value.csdn.status).toBe("pending");
  });

  it("dispatches omnipub:start-publish CustomEvent with correct detail", async () => {
    const { startPublish } = await loadUsePublish();

    const article = { id: 1, title: "Hello" };
    const platforms = [{ slug: "juejin", name: "掘金", new_article_url: "https://juejin.cn/editor" }];

    await startPublish(article, platforms);

    // Find the start-publish event among all dispatchEvent calls
    // (verify-session is dispatched first)
    const startEvent = window.dispatchEvent.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "omnipub:start-publish");
    expect(startEvent).toBeDefined();
    expect(startEvent.detail.article).toEqual(article);
    // F-5: authToken is intentionally NOT included in CustomEvent detail
    // (security fix — CustomEvent.detail is accessible to all MAIN-world scripts)
    expect(startEvent.detail.authToken).toBeUndefined();
    expect(startEvent.detail.platforms[0].slug).toBe("juejin");
  });

  it("merges platformConfigs into platforms array", async () => {
    const { startPublish } = await loadUsePublish();

    const platforms = [{ slug: "juejin", name: "掘金" }];
    const configs = { juejin: { tags: ["vue"], category: "frontend" } };

    await startPublish({ id: 1 }, platforms, true, null, configs);

    const startEvent = window.dispatchEvent.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "omnipub:start-publish");
    expect(startEvent.detail.platforms[0].publish_config).toEqual({
      tags: ["vue"],
      category: "frontend",
    });
  });

  it("does not include authToken in CustomEvent detail (F-5 security)", async () => {
    const { startPublish } = await loadUsePublish();

    localStorage.setItem("token", "my-secret-token");
    await startPublish({ id: 1 }, [{ slug: "a", name: "A" }]);

    const startEvent = window.dispatchEvent.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "omnipub:start-publish");
    expect(startEvent.detail.authToken).toBeUndefined();
  });

  it("does not include authToken even when no token in localStorage", async () => {
    const { startPublish } = await loadUsePublish();

    await startPublish({ id: 1 }, [{ slug: "a", name: "A" }]);

    const startEvent = window.dispatchEvent.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "omnipub:start-publish");
    expect(startEvent.detail.authToken).toBeUndefined();
  });

  it("updates platformStatuses on publish progress event", async () => {
    const { startPublish, platformStatuses } = await loadUsePublish();
    const platforms = [{ slug: "juejin", name: "掘金" }];

    await startPublish({ id: 1 }, platforms);

    // Simulate progress event from extension
    window.dispatchEvent(
      new CustomEvent("omnipub:publish-progress", {
        detail: {
          platform: "juejin",
          platformName: "掘金",
          status: "success",
          message: "发布成功",
        },
      })
    );

    expect(platformStatuses.value.juejin.status).toBe("success");
    expect(platformStatuses.value.juejin.message).toBe("发布成功");
  });

  it("calls onProgress callback on progress event", async () => {
    const { startPublish } = await loadUsePublish();
    const onProgress = vi.fn();
    const platforms = [{ slug: "csdn", name: "CSDN" }];

    await startPublish({ id: 1 }, platforms, true, onProgress);

    const detail = { platform: "csdn", status: "success", message: "ok" };
    window.dispatchEvent(new CustomEvent("omnipub:publish-progress", { detail }));

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(detail);
  });

  it("stopListening removes the event listener", async () => {
    const { startPublish, stopListening, platformStatuses } = await loadUsePublish();
    const platforms = [{ slug: "juejin", name: "掘金" }];

    await startPublish({ id: 1 }, platforms);
    stopListening();

    // This event should NOT update statuses after stopListening
    window.dispatchEvent(
      new CustomEvent("omnipub:publish-progress", {
        detail: { platform: "juejin", status: "success", message: "done" },
      })
    );

    expect(platformStatuses.value.juejin.status).toBe("pending");
  });

  it("replaces previous progress listener on new startPublish", async () => {
    const { startPublish } = await loadUsePublish();

    const onProgress1 = vi.fn();
    const onProgress2 = vi.fn();

    await startPublish({ id: 1 }, [{ slug: "a", name: "A" }], true, onProgress1);
    await startPublish({ id: 2 }, [{ slug: "b", name: "B" }], true, onProgress2);

    // Fire progress for platform "a" (from first startPublish)
    window.dispatchEvent(
      new CustomEvent("omnipub:publish-progress", {
        detail: { platform: "a", status: "success", message: "done" },
      })
    );

    // Old listener should have been removed, only new one fires
    expect(onProgress1).not.toHaveBeenCalled();
    expect(onProgress2).toHaveBeenCalledTimes(1);
  });

  it("includes publication_id in dispatched platforms", async () => {
    const { startPublish } = await loadUsePublish();

    const platforms = [{ slug: "juejin", name: "掘金" }];
    const pubIds = { juejin: 42 };

    await startPublish({ id: 1 }, platforms, true, null, {}, pubIds);

    const startEvent = window.dispatchEvent.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === "omnipub:start-publish");
    expect(startEvent.detail.platforms[0].publication_id).toBe(42);
  });

  it("returns error when extension session is invalid", async () => {
    // Override the auto-approve with a rejection
    cleanupSession();
    const handler = () => {
      window.dispatchEvent(
        new CustomEvent("omnipub:verify-session-result", {
          detail: { valid: false, resynced: false },
        })
      );
    };
    window.addEventListener("omnipub:verify-session", handler);

    const { startPublish, platformStatuses } = await loadUsePublish();
    const result = await startPublish({ id: 1 }, [{ slug: "a", name: "A" }]);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    // platformStatuses should NOT have been populated
    expect(Object.keys(platformStatuses.value)).toHaveLength(0);

    window.removeEventListener("omnipub:verify-session", handler);
    cleanupSession = autoApproveSession(); // restore for afterEach
  });
});
