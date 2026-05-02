/**
 * success-detector.js — 通用发布成功检测
 *
 * 配置驱动：根据后端配置的 article_url_pattern 检测发布是否成功。
 * 检测方式：
 * 1. 监听 URL 变化（pushState / replaceState / hashchange / popstate）
 * 2. 定时轮询当前 URL
 * 3. 监听 DOM 变化（成功提示弹窗等）
 *
 * 匹配成功后自动上报发布结果到后端。
 *
 * 全局变量：window.SuccessDetector
 */

(function () {
  "use strict";

  // ============================================================
  // 常量
  // ============================================================

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  /** URL 轮询间隔（毫秒） */
  const POLL_INTERVAL = 1000;

  /** 检测超时时间（10 分钟） */
  const DETECT_TIMEOUT = 10 * 60 * 1000;

  /** 常见的发布成功关键词 */
  const SUCCESS_KEYWORDS = [
    "发布成功",
    "发表成功",
    "提交成功",
    "保存成功",
    "已发布",
    "已发表",
    "published",
    "success",
  ];

  // ============================================================
  // SuccessDetector 类
  // ============================================================

  class SuccessDetector {
    /**
     * @param {string} platform - 平台标识
     * @param {object} config - 配置
     * @param {string} config.article_url_pattern - 文章 URL 模式（含 {article_id} 占位符）
     * @param {number} [config.articleId] - 文章 ID
     * @param {number} [config.publicationId] - 发布记录 ID
     * @param {string} [config.sessionId] - session ID
     */
    constructor(platform, config) {
      this.platform = platform;
      this.config = config;
      this.articleId = config.articleId;
      this.publicationId = config.publicationId;

      // 构建 URL 匹配正则
      this.urlPattern = this._buildUrlPattern(config.article_url_pattern);

      // 状态
      this.isRunning = false;
      this.pollTimer = null;
      this.timeoutTimer = null;
      this.mutationObserver = null;
      this.lastUrl = window.location.href;
      this.detected = false;

      // 记录启动时的初始 URL（不含 query/hash），避免编辑器 URL 误匹配
      this.initialUrl = window.location.origin + window.location.pathname;
    }

    // ----------------------------------------------------------
    // 公共方法
    // ----------------------------------------------------------

    /**
     * 启动检测
     */
    start() {
      if (this.isRunning) return;
      this.isRunning = true;

      log(`[SuccessDetector][${this.platform}] 开始检测发布成功`);

      // 1. 拦截 History API
      this._hookHistoryApi();

      // 2. 监听 URL 相关事件
      window.addEventListener("hashchange", this._onUrlChange.bind(this));
      window.addEventListener("popstate", this._onUrlChange.bind(this));

      // 3. 定时轮询 URL
      this.pollTimer = setInterval(() => {
        this._checkUrl(window.location.href);
      }, POLL_INTERVAL);

      // 4. 监听 DOM 变化（检测成功提示）
      this._observeDom();

      // 5. 设置超时
      this.timeoutTimer = setTimeout(() => {
        log(`[SuccessDetector][${this.platform}] 检测超时，停止`);
        this.stop();
      }, DETECT_TIMEOUT);
    }

    /**
     * 停止检测
     */
    stop() {
      if (!this.isRunning) return;
      this.isRunning = false;

      log(`[SuccessDetector][${this.platform}] 停止检测`);

      // 清理定时器
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }

      // 清理 MutationObserver
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      // 移除事件监听
      window.removeEventListener("hashchange", this._onUrlChange);
      window.removeEventListener("popstate", this._onUrlChange);

      // 恢复 History API 原始方法
      if (this._origPushState) {
        history.pushState = this._origPushState;
        this._origPushState = null;
      }
      if (this._origReplaceState) {
        history.replaceState = this._origReplaceState;
        this._origReplaceState = null;
      }
    }

    // ----------------------------------------------------------
    // 内部方法
    // ----------------------------------------------------------

    /**
     * 构建 URL 匹配正则
     * @param {string} pattern - URL 模式字符串
     * @returns {RegExp|null}
     * @private
     */
    _buildUrlPattern(pattern) {
      if (!pattern) return null;

      try {
        // 转义特殊字符，替换占位符
        const regexStr = pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")    // 转义正则特殊字符
          .replace(/\\{article_id\\}/g, "([\\w-]+)")  // {article_id} → 捕获组
          .replace(/\\{username\\}/g, "[\\w-]+");      // {username} → 非捕获

        return new RegExp(regexStr);
      } catch (e) {
        console.error(`[SuccessDetector] 构建 URL 正则失败:`, e);
        return null;
      }
    }

    /**
     * 拦截 History API（pushState / replaceState）
     * @private
     */
    _hookHistoryApi() {
      const self = this;
      this._origPushState = history.pushState;
      this._origReplaceState = history.replaceState;

      history.pushState = function (...args) {
        self._origPushState.apply(this, args);
        self._onUrlChange();
      };

      history.replaceState = function (...args) {
        self._origReplaceState.apply(this, args);
        self._onUrlChange();
      };
    }

    /**
     * URL 变化回调
     * @private
     */
    _onUrlChange() {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        this.lastUrl = currentUrl;
        this._checkUrl(currentUrl);
      }
    }

    /**
     * 检查 URL 是否匹配成功模式
     * @param {string} url
     * @private
     */
    _checkUrl(url) {
      if (this.detected || !this.urlPattern) return;

      const urlWithoutQuery = url.split("?")[0].split("#")[0];
      if (urlWithoutQuery === this.initialUrl) return;

      const match = url.match(this.urlPattern);
      if (match) {
        const platformArticleId = match[1] || null;
        this._onSuccess(url, platformArticleId);
      }
    }

    /**
     * 监听 DOM 变化
     * @private
     */
    _observeDom() {
      this.mutationObserver = new MutationObserver((mutations) => {
        if (this.detected) return;

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            const text = node.textContent || "";
            const matched = SUCCESS_KEYWORDS.some((keyword) =>
              text.includes(keyword)
            );

            if (matched) {
              log(
                `[SuccessDetector][${this.platform}] 检测到成功关键词: "${text.substring(0, 50)}"`
              );
              // DOM 检测到成功关键词，但仍需等待 URL 变化来获取文章 ID
              // 给一个短延时再检查 URL
              setTimeout(() => {
                this._checkUrl(window.location.href);
              }, 2000);
            }
          }
        }
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    /**
     * 发布成功回调
     * @param {string} articleUrl - 发布后的文章 URL
     * @param {string|null} platformArticleId - 平台文章 ID
     * @private
     */
    async _onSuccess(articleUrl, platformArticleId) {
      if (this.detected) return;
      this.detected = true;

      log(
        `[SuccessDetector][${this.platform}] 发布成功！文章 URL: ${articleUrl}`
      );

      this.stop();

      // Report progress to SW so it clears the timeout and closes the tab
      try {
        chrome.runtime.sendMessage({
          action: "publishProgress",
          progress: {
            platform: this.platform,
            status: "success",
            message: "发布成功",
            article_url: articleUrl,
          },
        });
      } catch {
        // SW may be unavailable
      }

      try {
        if (this.publicationId) {
          const reportData = {
            publication_id: this.publicationId,
            platform_article_id: platformArticleId,
            article_url: articleUrl,
            status: "published",
          };

          if (typeof MessageBridge !== "undefined") {
            await MessageBridge.reportPublishResult(reportData);
          } else {
            chrome.runtime.sendMessage({
              action: "reportPublishResult",
              data: reportData,
            });
          }

          log(`[SuccessDetector][${this.platform}] 发布结果已上报`);
        }
      } catch (e) {
        console.error(`[SuccessDetector][${this.platform}] 上报发布结果失败:`, e);
      }

      try {
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "mp-publish-success",
              platform: this.platform,
              articleUrl,
              platformArticleId,
              articleId: this.articleId,
              publicationId: this.publicationId,
            },
            "*"
          );
        }
      } catch {
        // 父窗口可能已关闭
      }
    }
  }

  // ============================================================
  // 导出到全局
  // ============================================================

  window.SuccessDetector = SuccessDetector;
})();
