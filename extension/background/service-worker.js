/**
 * Service Worker — 后台服务
 *
 * 职责：
 * 1. 管理用户 session（从后端获取，存 chrome.storage.local）
 * 2. 消息路由：转发 content-script ↔ popup 消息
 * 3. 上报发布结果（POST /api/articles/report-publish-result）
 * 4. 上报统计数据（PUT /api/ext/publications/:id/stats）
 *
 * 平台配置（编辑器选择器、登录态检查规则）现已硬编码在 extension/config/platforms.js，
 * 通过 importScripts 加载为 self.PLATFORM_CONFIGS。
 */
importScripts("../config/platforms.js");

// ============================================================
// 常量
// ============================================================

const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);

/** 后端 API 默认地址 — 通过前端 nginx 代理访问（Docker 不暴露 8000 端口） */
const DEFAULT_API_BASE = "http://localhost:3000";

/** 运行时缓存的 API_BASE（避免每次 fetch 都读 storage） */
let _apiBaseCache = null;

/**
 * 获取用户配置的后端 API 基础地址
 * @returns {Promise<string>}
 */
async function getApiBase() {
  if (_apiBaseCache) return _apiBaseCache;
  const result = await chrome.storage.local.get("omnipub_api_base");
  _apiBaseCache = result["omnipub_api_base"] || DEFAULT_API_BASE;
  return _apiBaseCache;
}

/**
 * 设置后端 API 基础地址
 * @param {string} url
 */
async function setApiBase(url) {
  const normalized = url.replace(/\/+$/, "");
  await chrome.storage.local.set({ omnipub_api_base: normalized });
  _apiBaseCache = normalized;
  // 根据新地址重新注册 content scripts
  await registerBridgeScripts(normalized);
}

// ============================================================
// 动态 Content Script 注册
// ============================================================

/** 静态 content_scripts 已覆盖的 origin（manifest.json 中声明） */
const STATIC_BRIDGE_ORIGINS = [
  "http://localhost/*",
  "https://localhost/*",
  "http://localhost:3000/*",
  "http://localhost:5173/*",
  "http://127.0.0.1/*",
  "http://127.0.0.1:3000/*",
  "http://127.0.0.1:5173/*",
];

/**
 * 根据用户配置的 API_BASE 动态注册 main-world-bridge 和 page-bridge content scripts。
 * 如果地址是 localhost/127.0.0.1（已被 manifest 静态覆盖），则仅清除旧的动态注册。
 * @param {string} apiBase - 用户配置的后端地址
 */
async function registerBridgeScripts(apiBase) {
  // 先清除之前的动态注册
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: ["omnipub-bridge-main", "omnipub-bridge-isolated"],
    });
  } catch {
    // 首次运行时没有已注册的脚本，忽略错误
  }

  // 构造 match pattern
  let origin;
  try {
    origin = new URL(apiBase).origin;
  } catch {
    return; // 无效 URL，不注册
  }

  const matchPattern = `${origin}/*`;

  // 如果已被 manifest 静态注册覆盖，无需动态注册
  if (STATIC_BRIDGE_ORIGINS.includes(matchPattern)) {
    return;
  }

  try {
    await chrome.scripting.registerContentScripts([
      {
        id: "omnipub-bridge-main",
        matches: [matchPattern],
        js: ["content-scripts/main-world-bridge.js"],
        world: "MAIN",
        runAt: "document_start",
      },
      {
        id: "omnipub-bridge-isolated",
        matches: [matchPattern],
        js: ["content-scripts/page-bridge.js"],
        runAt: "document_start",
      },
    ]);
    log(`[ServiceWorker] 已动态注册 bridge scripts: ${matchPattern}`);
  } catch (e) {
    console.warn("[ServiceWorker] 动态注册 bridge scripts 失败:", e.message);
  }
}

/** chrome.storage.local 的 key 前缀 */
const STORAGE_KEYS = {
  SESSION: "mp_session",
};

// ============================================================
// MAIN world 代码执行器（被 chrome.scripting.executeScript 序列化传入页面执行）
// ============================================================

/**
 * 在页面 MAIN world 中执行的函数。
 * 由 chrome.scripting.executeScript({ world: "MAIN", func: _mainWorldCodeRunner }) 调用。
 * 注意：此函数会被序列化，不能引用外部变量。
 *
 * @param {string} code - 要执行的操作代码
 * @param {object} args - 操作参数
 * @returns {string} 执行结果："ok" 表示成功
 */
/* eslint-disable no-undef -- This function runs in MAIN world via chrome.scripting.executeScript; browser globals (CKEDITOR, monaco, $, submitForm) only exist at runtime on target pages */
async function _mainWorldCodeRunner(code, args) {
  switch (code) {
    case "codemirror_setValue": {
      // 策略 1: CodeMirror 5 — .CodeMirror wrapper
      const cmHost = document.querySelector(".CodeMirror");
      if (cmHost && cmHost.CodeMirror) {
        cmHost.CodeMirror.setValue(args.content);
        return "ok";
      }
      // 策略 2: CodeMirror 6 — cm-editor view
      const cm6 = document.querySelector(".cm-editor");
      if (cm6 && cm6.cmView && cm6.cmView.view) {
        const view = cm6.cmView.view;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: args.content },
        });
        return "ok";
      }
      return "no_instance";
    }
    case "ckeditor_setData": {
      if (typeof CKEDITOR !== "undefined" && CKEDITOR.instances) {
        const keys = Object.keys(CKEDITOR.instances);
        if (keys.length > 0) {
          const instance = CKEDITOR.instances[keys[0]];
          return await new Promise((resolve) => {
            instance.setData(args.content, {
              callback: () => {
                instance.fire("change");
                resolve("ok");
              },
            });
            setTimeout(() => resolve("ok_timeout"), 5000);
          });
        }
      }
      return "no_instance";
    }
    case "monaco_setValue": {
      if (typeof monaco !== "undefined" && monaco.editor) {
        const models = monaco.editor.getModels();
        if (models.length > 0) {
          models[0].setValue(args.content);
          return "ok";
        }
      }
      return "no_instance";
    }
    case "csdn_installSaveInterceptor": {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__url = url;
        return origOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (this.__url && this.__url.includes("saveArticle")) {
          this.addEventListener("load", function () {
            let payload;
            try {
              const resp = JSON.parse(this.responseText);
              payload = { status: this.status, code: resp.code, msg: resp.msg || resp.message || "", articleId: resp.data?.url || resp.data?.id || resp.data?.article_id || null };
            } catch {
              payload = { status: this.status, code: -1, msg: (this.responseText || "").substring(0, 200), articleId: null };
            }
            window.postMessage({ type: "__csdn_save_result__", payload }, "*");
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
          });
          this.addEventListener("error", function () {
            window.postMessage({ type: "__csdn_save_result__", payload: { status: 0, code: -1, msg: "网络请求失败", articleId: null } }, "*");
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
          });
        }
        return origSend.call(this, body);
      };

      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input?.url;
        if (url && url.includes("saveArticle")) {
          return origFetch.call(this, input, init).then(async (resp) => {
            const clone = resp.clone();
            try {
              const json = await clone.json();
              window.postMessage({
                type: "__csdn_save_result__",
                payload: { status: resp.status, code: json.code, msg: json.msg || json.message || "", articleId: json.data?.url || json.data?.id || json.data?.article_id || null },
              }, "*");
            } catch {
              window.postMessage({
                type: "__csdn_save_result__",
                payload: { status: resp.status, code: -1, msg: "", articleId: null },
              }, "*");
            }
            window.fetch = origFetch;
            return resp;
          }).catch((err) => {
            window.postMessage({
              type: "__csdn_save_result__",
              payload: { status: 0, code: -1, msg: err.message || "网络请求失败" },
            }, "*");
            window.fetch = origFetch;
            throw err;
          });
        }
        return origFetch.call(this, input, init);
      };

      return "ok";
    }
    case "bilibili_installFetchInterceptor": {
      // Install fetch interceptor on the PARENT page to capture the publish
      // API response. The publish POST is made from the parent window, not
      // from the editor iframe, so this MUST run with targetParent: true.
      //
      // B站 2026-03+ API:
      //   新: /x/dynamic/feed/create/opus → { data: { dyn_rid } }
      //   旧: /x/article/creative/article/submit → { data: { aid } }
      const PUBLISH_URLS = [
        "/x/dynamic/feed/create/opus",
        "/x/article/creative/article/submit",
      ];
      const origFetch = window.fetch;
      window.__bilibiliOrigFetch = origFetch;
      window.__bilibiliCapturedUrl = null;

      window.fetch = async function (...fetchArgs) {
        const response = await origFetch.apply(this, fetchArgs);
        const url = typeof fetchArgs[0] === "string" ? fetchArgs[0] : fetchArgs[0]?.url;
        if (url && PUBLISH_URLS.some((u) => url.includes(u))) {
          const clone = response.clone();
          try {
            const json = await clone.json();
            if (json.code === 0) {
              const articleId = json.data?.dyn_rid || json.data?.aid;
              if (articleId) {
                window.__bilibiliCapturedUrl = "https://www.bilibili.com/read/cv" + articleId;
              }
            }
          } catch { /* ignore parse errors */ }
        }
        return response;
      };

      return "ok";
    }
    case "bilibili_checkFetchResult": {
      // Check if the fetch interceptor captured a publish URL.
      // args.cleanup: if true, restore original fetch and clean up globals.
      const url = window.__bilibiliCapturedUrl;
      if (args.cleanup && window.__bilibiliOrigFetch) {
        window.fetch = window.__bilibiliOrigFetch;
        delete window.__bilibiliOrigFetch;
        delete window.__bilibiliCapturedUrl;
      }
      return url ? "ok:" + url : "not_found";
    }
    case "51cto_installPublishInterceptor": {
      // Intercept POST /blogger/draft to capture the draft/article ID (`did`).
      // 51CTO uses the same endpoint for auto-save and publish; we intercept
      // the first response after this code is injected (right before #submitForm click).
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__url = url;
        this.__method = method;
        return origOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (this.__method === "POST" && this.__url && this.__url.includes("/blogger/draft")) {
          this.addEventListener("load", function () {
            let payload;
            try {
              const resp = JSON.parse(this.responseText);
              payload = { status: resp.status, did: resp.data && resp.data.did, raw: resp };
            } catch {
              payload = { status: -1, did: null, error: (this.responseText || "").substring(0, 200) };
            }
            window.postMessage({ type: "__51cto_publish_result__", payload }, "*");
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
          });
          this.addEventListener("error", function () {
            window.postMessage({ type: "__51cto_publish_result__", payload: { status: -1, did: null, error: "网络请求失败" } }, "*");
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
          });
        }
        return origSend.call(this, body);
      };

      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input?.url;
        const method = (init?.method || "GET").toUpperCase();
        if (method === "POST" && url && url.includes("/blogger/draft")) {
          return origFetch.call(this, input, init).then(async (resp) => {
            const clone = resp.clone();
            try {
              const json = await clone.json();
              window.postMessage({
                type: "__51cto_publish_result__",
                payload: { status: json.status, did: json.data && json.data.did, raw: json },
              }, "*");
            } catch {
              window.postMessage({
                type: "__51cto_publish_result__",
                payload: { status: -1, did: null, error: "" },
              }, "*");
            }
            window.fetch = origFetch;
            return resp;
          }).catch((err) => {
            window.postMessage({
              type: "__51cto_publish_result__",
              payload: { status: -1, did: null, error: err.message || "网络请求失败" },
            }, "*");
            window.fetch = origFetch;
            throw err;
          });
        }
        return origFetch.call(this, input, init);
      };

      return "ok";
    }
    case "51cto_setVueData": {
      const app = document.querySelector("#app");
      const vm = app && app.__vue__;
      if (!vm) return "no_vue_instance";
      // Step 1: Set DOM value FIRST — Vue watchers may call setForm() which
      // reads $(".title_input").val(), so the DOM value must already be present.
      const titleInput = document.querySelector(".title_input, #title");
      if (titleInput && args.title) {
        titleInput.value = args.title;
        // Also set via jQuery if available (51CTO uses jQuery extensively)
        if (typeof $ !== "undefined") $(".title_input").val(args.title);
      }
      // Step 2: Set submitForm BEFORE Vue data
      if (typeof submitForm !== "undefined") {
        if (args.title) submitForm.title = args.title;
        if (args.md_content) submitForm.content = args.md_content;
      }
      // Step 3: Set Vue reactive data (for editor display and validation)
      if (args.title) vm.$data.title = args.title;
      if (args.md_content) vm.$data.md_content = args.md_content;
      if (args.contents) vm.$data.contents = args.contents;
      // Step 4: Schedule a deferred override AFTER Vue watcher microtasks drain.
      // Vue 2 watchers fire asynchronously; setTimeout(0) runs after them.
      if (args.title) {
        const _title = args.title;
        setTimeout(() => {
          if (typeof submitForm !== "undefined") submitForm.title = _title;
          const ti = document.querySelector(".title_input, #title");
          if (ti) ti.value = _title;
          if (typeof $ !== "undefined") $(".title_input").val(_title);
        }, 0);
      }
      return "ok";
    }
    case "51cto_ensureSubmitFormTitle": {
      if (args.title) {
        if (typeof submitForm !== "undefined") submitForm.title = args.title;
        const app = document.querySelector("#app");
        const vm = app && app.__vue__;
        if (vm) vm.$data.title = args.title;
        const ti = document.querySelector(".title_input, #title");
        if (ti) {
          ti.value = args.title;
          if (typeof $ !== "undefined") $(".title_input").val(args.title);
        }
      }
      return "ok";
    }
    case "51cto_setSubmitFormFields": {
      if (typeof submitForm !== "undefined") {
        if (args.title) submitForm.title = args.title;
        if (args.content) submitForm.content = args.content;
      }
      if (args.title) {
        const titleInput = document.querySelector("input.ant-input.editor-title, input.editor-title, .title_input, #title");
        if (titleInput) {
          titleInput.value = args.title;
          if (typeof $ !== "undefined") {
            try { $(".title_input").val(args.title); } catch {}
            try { $("input.editor-title").val(args.title); } catch {}
          }
        }
        // Also sync to $VM.title.titleValue — 51CTO's submitForm() reads
        // title from this Vue component property, not from submitForm.title.
        if (typeof $VM !== "undefined" && $VM.title) {
          $VM.title.titleValue = args.title;
        }
      }
      return "ok";
    }
    case "51cto_directPublish": {
      if (typeof submitForm === "undefined") {
        return JSON.stringify({ status: -1, did: null, error: "submitForm not found" });
      }
      if (args.title) submitForm.title = args.title;
      if (args.content) submitForm.content = args.content;
      if (args.abstract) submitForm.abstract = args.abstract;
      if (args.tag) submitForm.tag = args.tag;
      if (args.cate_id) submitForm.cate_id = String(args.cate_id);

      // Sync title to Vue component (51CTO's own JS reads from $VM.title.titleValue)
      if (args.title && typeof $VM !== "undefined" && $VM.title) {
        $VM.title.titleValue = args.title;
      }

      // Force blog type to "博客" (1), not "动态" (0) — defensive override
      submitForm.blog_type = "1";

      const formData = new URLSearchParams();
      const fields = ["title", "content", "pid", "cate_id", "tag", "abstract",
        "banner_type", "img_urls", "blog_type", "copy_code", "is_hide",
        "is_old", "blog_id", "did", "work_id", "_csrf"];
      for (const key of fields) {
        let val = submitForm[key];
        if (val === undefined || val === null) val = "";
        if (Array.isArray(val)) val = JSON.stringify(val);
        formData.append(key, String(val));
      }
      if (!formData.get("cate_id")) {
        formData.set("cate_id", formData.get("pid") || "");
      }
      formData.append("check", "1");

      try {
        const resp = await fetch("/blogger/publish", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "same-origin",
          body: formData.toString(),
        });
        const json = await resp.json();
        const articleUrl = (json.data && json.data.request) || null;
        return JSON.stringify({ status: json.status, did: json.data && json.data.did, articleUrl, raw: json });
      } catch (err) {
        return JSON.stringify({ status: -1, did: null, error: err.message || "fetch failed" });
      }
    }
    case "tencent_searchTag": {
      // Simulate typing a keyword into a tag input in MAIN world.
      // args.inputIndex: which .cdc-tags-input__input to target (0=article tags, 1=keywords)
      // args.keyword: the search term to type
      //
      // In isolated world, nativeInputSetter references the isolated prototype,
      // which does NOT trigger Vue's reactivity. We must execute in MAIN world
      // where the page's own HTMLInputElement.prototype.value setter is used.
      console.log("[tencent_searchTag MAIN] START", JSON.stringify(args));
      const inputs = document.querySelectorAll(".cdc-tags-input__input");
      console.log("[tencent_searchTag MAIN] found inputs:", inputs.length);
      const input = inputs[args.inputIndex || 0];
      if (!input) { console.log("[tencent_searchTag MAIN] NO INPUT at index", args.inputIndex); return "no_input"; }

      const keyword = args.keyword || "";
      if (!keyword) return "no_keyword";

      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value"
      ).set;

      console.log("[tencent_searchTag MAIN] focusing input, keyword:", keyword);
      input.focus();
      input.click();

      // Clear existing value
      nativeSetter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(keyword);
      console.log("[tencent_searchTag MAIN] hasCJK:", hasCJK);

      if (hasCJK) {
        // IME composition simulation for CJK input
        input.dispatchEvent(new KeyboardEvent("keydown", { key: keyword[0], bubbles: true }));
        input.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }));

        for (let i = 0; i < keyword.length; i++) {
          const partial = keyword.substring(0, i + 1);
          nativeSetter.call(input, partial);
          input.dispatchEvent(new CompositionEvent("compositionupdate", { data: partial, bubbles: true }));
          input.dispatchEvent(new InputEvent("input", {
            data: partial, inputType: "insertCompositionText", isComposing: true, bubbles: true,
          }));
        }

        input.dispatchEvent(new CompositionEvent("compositionend", { data: keyword, bubbles: true }));
        input.dispatchEvent(new InputEvent("input", {
          data: keyword, inputType: "insertFromComposition", isComposing: false, bubbles: true,
        }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: keyword[0], bubbles: true }));
      } else {
        // Character-by-character InputEvent for non-CJK
        for (let i = 0; i < keyword.length; i++) {
          const char = keyword[i];
          const partial = keyword.substring(0, i + 1);
          input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
          nativeSetter.call(input, partial);
          input.dispatchEvent(new InputEvent("input", {
            data: char, inputType: "insertText", isComposing: false, bubbles: true,
          }));
          input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
        }
      }

      console.log("[tencent_searchTag MAIN] input.value after typing:", input.value);
      return "ok";
    }
    default:
      return "unknown_code:" + code;
  }
}
/* eslint-enable no-undef */

// ============================================================
// 通用请求方法
// ============================================================

/**
 * 发送带认证的 API 请求
 * @param {string} path - API 路径（不含 API_BASE）
 * @param {object} options - fetch 选项
 * @returns {Promise<object>} 解析后的 JSON
 */
async function apiRequest(path, options = {}) {
  const session = await getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (session) {
    headers["Authorization"] = `Bearer ${session}`;
  }

  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`API ${options.method || "GET"} ${path} failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

// ============================================================
// Session 管理
// ============================================================

/**
 * 获取保存的 session token
 * @returns {Promise<string|null>}
 */
async function getSession() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSION);
  return result[STORAGE_KEYS.SESSION] || null;
}

/**
 * 保存 session token
 * @param {string} sessionToken - JWT token
 */
async function saveSession(sessionToken) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: sessionToken,
  });
}

/**
 * 清除 session
 */
async function clearSession() {
  await chrome.storage.local.remove(STORAGE_KEYS.SESSION);
}

/**
 * 验证当前 session 是否有效
 * @returns {Promise<object|null>} 用户信息或 null
 */
async function verifySession() {
  try {
    const resp = await apiRequest("/api/ext/auth/me");
    return resp.data || null;
  } catch (e) {
    console.warn("[ServiceWorker] Session 验证失败:", e.message);
    return null;
  }
}

/**
 * Verify a platform login by calling its server-side API.
 * Returns true (logged in), false (definitively not logged in), or null
 * (network error / unknown — caller should fall back to cookie check).
 *
 * Config shape:
 *   { url, headers?, success_path?, success_value? }
 * - success_path: dot-path into JSON response (e.g. "success" or "data.userId").
 *   If omitted, only HTTP 2xx is required.
 * - success_value: expected value at success_path (default: truthy check).
 */
async function verifyLoginViaApi(verify, slug) {
  try {
    const resp = await fetch(verify.url, {
      credentials: "include",
      headers: { Accept: "application/json", ...(verify.headers || {}) },
    });
    if (!resp.ok) return false;
    if (!verify.success_path) return true;

    const json = await resp.json();
    const actual = verify.success_path
      .split(".")
      .reduce((acc, key) => (acc == null ? acc : acc[key]), json);
    if ("success_value" in verify) {
      return actual === verify.success_value;
    }
    return Boolean(actual);
  } catch (e) {
    console.warn(`[ServiceWorker] verify 请求失败 (${slug}):`, e.message);
    return null;
  }
}

// ============================================================
// 发布结果上报
// ============================================================

/**
 * 上报发布结果到后端
 * @param {object} data - { publication_id, platform_article_id?, article_url?, status }
 * @returns {Promise<object>}
 */
async function reportPublishResult(data) {
  return apiRequest("/api/articles/report-publish-result", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * 上报统计数据到后端
 * @param {number} publicationId - 发布记录 ID
 * @param {object} stats - { view_count, like_count, comment_count, collect_count }
 * @returns {Promise<object>}
 */
async function reportStats(publicationId, stats) {
  return apiRequest(`/api/ext/publications/${publicationId}/stats`, {
    method: "PUT",
    body: JSON.stringify(stats),
  });
}

// ============================================================
// 消息路由
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 所有消息处理都用异步函数包装
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[ServiceWorker] 消息处理错误:", error);
      sendResponse({ success: false, error: error.message });
    });

  // 返回 true 表示异步响应
  return true;
});

/**
 * 异步消息处理路由
 * @param {object} message - 消息对象
 * @param {object} sender - 发送者信息
 * @returns {Promise<object>} 响应结果
 */
async function handleMessage(message, sender) {
  if (!message || typeof message.action !== "string") {
    return { success: false, error: "invalid message: missing action" };
  }

  switch (message.action) {
    // ---- Session 相关 ----
    case "getSession": {
      const session = await getSession();
      return { success: true, data: session };
    }

    case "saveSession": {
      await saveSession(message.token);
      return { success: true };
    }

    case "clearSession": {
      await clearSession();
      return { success: true };
    }

    case "verifySession": {
      const user = await verifySession();
      return { success: !!user, data: user };
    }

    // ---- 发布结果上报 ----
    case "reportPublishResult": {
      const result = await reportPublishResult(message.data);
      return { success: true, data: result };
    }

    // ---- 统计上报 ----
    case "reportStats": {
      const statsResult = await reportStats(message.publicationId, message.stats);
      return { success: true, data: statsResult };
    }

    case "getApiBase": {
      const currentBase = await getApiBase();
      return { success: true, data: currentBase };
    }

    case "setApiBase": {
      await setApiBase(message.url);
      return { success: true };
    }

    // ---- 后台发布 ----
    case "startBackgroundPublish": {
      log(`startBackgroundPublish received: ${message.platforms?.length} platforms, frontendTab=${sender.tab?.id}`);
      startBackgroundPublish(message.article, message.platforms, sender.tab?.id, message.autoCloseTabs !== false);
      return { success: true };
    }

    case "publishProgress": {
      forwardProgressToFrontend(message.progress);
      return { success: true };
    }

    // ---- 登录状态检查（由 page-bridge 转发，在 SW 中执行以确保 cookie 可访问） ----
    case "checkLogin": {
      const platforms = message.platforms || [];

      // 健壮性：若 PLATFORM_CONFIGS 在 SW 重启后未加载，重新 importScripts
      // （MV3 service worker 偶发会丢失初始化时通过 importScripts 加载的全局变量）
      const _selfScope = typeof self !== "undefined" ? self : globalThis;
      let configs = (typeof PLATFORM_CONFIGS !== "undefined" && PLATFORM_CONFIGS) || _selfScope.PLATFORM_CONFIGS || globalThis.PLATFORM_CONFIGS;
      if (!configs || configs.length === 0) {
        try {
          importScripts(chrome.runtime.getURL("config/platforms.js"));
          configs = _selfScope.PLATFORM_CONFIGS || globalThis.PLATFORM_CONFIGS;
        } catch (e) {
          console.error("[ServiceWorker] importScripts(platforms.js) 失败:", e);
        }
      }
      if (!configs || configs.length === 0) {
        console.error("[ServiceWorker] PLATFORM_CONFIGS 不可用，无法执行 checkLogin");
        return {
          success: false,
          results: platforms.map((p) => ({ slug: p.slug, name: p.name, loggedIn: false })),
          error: "PLATFORM_CONFIGS unavailable",
        };
      }

      const results = await Promise.all(
        platforms.map(async (platform) => {
          const localConfig = configs.find((c) => c.slug === platform.slug);
          const loginCheck = (localConfig && localConfig.loginCheck) || {};
          const checkUrl = loginCheck.check_url;
          const loginCookie = loginCheck.login_cookie;
          const verify = loginCheck.verify;

          // 强一致：必须同时有 check_url 和 login_cookie 才能可靠判定。
          // 旧实现会 fallback 到 platform.new_article_url + "任意 cookie 即登录"，
          // 这会在 PLATFORM_CONFIGS 不可用或配置缺失时把所有平台误判为已登录。
          if (!checkUrl || !loginCookie) {
            console.warn(`[ServiceWorker] checkLogin: ${platform.slug} 缺少 check_url 或 login_cookie 配置`);
            return { slug: platform.slug, name: platform.name, loggedIn: false };
          }

          try {
            const cookies = await chrome.cookies.getAll({ url: checkUrl });
            let loggedIn = cookies.some((c) => c.name === loginCookie);

            // Optional server verify (defeats stale cookies). Network error
            // returns null and keeps the cookie-based result.
            if (loggedIn && verify && verify.url) {
              const verified = await verifyLoginViaApi(verify, platform.slug);
              if (verified === false) loggedIn = false;
            }

            return { slug: platform.slug, name: platform.name, loggedIn };
          } catch (e) {
            console.warn(`[ServiceWorker] cookie 获取失败 (${platform.slug}):`, e);
            return { slug: platform.slug, name: platform.name, loggedIn: false };
          }
        })
      );
      return { success: true, results };
    }

    case "executeInMainWorld": {
      const tabId = sender.tab?.id;
      if (!tabId) return { success: false, error: "no tab id" };

      const target = { tabId };
      // targetParent: true → execute in the top-level page (frameId=0),
      // even when the sender is an iframe content script.
      // MUST specify frameIds: [0] explicitly — omitting frameIds causes
      // chrome.scripting.executeScript to run in ALL frames, and results[0]
      // may come from an iframe instead of the main page.
      if (message.targetParent) {
        target.frameIds = [0];
      } else if (sender.frameId !== undefined && sender.frameId !== 0) {
        target.frameIds = [sender.frameId];
      }

      try {
        const results = await chrome.scripting.executeScript({
          target,
          world: "MAIN",
          func: _mainWorldCodeRunner,
          args: [message.code, message.args || {}],
        });
        const result = results?.[0]?.result;
        return { success: result === "ok", detail: result };
      } catch (e) {
        console.warn("[ServiceWorker] executeInMainWorld failed:", e.message);
        return { success: false, error: e.message };
      }
    }

    case "uploadImage": {
      // Service Worker fetch is not subject to CORS restrictions.
      // Used by juejin publisher to download external images and upload to juejin CDN.
      try {
        const imgResp = await fetch(message.imageUrl);
        if (!imgResp.ok) {
          return { success: false, error: `Download failed: HTTP ${imgResp.status}` };
        }
        const blob = await imgResp.blob();
        if (!blob.size) {
          return { success: false, error: "Downloaded image is empty" };
        }

        const formData = new FormData();
        const mimeType = (blob.type && blob.type.startsWith("image/"))
          ? blob.type
          : (message.mimeType || "image/jpeg");
        formData.append(
          "file",
          new File([blob], message.filename || "image.jpg", { type: mimeType })
        );

        const uploadResp = await fetch(message.uploadUrl, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!uploadResp.ok) {
          return { success: false, error: `Upload failed: HTTP ${uploadResp.status}` };
        }
        const result = await uploadResp.json();

        if (result.data?.url) {
          return { success: true, cdnUrl: result.data.url };
        }
        return { success: false, error: JSON.stringify(result) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    case "juejinApi": {
      try {
        const ALLOWED_JUEJIN_ENDPOINTS = [
          "/tag_api/v1/query_category_list",
          "/tag_api/v1/query_tag_list",
          "/content_api/v1/article_draft/create",
          "/content_api/v1/article/publish",
          "/content_api/v1/article_draft/delete",
        ];
        if (!ALLOWED_JUEJIN_ENDPOINTS.includes(message.endpoint)) {
          return { success: false, error: `Endpoint not allowed: ${message.endpoint}` };
        }
        const apiUrl = `https://api.juejin.cn${message.endpoint}`;
        const apiBody = message.body || {};
        console.log(`[juejinApi] POST ${apiUrl}`);

        let juejinTab = null;
        const tabs = await chrome.tabs.query({ url: "*://*.juejin.cn/*" });
        if (tabs.length > 0) {
          juejinTab = tabs[0];
        } else {
          juejinTab = await chrome.tabs.create({
            url: "https://juejin.cn",
            active: false,
          });
          await new Promise((resolve, reject) => {
            const listener = (tabId, info) => {
              if (tabId === juejinTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timeout);
                resolve();
              }
            };
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error("Juejin tab load timeout (30s)"));
            }, 30000);
            chrome.tabs.onUpdated.addListener(listener);
          });
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: juejinTab.id },
          world: "MAIN",
          func: async (url, body) => {
            try {
              const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
              });
              const text = await resp.text();
              if (!text) return { ok: false, error: `Empty response (HTTP ${resp.status})` };
              try {
                const json = JSON.parse(text);
                return { ok: true, status: resp.status, json };
              } catch {
                return { ok: false, error: `Non-JSON (HTTP ${resp.status}): ${text.substring(0, 300)}` };
              }
            } catch (e) {
              return { ok: false, error: e.message };
            }
          },
          args: [apiUrl, apiBody],
        });

        const result = results?.[0]?.result;
        if (!result) {
          return { success: false, error: "executeScript returned no result" };
        }
        if (!result.ok) {
          return { success: false, error: result.error };
        }
        const json = result.json;
        console.log(`[juejinApi] Response: HTTP ${result.status}, err_no=${json.err_no}`);
        if (json.err_no !== 0) {
          return { success: false, error: json.err_msg || JSON.stringify(json) };
        }
        return { success: true, data: json.data };
      } catch (e) {
        console.error(`[juejinApi] Error:`, e);
        return { success: false, error: e.message };
      }
    }

    case "zhihuApi": {
      try {
        const { method, endpoint, body } = message;
        const ALLOWED_ZHIHU_PATTERNS = [
          { method: "POST", pattern: /^\/api\/articles\/drafts$/ },
          { method: "PATCH", pattern: /^\/api\/articles\/\d+\/draft$/ },
          { method: "PUT", pattern: /^\/api\/articles\/\d+\/publish$/ },
          { method: "DELETE", pattern: /^\/api\/articles\/\d+$/ },
        ];
        const isAllowed = ALLOWED_ZHIHU_PATTERNS.some(
          (rule) => rule.method === method && rule.pattern.test(endpoint)
        );
        if (!isAllowed) {
          return { success: false, error: `Endpoint not allowed: ${method} ${endpoint}` };
        }
        const apiUrl = `https://zhuanlan.zhihu.com${endpoint}`;
        console.log(`[zhihuApi] ${method} ${apiUrl}`);

        let zhihuTab = null;
        const tabs = await chrome.tabs.query({ url: "*://*.zhihu.com/*" });
        if (tabs.length > 0) {
          zhihuTab = tabs[0];
        } else {
          zhihuTab = await chrome.tabs.create({
            url: "https://zhuanlan.zhihu.com/write",
            active: false,
          });
          await new Promise((resolve, reject) => {
            const listener = (tabId, info) => {
              if (tabId === zhihuTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timeout);
                resolve();
              }
            };
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error("Zhihu tab load timeout (30s)"));
            }, 30000);
            chrome.tabs.onUpdated.addListener(listener);
          });
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: zhihuTab.id },
          world: "MAIN",
          func: async (url, httpMethod, reqBody) => {
            try {
              const opts = {
                method: httpMethod,
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  "x-requested-with": "fetch",
                },
              };
              if (reqBody !== null && reqBody !== undefined) {
                opts.body = JSON.stringify(reqBody);
              }
              const resp = await fetch(url, opts);
              if (resp.status === 204) return { ok: true, status: 204, json: null };
              const text = await resp.text();
              if (!text) return { ok: resp.ok, status: resp.status, json: null };
              try {
                return { ok: resp.ok, status: resp.status, json: JSON.parse(text) };
              } catch {
                return { ok: false, error: `Non-JSON (HTTP ${resp.status}): ${text.substring(0, 300)}` };
              }
            } catch (e) {
              return { ok: false, error: e.message };
            }
          },
          args: [apiUrl, method, body],
        });

        const result = results?.[0]?.result;
        if (!result) {
          return { success: false, error: "executeScript returned no result" };
        }
        if (!result.ok) {
          return { success: false, error: result.error || `HTTP ${result.status}: ${JSON.stringify(result.json)}` };
        }
        console.log(`[zhihuApi] Response: HTTP ${result.status}`);
        return { success: true, data: result.json };
      } catch (e) {
        console.error(`[zhihuApi] Error:`, e);
        return { success: false, error: e.message };
      }
    }

    case "zhihuUploadImage": {
      try {
        const { imageUrl } = message;
        console.log(`[zhihuUploadImage] Uploading: ${imageUrl}`);

        let zhihuTab = null;
        const tabs = await chrome.tabs.query({ url: "*://*.zhihu.com/*" });
        if (tabs.length > 0) {
          zhihuTab = tabs[0];
        } else {
          return { success: false, error: "No zhihu tab available for image upload" };
        }

        const results = await chrome.scripting.executeScript({
          target: { tabId: zhihuTab.id },
          world: "MAIN",
          func: async (imgUrl) => {
            try {
              const resp = await fetch("https://zhuanlan.zhihu.com/api/uploaded_images", {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "x-requested-with": "fetch",
                },
                body: new URLSearchParams({ url: imgUrl, source: "article" }),
              });
              const data = await resp.json();
              if (data.src) return { ok: true, src: data.src };
              return { ok: false, error: JSON.stringify(data) };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          },
          args: [imageUrl],
        });

        const result = results?.[0]?.result;
        if (!result?.ok) {
          return { success: false, error: result?.error || "Upload failed" };
        }
        return { success: true, cdnUrl: result.src };
      } catch (e) {
        console.error(`[zhihuUploadImage] Error:`, e);
        return { success: false, error: e.message };
      }
    }

    default:
      return { success: false, error: `未知的消息类型: ${message.action}` };
  }
}

// ============================================================
// 后台发布
// ============================================================

/** 跟踪正在后台发布的 tab: tabId -> { platform, article, timeoutId, frontendTabId } */
const publishingTabs = new Map();


// ============================================================
// E-1: publishingTabs persistence across SW restarts
// ============================================================
// MV3 Service Workers are killed and restarted at any time.
// chrome.storage.session persists for the browser session (not across
// browser restarts) and is readable by the SW on wake-up.
// We mirror every publishingTabs mutation there so that if the SW
// is killed mid-publish and wakes up (e.g. when a monitored tab
// fires an onUpdated event), the in-memory Map is re-populated
// before the event handler runs.

const PUBLISHING_TABS_SESSION_KEY = "mp_publishing_tabs";

/** Write a single tabId entry to session storage. */
async function _ptSet(tabId, info) {
  // Store a serialisable snapshot (timeoutId / closeTimer are not serialisable)
  publishingTabs.set(tabId, info);
  const { [PUBLISHING_TABS_SESSION_KEY]: existing = {} } =
    await chrome.storage.session.get(PUBLISHING_TABS_SESSION_KEY);
  existing[String(tabId)] = {
    platform: info.platform,
    article: info.article,
    frontendTabId: info.frontendTabId,
    autoCloseTabs: info.autoCloseTabs,
    fillSent: info.fillSent || false,
    messageSentUrl: info.messageSentUrl || null,
    oschinaRedirected: info.oschinaRedirected || false,
    createdAt: info.createdAt || Date.now(),
  };
  await chrome.storage.session.set({ [PUBLISHING_TABS_SESSION_KEY]: existing });
}

/** Remove a single tabId entry from session storage. */
async function _ptDelete(tabId) {
  publishingTabs.delete(tabId);
  const { [PUBLISHING_TABS_SESSION_KEY]: existing = {} } =
    await chrome.storage.session.get(PUBLISHING_TABS_SESSION_KEY);
  delete existing[String(tabId)];
  await chrome.storage.session.set({ [PUBLISHING_TABS_SESSION_KEY]: existing });
}

/**
 * Restore publishingTabs from session storage on SW startup.
 * Called in onInstalled and onStartup so a restarted SW re-registers
 * the in-flight publish entries and re-arms their timeouts.
 */
async function _restorePublishingTabs() {
  try {
    const { [PUBLISHING_TABS_SESSION_KEY]: stored = {} } =
      await chrome.storage.session.get(PUBLISHING_TABS_SESSION_KEY);

    const toRemove = [];
    for (const [tabIdStr, info] of Object.entries(stored)) {
      const tabId = Number(tabIdStr);
      try {
        // Check tab still exists
        await chrome.tabs.get(tabId);
      } catch {
        // Tab is gone — clean up stale entry
        toRemove.push(tabIdStr);
        continue;
      }

      const elapsed = Date.now() - (info.createdAt || 0);
      const remaining = Math.max(0, 60000 - elapsed);
      if (remaining === 0) {
        // Already timed out while SW was dead — report failure
        toRemove.push(tabIdStr);
        if (info.platform?.publication_id) {
          reportPublishResult({
            publication_id: info.platform.publication_id,
            status: "failed",
          }).catch(e => console.warn("[SW] Failed to report timeout failure:", e.message));
        }
        try { if (info.autoCloseTabs) chrome.tabs.remove(tabId); } catch {}
        continue;
      }

      // Re-arm timeout with remaining TTL
      const timeoutId = setTimeout(async () => {
        if (publishingTabs.has(tabId)) {
          console.warn(`[ServiceWorker] 发布超时 (restored): ${info.platform?.slug}`);
          await _ptDelete(tabId);
          try { if (info.autoCloseTabs) chrome.tabs.remove(tabId); } catch {}
          if (info.platform?.publication_id) {
            reportPublishResult({
              publication_id: info.platform.publication_id,
              status: "failed",
            }).catch(e => console.warn("[SW] Failed to report retry-exhausted failure:", e.message));
          }
        }
      }, remaining);

      publishingTabs.set(tabId, { ...info, timeoutId, closeTimer: null });
      log(`[ServiceWorker] Restored publishing tab ${tabId} (${info.platform?.slug}), TTL=${remaining}ms`);
    }

    if (toRemove.length > 0) {
      const { [PUBLISHING_TABS_SESSION_KEY]: cur = {} } =
        await chrome.storage.session.get(PUBLISHING_TABS_SESSION_KEY);
      for (const k of toRemove) delete cur[k];
      await chrome.storage.session.set({ [PUBLISHING_TABS_SESSION_KEY]: cur });
    }
  } catch (e) {
    console.warn("[ServiceWorker] _restorePublishingTabs failed:", e.message);
  }
}

/** 最大并发发布数 */
const MAX_CONCURRENT_PUBLISH = 3;

/**
 * 启动后台发布流程
 * @param {object} article - 文章数据
 * @param {Array} platforms - 平台列表
 * @param {number|undefined} frontendTabId - 前端页面的 tabId，用于回传进度
 */
async function startBackgroundPublish(article, platforms, frontendTabId, autoCloseTabs) {
  log(`[ServiceWorker] 开始后台发布，共 ${platforms.length} 个平台, autoCloseTabs=${autoCloseTabs}`);

  // 并发控制：分批处理
  for (let i = 0; i < platforms.length; i += MAX_CONCURRENT_PUBLISH) {
    const batch = platforms.slice(i, i + MAX_CONCURRENT_PUBLISH);
    await Promise.all(
      batch.map((platform) =>
        openPublishTab(article, platform, frontendTabId, autoCloseTabs)
      )
    );
  }
}

async function createInfoqDraft() {
  try {
    // Use credentials: "include" instead of manual cookie construction.
    // MV3 service worker fetch with host_permissions automatically attaches cookies,
    // which is more reliable than chrome.cookies.getAll (can return empty in some cases).
    const resp = await fetch("https://xie.infoq.cn/api/v1/draft/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({}),
    });
    const json = await resp.json();
    if (json?.code !== 0) {
      console.warn("[ServiceWorker] InfoQ draft creation failed:", JSON.stringify(json));
      return null;
    }
    const draftId = json?.data?.id || json?.data?.draftId;
    log(`[ServiceWorker] InfoQ draft created: ${draftId}`);
    return draftId;
  } catch (e) {
    console.error("[ServiceWorker] InfoQ draft creation error:", e.message);
    return null;
  }
}

/**
 * 为单个平台打开后台 Tab 并发布
 */
async function openPublishTab(article, platform, frontendTabId, autoCloseTabs) {
  let url = platform.new_article_url;
  log(`openPublishTab: ${platform.slug}, url=${url}, autoClose=${autoCloseTabs}`);
  if (!url) {
    console.warn(`[ServiceWorker] 平台 ${platform.slug} 无 new_article_url`);
    sendProgressToFrontend(frontendTabId, {
      platform: platform.slug,
      platformName: platform.name,
      status: "failed",
      message: "平台未配置编辑器地址",
    });
    return;
  }

  if (platform.slug === "infoq") {
    sendProgressToFrontend(frontendTabId, {
      platform: platform.slug,
      platformName: platform.name,
      status: "pending",
      message: "正在创建草稿...",
    });
    const draftId = await createInfoqDraft();
    if (draftId) {
      url = `https://xie.infoq.cn/draft/${draftId}`;
    } else {
      sendProgressToFrontend(frontendTabId, {
        platform: platform.slug,
        platformName: platform.name,
        status: "failed",
        message: "创建草稿失败，请确认已登录 InfoQ",
      });
      if (platform.publication_id) {
        reportPublishResult({
          publication_id: platform.publication_id,
          status: "failed",
        }).catch(e => console.warn("[SW] Failed to report publish failure:", e.message));
      }
      return;
    }
  }

  sendProgressToFrontend(frontendTabId, {
    platform: platform.slug,
    platformName: platform.name,
    status: "pending",
    message: "等待打开编辑器...",
  });

  const tab = await chrome.tabs.create({ url, active: false });
  log(`Tab created: id=${tab.id}, url=${url}, platform=${platform.slug}`);

  // 设置超时：复杂平台（iframe / API 代理）使用更长超时
  const SLOW_PUBLISH_PLATFORMS = ["bilibili", "zhihu", "toutiao", "oschina", "infoq"];
  const publishTimeout = SLOW_PUBLISH_PLATFORMS.includes(platform.slug) ? 120000 : 60000;
  const timeoutId = setTimeout(async () => {
    if (publishingTabs.has(tab.id)) {
      console.warn(`[ServiceWorker] 发布超时: ${platform.slug} (${publishTimeout / 1000}s)`);
      publishingTabs.delete(tab.id);
      sendProgressToFrontend(frontendTabId, {
        platform: platform.slug,
        platformName: platform.name,
        status: "failed",
        message: `发布超时（${publishTimeout / 1000}秒）`,
      });
      try { if (autoCloseTabs) await chrome.tabs.remove(tab.id); } catch {}

      if (platform.publication_id) {
        reportPublishResult({
          publication_id: platform.publication_id,
          status: "failed",
        }).catch((err) => {
          console.error(`[ServiceWorker] 超时上报失败 (${platform.slug}):`, err.message);
        });
      }
    }
  }, publishTimeout);

  await _ptSet(tab.id, { platform, article, frontendTabId, timeoutId, messageSentUrl: null, autoCloseTabs, fillSent: false, createdAt: Date.now() });
}

/**
 * 监听 tab 加载完成，注入发布消息
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!publishingTabs.has(tabId)) return;
  const tabInfo = publishingTabs.get(tabId);
  log(`onUpdated: tabId=${tabId}, platform=${tabInfo.platform.slug}, url=${tab?.url?.slice(0, 80)}`);

  const currentUrl = tab?.url || "";

  let isRedirect = false;
  if (tabInfo.messageSentUrl) {
    if (currentUrl === tabInfo.messageSentUrl) return;
    log(`[ServiceWorker] Tab ${tabId} URL 变化 (${tabInfo.messageSentUrl} → ${currentUrl})，允许重发消息`);
    isRedirect = true;
  }

  const targetUrl = tabInfo.platform.new_article_url || "";
  if (targetUrl && currentUrl) {
    try {
      const targetOrigin = new URL(targetUrl).origin;
      if (!currentUrl.startsWith(targetOrigin)) {
        log(`[ServiceWorker] Tab ${tabId} URL (${currentUrl}) 不匹配目标 (${targetOrigin})，等待重定向...`);
        return;
      }
    } catch {
      // URL 解析失败，继续执行
    }
  }

  // OSChina 特殊处理：/blog/write 可能被重定向到 /u/{uid}/ 或 /
  // 需要检测这种重定向并导航到正确的编辑器 URL
  if (tabInfo.platform.slug === "oschina" && currentUrl && !tabInfo.oschinaRedirected) {
    // 宽松匹配：/u/{uid} 后面可以跟任意内容（查询参数、额外路径等）
    const uidMatch = currentUrl.match(/^https:\/\/my\.oschina\.net\/u\/(\d+)/);
    const isEditorUrl = currentUrl.includes("/blog/write");
    const homepageMatch = currentUrl.match(/^https:\/\/my\.oschina\.net\/?(\?.*)?$/);

    if (uidMatch && !isEditorUrl) {
      // Pattern 1: 重定向到了 /u/{uid}/... 但不是编辑器页面
      const uid = uidMatch[1];
      const correctUrl = `https://my.oschina.net/u/${uid}/blog/write`;
      log(`[ServiceWorker] OSChina 重定向到用户主页，导航到编辑器: ${correctUrl}`);
      tabInfo.oschinaRedirected = true;
      tabInfo.messageSentUrl = null;
      chrome.tabs.update(tabId, { url: correctUrl });
      return;
    } else if (homepageMatch) {
      log(`[ServiceWorker] OSChina 在首页，主动提取用户 ID...`);
      tabInfo.oschinaRedirected = true;

      const extractOschinaUid = async () => {
        // Poll tab URL: JS redirect from / → /u/{uid}/ doesn't trigger onUpdated
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const [result] = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => window.location.href,
            });
            const href = result?.result || "";
            const pollMatch = href.match(/\/u\/(\d+)/);
            if (pollMatch) {
              log(`[ServiceWorker] OSChina UID from URL poll: ${pollMatch[1]}`);
              return pollMatch[1];
            }
            log(`[ServiceWorker] OSChina URL poll ${i + 1}/10: ${href}`);
          } catch (e) {
            log(`[ServiceWorker] OSChina URL poll ${i + 1}/10 failed: ${e.message}`);
          }
        }
        return null;
      };

      const uid = await extractOschinaUid();
      if (uid) {
        const correctUrl = `https://my.oschina.net/u/${uid}/blog/write`;
        log(`[ServiceWorker] OSChina navigating to editor: ${correctUrl}`);
        tabInfo.messageSentUrl = null;
        chrome.tabs.update(tabId, { url: correctUrl });
      } else {
        log(`[ServiceWorker] OSChina 无法提取用户 ID，报告失败`);
        sendProgressToFrontend(tabInfo.frontendTabId, {
          platform: tabInfo.platform.slug,
          platformName: tabInfo.platform.name,
          status: "failed",
          message: "无法获取 OSCHINA 用户 ID，请确认已登录",
        });
        if (tabInfo.platform.publication_id) {
          reportPublishResult({ publication_id: tabInfo.platform.publication_id, status: "failed" }).catch(e => console.warn("[SW] Failed to report tab-closed failure:", e.message));
        }
        _ptDelete(tabId);
        clearTimeout(tabInfo.timeoutId);
        try { if (tabInfo.autoCloseTabs) chrome.tabs.remove(tabId); } catch {}
      }
      return;
    }
  }

  // 如果 FILL_AND_PUBLISH 已经成功发送过，忽略后续的 URL 变化
  // （发布操作可能导致页面导航，不应重新触发填充流程）
  if (tabInfo.fillSent) {
    log(`[ServiceWorker] Tab ${tabId} FILL_AND_PUBLISH 已发送（${tabInfo.platform.slug}），忽略后续 URL 变化: ${currentUrl}`);
    return;
  }

  tabInfo.messageSentUrl = currentUrl;

  const { platform, article, frontendTabId } = tabInfo;
  log(`[ServiceWorker] Tab ${tabId} 已加载（${platform.slug}），发送填充消息`);

  sendProgressToFrontend(frontendTabId, {
    platform: platform.slug,
    platformName: platform.name,
    status: "filling",
    message: "正在填充内容...",
  });

  const slowPlatforms = ["tencent-cloud", "infoq", "bilibili", "toutiao", "oschina", "juejin"];
  const isSlow = slowPlatforms.includes(platform.slug);
  const initialDelay = isRedirect ? 2000 : (isSlow ? 1500 : 500);
  await new Promise((r) => setTimeout(r, initialDelay));

  const maxAttempts = isSlow ? 5 : 3;
  let sent = false;

  // Bilibili: editor lives in a york/read-editor iframe, not the main frame.
  // chrome.tabs.sendMessage without frameId only reaches the top frame,
  // so we must resolve the iframe's frameId via webNavigation API.
  let bilibiliFrameId = undefined;
  if (platform.slug === "bilibili") {
    for (let fAttempt = 0; fAttempt < 10 && bilibiliFrameId === undefined; fAttempt++) {
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        const editorFrame = frames?.find((f) => f.url.includes("york/read-editor"));
        if (editorFrame) {
          bilibiliFrameId = editorFrame.frameId;
          log(`[ServiceWorker] Bilibili iframe found: frameId=${bilibiliFrameId}`);
        } else {
          log(`[ServiceWorker] Bilibili iframe not yet loaded (attempt ${fAttempt + 1}/10), waiting 2s...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e) {
        console.warn(`[ServiceWorker] webNavigation.getAllFrames failed:`, e.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (bilibiliFrameId === undefined) {
      console.error(`[ServiceWorker] Bilibili iframe (york/read-editor) not found after 10 attempts`);
    }
  }

  const sendOptions = bilibiliFrameId !== undefined ? { frameId: bilibiliFrameId } : undefined;

  for (let attempt = 0; attempt < maxAttempts && !sent; attempt++) {
    // 在每次重试前检查 tab 是否仍在跟踪中（可能已被 forwardProgressToFrontend 移除）
    if (!publishingTabs.has(tabId)) {
      log(`[ServiceWorker] Tab ${tabId} 已被移除（${platform.slug}），停止重试`);
      return;
    }
    try {
      const msg = {
        action: "FILL_AND_PUBLISH",
        article,
        platform: platform.slug,
        publicationId: platform.publication_id || null,
        publishConfig: platform.publish_config || {},
      };
      log(`FILL_AND_PUBLISH attempt ${attempt+1}/${maxAttempts} to ${platform.slug}, tabId=${tabId}`);
      if (sendOptions) {
        await chrome.tabs.sendMessage(tabId, msg, sendOptions);
      } else {
        await chrome.tabs.sendMessage(tabId, msg);
      }
      log(`[ServiceWorker] Sent FILL_AND_PUBLISH to ${platform.slug}${sendOptions ? ` (frameId=${sendOptions.frameId})` : ""}`);
      sent = true;
      tabInfo.fillSent = true;
      _ptSet(tabId, tabInfo).catch(() => {}); // E-1: persist fillSent
    } catch (e) {
      log(`sendMessage failed (${platform.slug}, attempt ${attempt+1}): ${e.message}`);
      if (attempt < maxAttempts - 1) {
        const baseDelay = isSlow ? 3000 : 2500;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  if (!sent) {
    // 再次检查：可能在重试期间已经成功（通过其他路径）
    if (!publishingTabs.has(tabId)) {
      log(`[ServiceWorker] Tab ${tabId} 已在重试期间被移除（${platform.slug}），跳过失败报告`);
      return;
    }
    console.error(`[ServiceWorker] 所有重试均失败 (${platform.slug})`);
    sendProgressToFrontend(frontendTabId, {
      platform: platform.slug,
      platformName: platform.name,
      status: "failed",
      message: "无法连接到内容脚本",
    });
    clearTimeout(tabInfo.timeoutId);
    _ptDelete(tabId);
    try { if (tabInfo.autoCloseTabs) await chrome.tabs.remove(tabId); } catch {}

    if (platform.publication_id) {
      reportPublishResult({
        publication_id: platform.publication_id,
        status: "failed",
      }).catch((err) => {
        console.error(`[ServiceWorker] 重试失败上报失败 (${platform.slug}):`, err.message);
      });
    }
  }
});

/**
 * Tab 关闭时清理
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (publishingTabs.has(tabId)) {
    const { timeoutId } = publishingTabs.get(tabId);
    clearTimeout(timeoutId);
    _ptDelete(tabId);
  }
});

/**
 * 收到 content script 进度回报，转发给前端
 * @param {object} progress
 */
const SUCCESS_TAB_CLOSE_DELAY = 3000;

function forwardProgressToFrontend(progress) {
  // E-2: Match by platform.slug. With the B-1 unique constraint on
  // (article_id, platform_id) it is impossible to have two concurrent
  // publishes to the same platform for the same article, so slug-match
  // is unambiguous within a single publish session.
  for (const [tabId, info] of publishingTabs.entries()) {
    if (info.platform.slug === progress.platform) {
      sendProgressToFrontend(info.frontendTabId, progress);
      if (progress.status === "success" || progress.status === "failed") {
        clearTimeout(info.timeoutId);

        if (progress.status === "failed" || progress.article_url) {
          if (info.closeTimer) clearTimeout(info.closeTimer);
          _ptDelete(tabId);
          try { if (info.autoCloseTabs) chrome.tabs.remove(tabId); } catch {}
          _reportAndLog(info, progress);
        } else {
          // Delay tab closure to let SuccessDetector capture article_url
          info.pendingSuccess = progress;
          info.closeTimer = setTimeout(() => {
            _ptDelete(tabId);
            try { if (info.autoCloseTabs) chrome.tabs.remove(tabId); } catch {}
            _reportAndLog(info, info.pendingSuccess);
          }, SUCCESS_TAB_CLOSE_DELAY);
        }
      }
      break;
    }
  }
}

function _reportAndLog(info, progress) {
  // E-3: Prevent double-reporting if both the timeout and the success path race.
  if (info._reported) {
    log(`[ServiceWorker] _reportAndLog: already reported for ${info.platform?.slug}, skipping`);
    return;
  }
  info._reported = true;
  const pubId = info.platform.publication_id;
  if (pubId) {
    const backendStatus = progress.status === "success" ? "published" : "failed";
    reportPublishResult({
      publication_id: pubId,
      status: backendStatus,
      article_url: progress.article_url || null,
    }).then(() => {
      log(`[ServiceWorker] 已上报发布结果: ${info.platform.slug} → ${backendStatus}`);
    }).catch((err) => {
      console.error(`[ServiceWorker] 上报发布结果失败 (${info.platform.slug}):`, err.message);
    });
  } else {
    console.warn(`[ServiceWorker] 无 publication_id，跳过上报: ${info.platform.slug}`);
  }
}

/**
 * 向前端 tab 派发进度事件
 * @param {number|undefined} frontendTabId
 * @param {object} progress
 */
async function sendProgressToFrontend(frontendTabId, progress) {
  if (!frontendTabId) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(frontendTabId, {
      action: "PUBLISH_PROGRESS",
      progress,
    });
  } catch {
    // 前端可能已关闭，忽略
  }
}

// ============================================================
// 生命周期事件
// ============================================================

/**
 * 扩展安装/更新时初始化
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  log("[ServiceWorker] 扩展已安装/更新:", details.reason);

  const apiBase = await getApiBase();
  await registerBridgeScripts(apiBase);

  await _restorePublishingTabs();
});

/**
 * 浏览器启动时恢复未完成的发布
 */
chrome.runtime.onStartup.addListener(async () => {
  log("[ServiceWorker] 浏览器启动");

  const apiBase = await getApiBase();
  await registerBridgeScripts(apiBase);

  await _restorePublishingTabs();
});

/**
 * 响应外部网页的 ping 请求（用于检测扩展是否安装）
 * 网页通过 chrome.runtime.sendMessage(EXT_ID, { type: "OMNIPUB_PING" }) 调用
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const staticOrigins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ];
  const senderOrigin = sender.origin || sender.url?.replace(/\/[^/]*$/, "") || "";

  getApiBase().then((apiBase) => {
    let customOrigin;
    try { customOrigin = new URL(apiBase).origin; } catch { customOrigin = null; }
    const allowedOrigins = customOrigin
      ? [...staticOrigins, customOrigin]
      : staticOrigins;

    if (!allowedOrigins.some((o) => senderOrigin.startsWith(o))) {
      sendResponse({ error: "origin not allowed" });
      return;
    }

    if (message?.type === "OMNIPUB_PING") {
      const manifest = chrome.runtime.getManifest();
      sendResponse({ installed: true, version: manifest.version });
      return;
    }

    sendResponse({ error: "unknown message type" });
  });
  return true;
});
