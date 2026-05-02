/**
 * page-bridge.js — Content script (isolated world) on localhost pages.
 *
 * Receives messages from main-world-bridge.js via window.postMessage,
 * then forwards to service worker via chrome.runtime.sendMessage.
 * Dispatches results back to the page via CustomEvent (works cross-world).
 */

const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

function announceReady() {
  const manifest = chrome.runtime.getManifest();
  window.dispatchEvent(
    new CustomEvent("omnipub:ready", {
      detail: { version: manifest.version },
    })
  );
}

announceReady();
setTimeout(announceReady, 500);

// Route incoming postMessage from main-world-bridge.js
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "__omnipub_bridge__") return;

  const { eventName, detail } = event.data;

  switch (eventName) {
    case "omnipub:ping":
      announceReady();
      break;

    case "omnipub:start-publish":
      await handleStartPublish(detail);
      break;

    case "omnipub:check-login":
      await handleCheckLogin(detail);
      break;

    case "omnipub:set-token":
      handleSetToken(detail);
      break;

    case "omnipub:verify-session":
      await handleVerifySession(detail);
      break;
  }
});

async function handleStartPublish(detail) {
  const { article, platforms, autoCloseTabs } = detail || {};
  if (!article || !platforms) return;

  log(`[page-bridge] 收到 start-publish，${platforms.length} 个平台，autoCloseTabs=${autoCloseTabs}`);

  // F-5: Do NOT read authToken from the CustomEvent detail — it was removed
  // from the event to prevent third-party MAIN-world scripts from reading the
  // JWT.  Instead, verify the SW already has a valid session.  If not, the SW
  // will gracefully fail individual reportPublishResult calls rather than
  // silently send a leaked token.
  //
  // The token is kept alive in chrome.storage.local by handleSetToken()
  // (called on login via omnipub:set-token), which runs in the isolated world
  // and is never accessible to page JS.

  try {
    const response = await chrome.runtime.sendMessage({
      action: "startBackgroundPublish",
      article,
      platforms,
      autoCloseTabs: autoCloseTabs !== false,
    });
    log("[page-bridge] SW 响应:", response);
  } catch (e) {
    console.error("[page-bridge] 发送消息给 SW 失败:", e);
    for (const p of platforms) {
      window.dispatchEvent(
        new CustomEvent("omnipub:publish-progress", {
          detail: {
            platform: p.slug,
            platformName: p.name,
            status: "failed",
            message: "扩展通信失败: " + (e.message || String(e)),
          },
        })
      );
    }
  }
}

async function handleCheckLogin(detail) {
  const platforms = detail?.platforms || [];

  try {
    const response = await chrome.runtime.sendMessage({
      action: "checkLogin",
      platforms,
    });
    const results = response?.results || [];
    window.dispatchEvent(
      new CustomEvent("omnipub:check-login-result", {
        detail: { results },
      })
    );
  } catch (e) {
    console.error("[page-bridge] checkLogin 转发失败:", e);
    window.dispatchEvent(
      new CustomEvent("omnipub:check-login-result", {
        detail: { results: platforms.map((p) => ({ slug: p.slug, name: p.name, loggedIn: false })) },
      })
    );
  }
}

function handleSetToken(detail) {
  const token = detail?.token || null;
  chrome.runtime.sendMessage({ action: "saveSession", token });
}

async function handleVerifySession(detail) {
  try {
    const response = await chrome.runtime.sendMessage({ action: "verifySession" });
    const valid = !!(response?.success && response?.data);

    if (!valid && detail?.token) {
      await chrome.runtime.sendMessage({ action: "saveSession", token: detail.token });
      const retry = await chrome.runtime.sendMessage({ action: "verifySession" });
      window.dispatchEvent(
        new CustomEvent("omnipub:verify-session-result", {
          detail: { valid: !!(retry?.success && retry?.data), resynced: true },
        })
      );
      return;
    }

    window.dispatchEvent(
      new CustomEvent("omnipub:verify-session-result", {
        detail: { valid, resynced: false },
      })
    );
  } catch (e) {
    console.error("[page-bridge] verifySession failed:", e);
    window.dispatchEvent(
      new CustomEvent("omnipub:verify-session-result", {
        detail: { valid: false, resynced: false, error: e.message },
      })
    );
  }
}


// Forward publish progress from service worker back to the page
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "PUBLISH_PROGRESS" && message.progress) {
    window.dispatchEvent(
      new CustomEvent("omnipub:publish-progress", {
        detail: message.progress,
      })
    );
  }
});
