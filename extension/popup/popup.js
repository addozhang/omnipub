/**
 * popup.js — 弹窗逻辑
 *
 * 职责：
 * 1. 显示登录状态，支持输入 session token 登录
 * 2. 显示当前页面匹配的平台
 * 3. 提供 "前往写文章" 快捷链接
 * 4. 显示已配置的平台列表及配置状态
 * 5. 显示版本号
 */

(function () {
  "use strict";

  // ============================================================
  // DOM 元素引用
  // ============================================================

  const $loginSection = document.getElementById("login-section");
  const $mainSection = document.getElementById("main-section");
  const $sessionInput = document.getElementById("session-input");
  const $loginBtn = document.getElementById("login-btn");
  const $loginError = document.getElementById("login-error");
  const $userName = document.getElementById("user-name");
  const $logoutBtn = document.getElementById("logout-btn");
  const $platformMatch = document.getElementById("platform-match");
  const $matchedPlatform = document.getElementById("matched-platform");
  const $gotoWrite = document.getElementById("goto-write");
  const $platformList = document.getElementById("platform-list");
  const $configCount = document.getElementById("config-count");
  const $version = document.getElementById("version");
  const $apiBaseInput = document.getElementById("api-base-input");
  const $saveApiBaseBtn = document.getElementById("save-api-base-btn");
  const $apiBaseStatus = document.getElementById("api-base-status");

  // ============================================================
  // 平台 URL 匹配表（与 config/platforms.js 保持一致）
  // ============================================================

  const PLATFORM_URL_MAP = [
    { slug: "juejin", name: "掘金", pattern: /juejin\.cn/ },
    { slug: "csdn", name: "CSDN", pattern: /(editor|mp)\.csdn\.net/ },
    { slug: "zhihu", name: "知乎", pattern: /zhuanlan\.zhihu\.com/ },
    { slug: "cnblogs", name: "博客园", pattern: /i\.cnblogs\.com/ },
    { slug: "toutiao", name: "今日头条", pattern: /mp\.toutiao\.com/ },
    { slug: "tencent-cloud", name: "腾讯云", pattern: /cloud\.tencent\.com\/developer/ },
    { slug: "51cto", name: "51CTO", pattern: /blog\.51cto\.com/ },
    { slug: "segmentfault", name: "思否", pattern: /segmentfault\.com/ },
    { slug: "oschina", name: "开源中国", pattern: /my\.oschina\.net/ },
    { slug: "infoq", name: "InfoQ", pattern: /xie\.infoq\.cn/ },
    { slug: "bilibili", name: "哔哩哔哩", pattern: /member\.bilibili\.com/ },
  ];

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 向 service-worker 发送消息
   * @param {object} message
   * @returns {Promise<object>}
   */
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  /**
   * 显示错误信息
   * @param {string} text
   */
  function showLoginError(text) {
    $loginError.textContent = text;
    $loginError.classList.remove("hidden");
  }

  /**
   * 隐藏错误信息
   */
  function hideLoginError() {
    $loginError.classList.add("hidden");
  }

  /**
   * 切换到已登录视图
   * @param {object} user - 用户信息
   */
  function showLoggedIn(user) {
    $loginSection.classList.add("hidden");
    $mainSection.classList.remove("hidden");
    $userName.textContent = user.username || user.email || "已登录";
  }

  /**
   * 切换到未登录视图
   */
  function showLoggedOut() {
    $mainSection.classList.add("hidden");
    $loginSection.classList.remove("hidden");
    hideLoginError();
  }

  // ============================================================
  // 初始化
  // ============================================================

  async function init() {
    const manifest = chrome.runtime.getManifest();
    $version.textContent = `v${manifest.version}`;

    const apiBaseResp = await sendMessage({ action: "getApiBase" });
    if (apiBaseResp && apiBaseResp.data) {
      $apiBaseInput.value = apiBaseResp.data;
    }

    const sessionResp = await sendMessage({ action: "getSession" });
    if (sessionResp && sessionResp.data) {
      // 有 session，验证是否有效
      const verifyResp = await sendMessage({ action: "verifySession" });
      if (verifyResp && verifyResp.success) {
        showLoggedIn(verifyResp.data);
        await loadPlatformInfo();
        await detectCurrentPlatform();
        return;
      }
    }

    // 未登录或 session 失效
    showLoggedOut();
  }

  // ============================================================
  // 登录
  // ============================================================

  $loginBtn.addEventListener("click", async () => {
    hideLoginError();

    const token = $sessionInput.value.trim();
    if (!token) {
      showLoginError("请输入 Session Token");
      return;
    }

    $loginBtn.disabled = true;
    $loginBtn.textContent = "验证中...";

    try {
      // 保存 session
      await sendMessage({ action: "saveSession", token });

      // 验证
      const verifyResp = await sendMessage({ action: "verifySession" });
      if (verifyResp && verifyResp.success) {
        showLoggedIn(verifyResp.data);
        await loadPlatformInfo();
        await detectCurrentPlatform();
      } else {
        // 验证失败，清除无效 session
        await sendMessage({ action: "clearSession" });
        showLoginError("Token 无效或已过期，请重新获取");
      }
    } catch (e) {
      showLoginError("登录失败: " + e.message);
    } finally {
      $loginBtn.disabled = false;
      $loginBtn.textContent = "登录";
    }
  });

  // ============================================================
  // 退出登录
  // ============================================================

  $logoutBtn.addEventListener("click", async () => {
    await sendMessage({ action: "clearSession" });
    showLoggedOut();
  });

  // ============================================================
  // 平台信息
  // ============================================================

  async function loadPlatformInfo() {
    const configs = globalThis.PLATFORM_CONFIGS || [];

    $configCount.textContent = String(configs.length);

    $platformList.innerHTML = "";
    const source = configs.length > 0 ? configs : PLATFORM_URL_MAP;
    source.forEach((cfg) => {
      const tag = document.createElement("span");
      tag.className = "platform-tag";
      tag.textContent = cfg.name;
      $platformList.appendChild(tag);
    });

    // 前往写文章链接
    const apiBaseResp = await sendMessage({ action: "getApiBase" });
    const apiBase = (apiBaseResp && apiBaseResp.data) || "http://localhost:3000";
    $gotoWrite.href = apiBase.replace(/\/api$/, "").replace(/\/$/, "");
    $gotoWrite.textContent = "前往写文章";
  }

  /**
   * 检测当前标签页匹配的平台
   */
  async function detectCurrentPlatform() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const matched = PLATFORM_URL_MAP.find((p) => p.pattern.test(tab.url));
      if (matched) {
        $platformMatch.classList.remove("hidden");
        $matchedPlatform.textContent = matched.name;
      }
    } catch (e) {
      // tabs 权限可能不可用，忽略
      console.warn("检测当前平台失败:", e);
    }
  }

  // ============================================================
  // 后端地址设置
  // ============================================================

  $saveApiBaseBtn.addEventListener("click", async () => {
    const url = $apiBaseInput.value.trim();
    if (!url) {
      $apiBaseStatus.textContent = "请输入地址";
      $apiBaseStatus.className = "api-base-status error-text";
      $apiBaseStatus.classList.remove("hidden");
      return;
    }

    try {
      new URL(url);
    } catch {
      $apiBaseStatus.textContent = "地址格式不正确";
      $apiBaseStatus.className = "api-base-status error-text";
      $apiBaseStatus.classList.remove("hidden");
      return;
    }

    $saveApiBaseBtn.disabled = true;
    await sendMessage({ action: "setApiBase", url });

    $apiBaseStatus.textContent = "已保存，请刷新前端页面";
    $apiBaseStatus.className = "api-base-status success-text";
    $apiBaseStatus.classList.remove("hidden");

    $saveApiBaseBtn.disabled = false;
    setTimeout(() => $apiBaseStatus.classList.add("hidden"), 5000);
  });

  // ============================================================
  // 启动
  // ============================================================

  init().catch(console.error);
})();
