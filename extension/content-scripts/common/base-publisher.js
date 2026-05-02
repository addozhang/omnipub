/**
 * base-publisher.js — 发布器基类
 *
 * 所有平台公用的发布逻辑。配置驱动：
 * 1. 从 background 获取平台配置（选择器、编辑器类型等）
 * 2. 通过 FILL_AND_PUBLISH 消息接收待发布文章数据
 * 3. 用 EditorAdapterFactory 根据编辑器类型填充内容
 * 4. 用 SuccessDetector 检测发布成功
 *
 * 子类只需传入 platformSlug，如有特殊逻辑可覆写 beforeFill / afterFill / verifyFill。
 *
 * 全局变量：window.BasePublisher
 */

(function () {
  "use strict";

  // ============================================================
  // 常量
  // ============================================================

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  /** 等待元素的默认超时时间（毫秒） */
  const DEFAULT_WAIT_TIMEOUT = 30000;

  /** 等待元素的轮询间隔（毫秒） */
  const POLL_INTERVAL = 300;

  /** 重试最大次数 */
  const MAX_RETRIES = 3;

  /** 重试间隔（毫秒） */
  const RETRY_DELAY = 1000;

  /**
   * 将后端 editor_config 中的选择器字段标准化为数组格式。
   * 后端存储的是单个字符串（可能含逗号分隔的多选择器），
   * base-publisher 内部统一用数组 (title_selectors / content_selectors) 处理。
   * @param {object} editorConfig - 原始 editor_config
   * @returns {object} 标准化后的 editor_config
   */
  function normalizeEditorConfig(editorConfig) {
    if (!editorConfig) return {};
    const result = { ...editorConfig };

    // title_selector (string) → title_selectors (array)
    if (!result.title_selectors && result.title_selector) {
      result.title_selectors = result.title_selector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // content_selector (string) → content_selectors (array)
    if (!result.content_selectors && result.content_selector) {
      result.content_selectors = result.content_selector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // content_frame_selector (string) → content_frame_selectors (array)
    if (!result.content_frame_selectors && result.content_frame_selector) {
      result.content_frame_selectors = result.content_frame_selector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    return result;
  }

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 延时
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }


  // ============================================================
  // BasePublisher 类
  // ============================================================

  class BasePublisher {
    /**
     * @param {string} platformSlug - 平台唯一标识（与后端 Platform.slug 对应）
     */
    constructor(platformSlug) {
      /** 平台标识 */
      this.platform = platformSlug;
      /** 从后端拉取的平台配置 */
      this.config = null;
      /** 待发布的文章数据 */
      this.articleData = null;
      /** 是否已触发过填充 */
      this.fillTriggered = false;
      /** 是否正在填充中 */
      this.fillingInProgress = false;
      /** 成功检测器实例 */
      this.successDetector = null;
    }

    // ----------------------------------------------------------
    // 初始化
    // ----------------------------------------------------------

    /**
     * 初始化发布器
     * 1. 从 background 获取平台配置
     * 2. 注册到全局，等待 FILL_AND_PUBLISH 消息触发发布流程
     */
    async init() {
      try {
        log(`[${this.platform}] 发布器初始化`);

        // 注册到全局，供 FILL_AND_PUBLISH 消息处理使用
        window.__omnipubPublisher = this;

        // 获取平台配置
        this.config = await this.fetchConfig();
        if (!this.config) {
          console.warn(`[${this.platform}] 无法获取平台配置，跳过`);
          return;
        }
        log(`[${this.platform}] 配置已加载，等待 FILL_AND_PUBLISH 消息`);
      } catch (e) {
        console.error(`[${this.platform}] 初始化失败:`, e);
        if (typeof hideOverlay === "function") {
          hideOverlay();
        }
      }
    }

    // ----------------------------------------------------------
    // 配置获取
    // ----------------------------------------------------------

    /**
     * 读取本地硬编码的平台配置（来自 extension/config/platforms.js）。
     * 把 editor 字段映射到老的 editor_config 字段名以复用 normalizeEditorConfig
     * 和现有 publisher 子类对 config.editor_config 的引用。
     * @returns {Promise<object|null>} 平台配置对象
     */
    async fetchConfig() {
      const all = (typeof PLATFORM_CONFIGS !== "undefined" && PLATFORM_CONFIGS)
        || (typeof window !== "undefined" && window.PLATFORM_CONFIGS)
        || [];
      const local = all.find((c) => c.slug === this.platform);
      if (!local) return null;

      const config = {
        slug: local.slug,
        name: local.name,
        editor_config: normalizeEditorConfig(local.editor || {}),
      };
      return config;
    }

    // ----------------------------------------------------------
    // 页面就绪检测
    // ----------------------------------------------------------

    /**
     * 等待页面关键元素加载完成
     * 使用配置中的 content_selectors 或 title_selectors 作为就绪标识
     */
    async waitForPageReady() {
      const editorConfig = this.config.editor_config || {};
      const selectors = [
        ...(editorConfig.title_selectors || []),
        ...(editorConfig.content_selectors || []),
      ];

      if (selectors.length === 0) {
        // 无配置的选择器，等待一段固定时间
        log(`[${this.platform}] 无选择器配置，等待 2 秒`);
        await delay(2000);
        return;
      }

      // 等待至少一个选择器匹配到元素
      log(`[${this.platform}] 等待页面元素就绪...`);
      await this.waitForAnyElement(selectors, DEFAULT_WAIT_TIMEOUT);
    }

    // ----------------------------------------------------------
    // 填充流程
    // ----------------------------------------------------------

    /**
     * 执行填充流程（主入口）
     * 互斥保护 + 覆盖层 + 前置/标题/正文/后置/校验
     */
    async fillContent() {
      // 互斥保护
      if (this.fillingInProgress || this.fillTriggered) {
        log(`[${this.platform}] 填充已在进行中或已完成，跳过`);
        return;
      }
      this.fillTriggered = true;
      this.fillingInProgress = true;

      // 显示覆盖层
      if (typeof showOverlay === "function") {
        showOverlay(`正在向${this.config.name}填充文章内容...`);
      }

      try {
        // 前置操作（子类可覆写）
        await this.beforeFill();

        // 填充标题
        if (typeof updateOverlay === "function") {
          updateOverlay(`正在填充标题...`);
        }
        await this.fillTitle();
        await delay(500); // 等待框架处理

        // 填充正文
        if (typeof updateOverlay === "function") {
          updateOverlay(`正在填充正文内容...`);
        }
        await this.fillBody();
        await delay(500);

        // 填充发布配置（子类可覆写）
        this.publishConfig = this.articleData.publish_config || {};
        if (Object.keys(this.publishConfig).length > 0) {
          if (typeof updateOverlay === "function") {
            updateOverlay(`正在应用发布配置...`);
          }
          await this.fillPublishConfig(this.publishConfig);
          await delay(300);
        }

        // 后置操作（子类可覆写）
        await this.afterFill();

        // 校验填充结果
        if (typeof updateOverlay === "function") {
          updateOverlay(`正在校验填充结果...`);
        }
        await this.verifyFill();

        // 启动成功检测
        this.startSuccessDetection();

        log(`[${this.platform}] 文章填充完成`);
      } catch (e) {
        console.error(`[${this.platform}] 文章填充失败:`, e);
        chrome.runtime.sendMessage({
          action: "publishProgress",
          progress: { platform: this.platform, status: "failed", message: e.message },
        }).catch(() => {});
      } finally {
        this.fillingInProgress = false;
        if (typeof hideOverlay === "function") {
          hideOverlay();
        }
      }
    }

    // ----------------------------------------------------------
    // 标题填充
    // ----------------------------------------------------------

    /**
     * 填充标题
     * 使用配置中的 title_selectors 找到标题输入框
     */
    async fillTitle() {
      const editorConfig = this.config.editor_config || {};
      const selectors = editorConfig.title_selectors || [];

      if (selectors.length === 0) {
        console.warn(`[${this.platform}] 无标题选择器配置，跳过标题填充`);
        return;
      }

      const titleElement = await this.waitForAnyElement(selectors, DEFAULT_WAIT_TIMEOUT);
      if (!titleElement) {
        throw new Error(
          `[${this.platform}] 找不到标题输入框，选择器: ${selectors.join(", ")}`
        );
      }

      const title = this.articleData.title || "";
      log(`[${this.platform}] 填充标题: "${title}"`);

      // 根据元素类型选择填充方式
      if (titleElement.tagName === "INPUT" || titleElement.tagName === "TEXTAREA") {
        this._setInputValue(titleElement, title);
      } else if (titleElement.getAttribute("contenteditable") === "true") {
        titleElement.focus();
        titleElement.textContent = title;
        titleElement.dispatchEvent(new Event("input", { bubbles: true }));
        titleElement.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        // 可能是某种自定义组件，尝试找内部 input
        const innerInput = titleElement.querySelector("input") || titleElement.querySelector("textarea");
        if (innerInput) {
          this._setInputValue(innerInput, title);
        } else {
          titleElement.textContent = title;
          titleElement.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }

    /**
     * 设置 input/textarea 的值（兼容 React 等框架）
     * @param {HTMLElement} element
     * @param {string} value
     * @private
     */
    _setInputValue(element, value) {
      // 获取原生 setter
      const proto = Object.getPrototypeOf(element);
      const descriptor =
        Object.getOwnPropertyDescriptor(proto, "value") ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" })
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("keyup", { bubbles: true }));
    }

    // ----------------------------------------------------------
    // 正文填充
    // ----------------------------------------------------------

    /**
     * 填充正文
     * 使用 EditorAdapterFactory 根据 editor_type 创建适配器
     */
    async fillBody() {
      const editorConfig = this.config.editor_config || {};
      const editorType = editorConfig.editor_type || "auto_detect";
      const selectors = editorConfig.content_selectors || [];

      if (selectors.length === 0) {
        throw new Error(
          `[${this.platform}] 无正文选择器配置，无法填充正文`
        );
      }

      const contentElement = await this.waitForAnyElement(selectors, DEFAULT_WAIT_TIMEOUT);
      if (!contentElement) {
        throw new Error(`[${this.platform}] 找不到编辑器元素，选择器: ${selectors.join(", ")}`);
      }

      log(`[${this.platform}] 使用 ${editorType} 适配器填充正文`);
      // 使用适配器填充，带重试
      let success = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const adapter = EditorAdapterFactory.create(editorType, editorConfig);
        success = await adapter.fill(contentElement, this.articleData);
        if (success) break;

        console.warn(`[${this.platform}] 填充尝试 ${attempt}/${MAX_RETRIES} 失败`);
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY);
        }
      }

      if (!success) {
        throw new Error(`[${this.platform}] 正文填充失败，已尝试 ${MAX_RETRIES} 次`);
      }
    }

    // ----------------------------------------------------------
    // 钩子方法（子类可覆写）
    // ----------------------------------------------------------

    /**
     * 前置操作钩子
     * 在填充标题和正文之前执行。
     * 子类可覆写此方法执行特殊操作（如切换编辑器模式）。
     */
    async beforeFill() {
      // 默认无操作
    }

    /**
     * 后置操作钩子
     * 在填充标题和正文之后执行。
     * 子类可覆写此方法执行特殊操作（如设置标签、分类等）。
     */
    async afterFill() {
      // 默认无操作
    }

    /**
     * 填充发布配置钩子
     * 在填充标题和正文之后、afterFill 之前执行。
     * 子类可覆写此方法根据 publishConfig 设置分类、标签等。
     * @param {object} publishConfig - 预配置字段 (key → value)
     */
    async fillPublishConfig(_publishConfig) {
      // 默认无操作，子类可 override
    }

    /**
     * 填充校验钩子
     * 校验填充结果是否符合预期。
     * 子类可覆写此方法执行更严格的校验。
     */
    async verifyFill() {
      // 默认：检查标题是否已填入
      const editorConfig = this.config.editor_config || {};
      const titleSelectors = editorConfig.title_selectors || [];

      if (titleSelectors.length > 0 && this.articleData.title) {
        const titleElement = this._findAnyElement(titleSelectors);
        if (titleElement) {
          const currentValue =
            titleElement.value || titleElement.textContent || "";
          if (currentValue.trim().length === 0) {
            console.warn(`[${this.platform}] 标题校验失败：标题为空`);
          }
        }
      }
    }

    // ----------------------------------------------------------
    // 通知与检测
    // ----------------------------------------------------------

    /**
     * 启动发布成功检测
     */
    startSuccessDetection() {
      if (typeof SuccessDetector === "undefined") {
        console.warn(`[${this.platform}] SuccessDetector 未加载`);
        return;
      }

      const articleUrlPattern = this.config.article_url_pattern;
      if (!articleUrlPattern) {
        log(`[${this.platform}] 无 article_url_pattern，跳过成功检测`);
        return;
      }

      this.successDetector = new SuccessDetector(this.platform, {
        article_url_pattern: articleUrlPattern,
        articleId: this.articleData.articleId,
        publicationId: this.articleData.publicationId,
        sessionId: this.articleData.sessionId,
      });

      this.successDetector.start();
    }

    // ----------------------------------------------------------
    // 工具方法
    // ----------------------------------------------------------

    /**
     * 等待单个元素出现
     * @param {string} selector - CSS 选择器
     * @param {number} [timeout=15000] - 超时毫秒数
     * @returns {Promise<HTMLElement|null>} 找到的元素或 null
     */
    async waitForElement(selector, timeout = DEFAULT_WAIT_TIMEOUT) {
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const element = document.querySelector(selector);
        if (element) return element;
        await delay(POLL_INTERVAL);
      }

      console.warn(
        `[${this.platform}] 等待元素超时 (${timeout}ms): ${selector}`
      );
      return null;
    }

    /**
     * 等待多个选择器中的任意一个匹配到元素
     * @param {string[]} selectors - CSS 选择器数组
     * @param {number} [timeout=15000] - 超时毫秒数
     * @returns {Promise<HTMLElement|null>} 第一个找到的元素或 null
     */
    async waitForAnyElement(selectors, timeout = DEFAULT_WAIT_TIMEOUT) {
      if (!selectors || selectors.length === 0) return null;

      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const found = this._findAnyElement(selectors);
        if (found) return found;
        await delay(POLL_INTERVAL);
      }

      console.warn(
        `[${this.platform}] 等待元素超时 (${timeout}ms): ${selectors.join(", ")}`
      );
      return null;
    }

    /**
     * 同步查找多个选择器中的第一个匹配元素
     * @param {string[]} selectors
     * @returns {HTMLElement|null}
     * @private
     */
    _findAnyElement(selectors) {
      for (const selector of selectors) {
        try {
          const element = document.querySelector(selector);
          if (element) return element;
        } catch {
          // 无效选择器，跳过
          console.warn(`[${this.platform}] 无效选择器: ${selector}`);
        }
      }
      return null;
    }
  }

  // ============================================================
  // 导出到全局
  // ============================================================

  window.BasePublisher = BasePublisher;

  // ============================================================
  // 全局消息监听：接收 FILL_AND_PUBLISH 指令
  // ============================================================

  /** 通用发布按钮选择器（按优先级尝试） */
  const DEFAULT_PUBLISH_SELECTORS = [
    'button[data-type="publish"]',
    'button.publish-btn',
    'button.submit-btn',
    '.publish-button',
    '#publish-btn',
    '#submit_btn',
    '#publishBtn',
    '#submitBtn',
  ];

  /**
   * 文字匹配发布按钮
   * @returns {HTMLElement|null}
   */
  function findPublishButtonByText() {
    const keywords = ["发布", "发布文章", "提交", "Publish"];
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || "";
      if (keywords.some((k) => text === k || text.startsWith(k))) {
        return btn;
      }
    }
    return null;
  }

  /**
   * 根据选择器数组找按钮
   * @param {string[]} selectors
   * @returns {HTMLElement|null}
   */
  function findPublishButton(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {}
    }
    return findPublishButtonByText();
  }

  /**
   * 向 service worker 回报进度
   */
  function reportProgress(platform, status, message, article_url) {
    const progress = { platform, status, message };
    if (article_url) progress.article_url = article_url;
    chrome.runtime.sendMessage({
      action: "publishProgress",
      progress,
    }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log(`onMessage received: ${message.action}`);
    if (message.action !== "FILL_AND_PUBLISH") return false;

    const { article, platform: targetPlatform, publicationId } = message;
    log(`FILL_AND_PUBLISH for ${targetPlatform}, article: ${article?.title?.slice(0, 30)}`);

    const pub = window.__omnipubPublisher;
    log(`publisher: ${pub ? pub.platform : 'null'}, match: ${pub?.platform === targetPlatform}`);
    if (!pub || pub.platform !== targetPlatform) {
      sendResponse({ success: false, error: "No matching publisher" });
      return false;
    }

    // E-4: Idempotency guard — SW may retry FILL_AND_PUBLISH if the first
    // sendMessage threw (content script not yet ready). Once we have started
    // filling, silently ack duplicates so the SW does not retry again.
    if (pub._fillAndPublishStarted) {
      log(`[${targetPlatform}] FILL_AND_PUBLISH already in progress, ignoring duplicate`);
      sendResponse({ success: true });
      return false;
    }
    pub._fillAndPublishStarted = true;

    (async () => {
      try {
        pub.articleData = {
          title: article.title,
          markdown: article.markdown_content || article.markdown,
          html: article.html_content || article.html,
          articleId: article.id || article.articleId,
          publicationId: publicationId || null,
          platform: targetPlatform,
          timestamp: Date.now(),
          publish_config: message.publishConfig || {},
        };
        const appendMd = (message.publishConfig || {}).append_markdown;
        if (appendMd && appendMd.trim()) {
          pub.articleData.markdown = (pub.articleData.markdown || "") + "\n\n" + appendMd.trim();
          // 为富文本编辑器同步追加 HTML：简单将每行包为 <p>，识别 markdown 链接
          const appendHtml = appendMd
            .trim()
            .split("\n")
            .map((line) => {
              const escaped = line.replace(/</g, "&lt;").replace(/>/g, "&gt;");
              // 先处理图片 ![alt](url) → <img>，再处理链接 [text](url) → <a>
              const withImages = escaped.replace(
                /!\[([^\]]*)\]\(([^)]+)\)/g,
                '<img src="$2" alt="$1" />'
              );
              const withLinks = withImages.replace(
                /\[([^\]]+)\]\(([^)]+)\)/g,
                '<a href="$2">$1</a>'
              );
              return `<p>${withLinks}</p>`;
            })
            .join("\n");
          if (pub.articleData.html) {
            pub.articleData.html += "\n" + appendHtml;
          }
          log(`[${targetPlatform}] 已追加文末内容 (${appendMd.trim().length} chars)`);
        }
        // 获取配置
        if (!pub.config) {
          pub.config = await pub.fetchConfig();
        }

        if (!pub.config) {
          reportProgress(targetPlatform, "failed", "无法获取平台配置");
          sendResponse({ success: false });
          return;
        }

        reportProgress(targetPlatform, "filling", "正在填充内容...");
        await pub.waitForPageReady();

        // Publishers with custom fill() (e.g. bilibili iframe) bypass fillContent()
        const hasCustomFill = pub.constructor.prototype.hasOwnProperty("fill");
        let afterFillResult = null;

        if (hasCustomFill) {
          log(`[${targetPlatform}] 使用自定义 fill() 方法`);
          await pub.fill(pub.articleData);
        } else {
          // Call stages directly — fillContent() swallows errors via internal try-catch
          await pub.beforeFill();
          await pub.fillTitle();
          await new Promise((r) => setTimeout(r, 500));
          await pub.fillBody();
          await new Promise((r) => setTimeout(r, 500));

          const publishConfig = pub.articleData.publish_config || {};
          pub.publishConfig = publishConfig;
          if (Object.keys(publishConfig).length > 0) {
            await pub.fillPublishConfig(publishConfig);
            await new Promise((r) => setTimeout(r, 300));
          }

          // Start SuccessDetector BEFORE afterFill() so it can catch
          // post-publish URL changes or success toast DOM mutations.
          // The service worker delays tab closure by a few seconds to give
          // the detector a window to fire with the actual article_url.
          pub.startSuccessDetection();

          reportProgress(targetPlatform, "publishing", "正在点击发布按钮...");
          afterFillResult = await pub.afterFill();

          // Fallback for publishers without afterFill() override
          if (!pub.constructor.prototype.hasOwnProperty("afterFill")) {
            log(`[${targetPlatform}] afterFill 为默认实现，尝试通用发布按钮查找`);
            const selectors = (pub.publishSelectors || []).concat(DEFAULT_PUBLISH_SELECTORS);
            const btn = findPublishButton(selectors);
            if (btn) {
              log(`[${targetPlatform}] 找到发布按钮: "${btn.textContent?.trim()}"`);
              btn.click();
            } else {
              console.warn(`[${targetPlatform}] 未找到发布按钮`);
            }
          }
        }

        // afterFill() may optionally return { article_url } for API-based publishers.
        const articleUrl = (afterFillResult && afterFillResult.article_url) || null;
        log(`[${targetPlatform}] 完成，立即上报成功${articleUrl ? `，article_url: ${articleUrl}` : ""}`);
        reportProgress(targetPlatform, "success", "发布按钮已点击", articleUrl);

        sendResponse({ success: true });
      } catch (e) {
        console.error(`[${targetPlatform}] FILL_AND_PUBLISH 失败:`, e);
        const errDetail = `${e.message} | stack: ${(e.stack || "").slice(0, 500)}`;
        reportProgress(targetPlatform, "failed", errDetail);
        sendResponse({ success: false, error: errDetail });
      }
    })();

    return true; // 异步
  });
})();
