import { ref, onUnmounted } from "vue";

/**
 * 发布逻辑：通过 CustomEvent 与 Chrome 扩展通信，后台静默发布。
 *
 * 发布流程：
 * 1. 派发 omnipub:start-publish 事件，由 page-bridge.js 转发给 service worker
 * 2. service worker 在后台 Tab 中填充内容并自动点击发布
 * 3. 监听 omnipub:publish-progress 事件接收每个平台的进度更新
 *
 * 向前兼容：保留 publishToPlatform（window.open 方式）作为 fallback。
 */

/** Shared session storage key for progress state (F-1: survive tab refresh). */
const PROGRESS_SESSION_KEY = "omnipub_publish_progress";

export function usePublish() {
  /** 各平台发布状态，key 为 platformSlug */
  const platformStatuses = ref({});

  // F-2: Use a session-scoped handler key so multiple component instances
  // (or hot-reload) don't accumulate duplicate listeners.
  // Each composable instance gets a unique id; only the most-recently registered
  // handler for a given session will process events.
  const _instanceId = Math.random().toString(36).slice(2);
  let _sessionId = null;  // set during startPublish()
  let progressHandler = null;

  /**
   * F-1: Load progress state persisted in sessionStorage (survives page refresh).
   * Call this on component mount to re-hydrate in-progress publish UI.
   */
  function loadPersistedProgress() {
    try {
      const raw = sessionStorage.getItem(PROGRESS_SESSION_KEY);
      if (!raw) return false;
      const { sessionId, statuses, expiresAt } = JSON.parse(raw);
      if (!statuses || Date.now() > expiresAt) {
        sessionStorage.removeItem(PROGRESS_SESSION_KEY);
        return false;
      }
      _sessionId = sessionId;
      platformStatuses.value = statuses;
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * F-1: Persist current progress to sessionStorage.
   * Expires after 10 minutes to avoid stale state showing forever.
   */
  function _persistProgress() {
    try {
      sessionStorage.setItem(
        PROGRESS_SESSION_KEY,
        JSON.stringify({
          sessionId: _sessionId,
          statuses: platformStatuses.value,
          expiresAt: Date.now() + 10 * 60 * 1000,
        })
      );
    } catch (_) { /* quota exceeded — non-fatal */ }
  }

  /**
   * Clear persisted progress (call when all platforms are terminal).
   */
  function _clearPersistedProgress() {
    try { sessionStorage.removeItem(PROGRESS_SESSION_KEY); } catch (_) {}
  }

  /**
   * F-1: Re-attach the progress listener after a tab refresh.
   * Call this if loadPersistedProgress() returned true.
   */
  function resumeListening(onProgress) {
    _registerProgressHandler(onProgress);
  }

  /**
   * Internal: register the omnipub:publish-progress window event listener.
   * F-2: Guards against duplicate listeners by removing any previous handler first.
   */
  function _registerProgressHandler(onProgress) {
    if (progressHandler) {
      window.removeEventListener("omnipub:publish-progress", progressHandler);
    }

    progressHandler = (event) => {
      const progress = event.detail;
      if (!progress || !progress.platform) return;

      // F-2: Ignore events from other sessions (e.g. a second tab that also
      // has Omnipub open).  sessionId is embedded in every progress event by
      // page-bridge.js (see main-world-bridge changes for that side).
      // Until page-bridge propagates sessionId, we accept all events.
      // (When sessionId is added to events, uncomment the guard below.)
      // if (progress.sessionId && progress.sessionId !== _sessionId) return;

      platformStatuses.value[progress.platform] = {
        platformSlug: progress.platform,
        platformName:
          progress.platformName ||
          platformStatuses.value[progress.platform]?.platformName ||
          progress.platform,
        status: progress.status,
        message: progress.message || "",
        article_url: progress.article_url || null,
      };

      _persistProgress(); // F-1: keep sessionStorage in sync

      // Clear persisted state once all platforms reach a terminal status
      const statuses = Object.values(platformStatuses.value).map((s) => s.status);
      const allDone = statuses.length > 0 && statuses.every((s) => s === "success" || s === "failed");
      if (allDone) _clearPersistedProgress();

      if (onProgress) {
        onProgress(progress);
      }
    };
    window.addEventListener("omnipub:publish-progress", progressHandler);
  }

  /**
   * Verify extension session is valid before publishing.
   * If invalid, attempts to re-sync the current localStorage token.
   * Returns { valid, resynced, error? }.
   */
  function verifyExtensionSession(timeout = 5000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener("omnipub:verify-session-result", handler);
        resolve({ valid: false, resynced: false, error: "timeout" });
      }, timeout);

      function handler(event) {
        clearTimeout(timer);
        window.removeEventListener("omnipub:verify-session-result", handler);
        resolve(event.detail || { valid: false });
      }

      window.addEventListener("omnipub:verify-session-result", handler);

      const token = localStorage.getItem("token") || "";
      window.dispatchEvent(
        new CustomEvent("omnipub:verify-session", { detail: { token } })
      );
    });
  }

  /**
   * 启动后台发布
   * @param {object} article - 文章对象（含 id, title, markdown_content, html_content）
   * @param {Array} platforms - 平台列表（含 slug, name, new_article_url）
   * @param {boolean} [autoCloseTabs=true] - 发布后是否自动关闭标签页
   * @param {Function} [onProgress] - 进度回调 (progress) => void
   * @param {object} [platformConfigs] - 各平台预配置 (slug → publish_config dict)
   * @param {object} [publicationIds] - 各平台 publication_id (slug → id)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function startPublish(article, platforms, autoCloseTabs = true, onProgress, platformConfigs = {}, publicationIds = {}) {
    const session = await verifyExtensionSession();
    if (!session.valid) {
      return { ok: false, error: session.resynced
        ? "扩展 session 同步失败，请重新登录后再试"
        : "扩展未登录，请刷新页面或重新登录后再试" };
    }
    // Generate a new session id for this publish run
    _sessionId = `pub_${Date.now()}_${_instanceId}`;

    // 重置状态
    platformStatuses.value = {};
    for (const p of platforms) {
      platformStatuses.value[p.slug] = {
        platformSlug: p.slug,
        platformName: p.name,
        status: "pending",
        message: "等待发布...",
      };
    }
    _persistProgress(); // F-1: persist initial state

    // F-2: Register/replace progress listener (removes any previous one)
    _registerProgressHandler(onProgress);

    // 发起后台发布
    const platformsWithConfig = platforms.map((p) => ({
      ...p,
      publish_config: platformConfigs[p.slug] || {},
      publication_id: publicationIds[p.slug] || null,
    }));
    // F-5: Do NOT include authToken in CustomEvent detail.
    // CustomEvent.detail is accessible to ALL MAIN-world scripts (including
    // third-party JS on the same localhost page).  The service worker already
    // holds the JWT (saved by handleSetToken on login); page-bridge.js will
    // retrieve it via chrome.runtime.sendMessage({ action: "getSession" })
    // inside its isolated world — invisible to page JS.
    window.dispatchEvent(
      new CustomEvent("omnipub:start-publish", {
        detail: { article, platforms: platformsWithConfig, autoCloseTabs, sessionId: _sessionId },
      })
    );

    return { ok: true };
  }

  /**
   * 停止监听进度
   */
  function stopListening() {
    if (progressHandler) {
      window.removeEventListener("omnipub:publish-progress", progressHandler);
      progressHandler = null;
    }
  }


  onUnmounted(() => {
    stopListening();
  });

  return {
    startPublish,
    platformStatuses,
    stopListening,
    loadPersistedProgress,
    resumeListening,
  };
}
