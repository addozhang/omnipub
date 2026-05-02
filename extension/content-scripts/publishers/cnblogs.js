/**
 * cnblogs.js — 博客园适配器
 *
 * 编辑器：Angular 19 自定义 Markdown 编辑器
 *   - 核心编辑区：textarea#md-editor（Angular form-bound）
 *   - 外层容器：cnb-editors-adapter（ng-valid/ng-invalid 状态指示器）
 * 标题：#post-title
 * 发布：.cnb-button（文字"发布"）
 * 登录 Cookie：.CNBlogsCookie
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class CnblogsPublisher extends BasePublisher {
    constructor() {
      super("cnblogs");
      this.publishSelectors = [".cnb-button"];
    }

    async waitForPageReady() {
      log("[cnblogs] 等待 Angular 编辑器加载...");
      const start = Date.now();
      const timeout = 15000;
      while (Date.now() - start < timeout) {
        if (document.querySelector("#post-title") && document.querySelector("textarea#md-editor")) {
          log("[cnblogs] 页面就绪: title + textarea#md-editor");
          return;
        }
        await this.delay(300);
      }
      if (document.querySelector("#post-title")) {
        log("[cnblogs] textarea#md-editor 未出现，但标题存在，继续尝试");
        return;
      }
      log("[cnblogs] 页面元素等待超时，继续尝试填充");
    }

    async fillBody() {
      const markdown = this.articleData?.markdown || this.articleData?.html || "";
      if (!markdown) {
        console.warn("[cnblogs] 无正文内容");
        return;
      }

      const textarea = await this._waitForTextarea(15000);
      if (!textarea) {
        throw new Error("[cnblogs] 找不到编辑器 textarea#md-editor");
      }

      log("[cnblogs] 找到 textarea#md-editor，开始填充");
      textarea.focus();

      const proto = Object.getPrototypeOf(textarea);
      const descriptor =
        Object.getOwnPropertyDescriptor(proto, "value") ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(textarea, markdown);
      } else {
        textarea.value = markdown;
      }

      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      textarea.dispatchEvent(new Event("keyup", { bubbles: true }));

      await this.delay(300);

      const adapter = document.querySelector("cnb-editors-adapter");
      if (adapter && adapter.classList.contains("ng-invalid")) {
        log("[cnblogs] Angular form 仍然 ng-invalid，尝试 execCommand fallback");
        textarea.focus();
        textarea.select();
        document.execCommand("insertText", false, markdown);
        await this.delay(300);
      }

      log("[cnblogs] 正文填充完成");
    }

    async _waitForTextarea(timeout = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const ta = document.querySelector("textarea#md-editor");
        if (ta) return ta;
        await this.delay(300);
      }
      return null;
    }

    async fillPublishConfig(config) {
      if (config.category) {
        try {
          log(`[cnblogs] 设置分类: ${config.category}`);
          const categoryInput = document.querySelector(
            '#TextBoxTag, input[placeholder*="分类"], .post-category input'
          );
          if (categoryInput) {
            categoryInput.focus();
            categoryInput.value = config.category;
            categoryInput.dispatchEvent(new Event("input", { bubbles: true }));
            categoryInput.dispatchEvent(new Event("change", { bubbles: true }));
            await this.delay(300);
          } else {
            const categoryCheckboxes = document.querySelectorAll(
              '#CategoriesBlock input[type="checkbox"], .category-list input[type="checkbox"]'
            );
            const target = [...categoryCheckboxes].find(cb => {
              const label = cb.closest("label") || cb.parentElement;
              return label && label.textContent.includes(config.category);
            });
            if (target && !target.checked) {
              target.click();
              await this.delay(300);
            } else if (!target) {
              console.warn(`[cnblogs] 未找到分类 "${config.category}"`);
            }
          }
        } catch (e) {
          console.warn(`[cnblogs] 设置分类失败:`, e.message);
        }
      }
    }

    async afterFill() {
      log("[cnblogs] 查找发布按钮...");
      // 有多个 .cnb-button，找文字为"发布"的那个
      const btn = await this.waitForPublishButton(8000);
      if (!btn) {
        throw new Error("未找到发布按钮");
      }
      log("[cnblogs] 点击发布...");
      btn.click();

      // 等待页面跳转到文章页（格式: /p/{id}.html）
      const articleUrl = await this._waitForArticleUrl(15000);
      if (articleUrl) {
        log("[cnblogs] 捕获到文章 URL:", articleUrl);
        return { article_url: articleUrl };
      }
      log("[cnblogs] 未捕获到文章 URL（可能跳转超时）");
      return null;
    }

    /**
     * 等待发布后跳转到文章页，提取 article_url。
     * 博客园发布成功后会跳转到 https://www.cnblogs.com/{username}/p/{id}.html
     */
    async _waitForArticleUrl(timeout = 15000) {
      const start = Date.now();
      const initialUrl = location.href;
      while (Date.now() - start < timeout) {
        if (location.href !== initialUrl && /\/p\/\d+\.html/.test(location.href)) {
          return location.href;
        }
        await this.delay(500);
      }
      return null;
    }

    async waitForPublishButton(timeout = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const all = [...document.querySelectorAll(".cnb-button")];
        const btn = all.find(
          el => el.textContent.trim() === "发布" && !el.disabled
        );
        if (btn) return btn;
        await this.delay(300);
      }
      return null;
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  const publisher = new CnblogsPublisher();
  publisher.init();
})();
