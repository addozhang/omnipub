(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class FiftyCtoPublisher extends BasePublisher {
    constructor() {
      super("51cto");
      this.publishSelectors = [".edit-submit"];
    }

    async fillTitle() {
      const title = this.articleData.title || "";
      if (!title) return;

      // 2026-08 改版后标题输入框是 input.title_input；保留旧选择器兼容
      const input = await this.waitForElement(
        "input.title_input, input.ant-input.editor-title, input.editor-title",
        8000
      );
      if (input) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        ).set;
        nativeSetter.call(input, title);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "51cto_setSubmitFormFields",
        args: { title },
      });
    }

    async fillBody() {
      const markdown =
        this.articleData.markdown || this.articleData.markdown_content || "";
      const html =
        this.articleData.html ||
        this.articleData.html_content ||
        this.articleData.content ||
        markdown ||
        "";
      if (!html && !markdown) return;

      // 2026-08 改版：编辑器换成 Markdown 分栏（textarea.write-area），
      // 旧的 am-engine contenteditable 已不存在。先尝试 markdown textarea。
      const mdArea = document.querySelector(
        "textarea.write-area, textarea.auto-textarea-input"
      );
      if (mdArea && markdown) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        ).set;
        nativeSetter.call(mdArea, markdown);
        mdArea.dispatchEvent(new Event("input", { bubbles: true }));
        mdArea.dispatchEvent(new Event("change", { bubbles: true }));
        await this.delay(300);
        await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "51cto_setSubmitFormFields",
          args: { content: html },
        });
        return;
      }

      const editor = document.querySelector(
        ".editor-container[contenteditable=true], [contenteditable=true].am-engine"
      );
      if (!editor) {
        // 内容最终通过 submitForm + /blogger/publish 提交，编辑器填充失败不致命
        console.warn("[51cto] 未找到编辑器 DOM，内容仅通过 API 提交");
        await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "51cto_setSubmitFormFields",
          args: { content: html },
        });
        return;
      }

      editor.focus();
      document.execCommand("selectAll", false, null);
      await this.delay(100);

      try {
        const clipboardData = new DataTransfer();
        // text/plain 使用纯文本（去掉 HTML 标签），避免 am-engine 检测到 markdown 语法弹出转换对话框
        const plainText = html.replace(/<[^>]+>/g, "").trim();
        clipboardData.setData("text/plain", plainText);
        clipboardData.setData("text/html", html);
        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        });
        editor.dispatchEvent(pasteEvent);
        await this.delay(500);
      } catch {}

      if ((editor.innerHTML || "").length < 10) {
        editor.innerHTML = html;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }

      await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "51cto_setSubmitFormFields",
        args: { content: html },
      });
    }

    async afterFill() {
      await this.delay(200);
      const title = this.articleData.title || "";
      const markdown =
        this.articleData.markdown || this.articleData.markdown_content || "";
      const html =
        this.articleData.html ||
        this.articleData.html_content ||
        this.articleData.content ||
        markdown ||
        "";

      log("[51cto] afterFill() 开始");

      await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "51cto_setSubmitFormFields",
        args: { title, content: html },
      });
      await this.delay(100);

      await this._dismissContinuePublishDialog();

      // 不再强制展开发布面板：51CTO 2026-08 改版后发布面板是右侧抽屉，
      // 强行显示会让用户误以为需要手动点「发布」，而实际内容已通过 API 提交。
      // 分类与标签直接写入 submitForm，不依赖抽屉 DOM。
      const categoryId = await this._ensureCategorySelected();
      const tagStr = this._collectTags();

      const abstract = this._generateAbstract(html, markdown);

      log("[51cto] Submitting via direct API call to /blogger/publish");
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "51cto_directPublish",
          args: {
            title,
            content: html,
            abstract,
            tag: tagStr,
            cate_id: categoryId,
          },
        });
      } catch (e) {
        log("[51cto] directPublish threw:", e.message);
        throw e;
      }

      let result;
      try {
        const raw = response && response.detail;
        result = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        log("[51cto] Failed to parse directPublish response");
        result = null;
      }

      await this.delay(1000);
      await this._dismissContinuePublishDialog();

      // 2026-08 改版后成功响应为 { status:1, msg:"success",
      //   data: { blog_id, request: "https://blog.51cto.com/blogger/success/{blog_id}" } }
      // 旧版本的 did 字段是「草稿 ID」，用它拼 URL 会得到 404 页面。
      const blogId =
        (result && result.blogId) ||
        (result &&
          result.articleUrl &&
          (result.articleUrl.match(/\/(\d+)\/?$/) || [])[1]) ||
        null;

      if (result && result.status === 1 && (blogId || result.articleUrl)) {
        log("[51cto] 发布成功, blog_id=" + blogId);
        const username = this._extract51ctoUsername();
        if (blogId && username) {
          return { article_url: `https://blog.51cto.com/${username}/${blogId}` };
        }
        if (result.articleUrl) {
          return { article_url: result.articleUrl };
        }
      }

      const errMsg = (result && result.error) || (result && result.raw && result.raw.msg) || "unknown";
      throw new Error(`51cto 发布失败: ${errMsg}`);
    }

    _generateAbstract(html, markdown) {
      const text = (markdown || html || "")
        .replace(/<[^>]+>/g, "")
        .replace(/[#*`>\-~\[\]()!]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return text.substring(0, 200);
    }

    /**
     * 计算要提交的标签（逗号分隔）。标签是必填项，缺失时 /blogger/publish 会失败。
     *
     * 不再往 DOM 输入框里打字：发布面板是右侧抽屉，未打开时 input 无法聚焦，
     * execCommand("insertText") 会把标签插进正文编辑器（曾导致正文被污染）。
     */
    _collectTags() {
      const tagElements = document.querySelectorAll(
        ".tab-list .tag-item, .tab-list .el-tag"
      );
      const tags = [...tagElements]
        .map((el) => el.textContent.trim().replace(/×$/, "").trim())
        .filter(Boolean);

      if (tags.length > 0) {
        return tags.slice(0, 5).join(",");
      }

      const config = this.articleData.publish_config || {};
      if (config.tags) {
        const arr = Array.isArray(config.tags)
          ? config.tags
          : config.tags.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean);
        if (arr.length > 0) return arr.slice(0, 5).join(",");
      }

      const fallback = (this.articleData.title || "").trim().substring(0, 20);
      return fallback || "技术";
    }

    /**
     * 解析当前登录用户的博客二级路径。
     *
     * 只接受单段路径的个人主页链接（如 https://blog.51cto.com/addozhang），
     * 页面上推荐文章里的 /u_15370155/14858668 这类他人文章链接会被排除——
     * 之前用宽松正则从 innerHTML 里抓，抓到的是别人的 uid，拼出的文章 URL 404。
     */
    _extract51ctoUsername() {
      const RESERVED = new Set([
        "blogger",
        "creative-center",
        "index",
        "home",
        "search",
        "topic",
        "column",
      ]);
      const links = document.querySelectorAll('a[href*="blog.51cto.com/"]');
      for (const a of links) {
        const m = (a.href || "").match(
          /^https?:\/\/blog\.51cto\.com\/([A-Za-z0-9_-]+)\/?$/
        );
        if (m && !RESERVED.has(m[1])) return m[1];
      }
      const meta = document.querySelector('meta[name="author"]');
      if (meta && meta.content) return meta.content;
      return null;
    }

    /**
     * 解析要提交的分类 ID。
     *
     * 返回空串表示「沿用 submitForm 里已有的 pid/cate_id」——那是 51CTO 记住的
     * 上次分类，比我们瞎猜一个更靠谱。分类项的 ID 在 value 属性上（不是 data-id，
     * 旧代码读 data-id 永远拿到 null）。
     */
    async _ensureCategorySelected() {
      const config = this.articleData.publish_config || {};
      if (!config.category) return "";

      const items = document.querySelectorAll(
        ".types-select-box .select_item, .types_content .select_item"
      );
      const target = [...items].find(
        (el) => el.textContent.trim() === config.category
      );
      if (!target) {
        console.warn(
          '[51cto] 分类 "' + config.category + '" 不在列表中，沿用默认分类'
        );
        return "";
      }
      log("[51cto] 选择用户配置的分类: " + config.category);
      target.click();
      await this.delay(300);
      return (
        target.getAttribute("value") ||
        target.getAttribute("data-id") ||
        target.dataset.id ||
        ""
      );
    }

    async _dismissContinuePublishDialog() {
      const dismissTexts = ["继续发布", "关闭引导", "关闭", "知道了", "我知道了", "不转换", "取消"];
      const maxWait = 3000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const btns = [...document.querySelectorAll("button, a, .btn, span, .ant-btn")];
        const target = btns.find(
          (el) =>
            el.offsetHeight > 0 &&
            dismissTexts.some((t) => el.textContent.trim() === t)
        );
        if (target) {
          log("[51cto] 关闭弹窗: " + target.textContent.trim());
          target.click();
          await this.delay(500);
          continue;
        }

        const closeIcons = document.querySelectorAll(
          ".ant-modal-close, .el-dialog__close, .close-btn, [class*=close]"
        );
        for (const icon of closeIcons) {
          if (icon.offsetHeight > 0) {
            const modal = icon.closest(".ant-modal-wrap, .el-dialog__wrapper, .modal");
            if (modal && modal.offsetHeight > 0) {
              log("[51cto] 关闭模态框");
              icon.click();
              await this.delay(500);
            }
          }
        }
        break;
      }
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async waitForElement(selector, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el && !el.disabled) return el;
        await this.delay(200);
      }
      return null;
    }
  }

  const publisher = new FiftyCtoPublisher();
  publisher.init();
})();
