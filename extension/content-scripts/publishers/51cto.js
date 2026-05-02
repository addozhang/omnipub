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

      const input = await this.waitForElement(
        "input.ant-input.editor-title, input.editor-title",
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

      const editor = document.querySelector(
        ".editor-container[contenteditable=true], [contenteditable=true].am-engine"
      );
      if (!editor) {
        console.warn("[51cto] 未找到 contenteditable 编辑器");
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

      // Force-show the publish panel via DOM so we can read category and fill tags.
      // We do NOT click .edit-submit (its jQuery handler validates $data.form.title
      // which is closure-scoped and cannot be set from content scripts).
      await this._forceShowPublishPanel();
      await this.delay(800);

      await this._dismissContinuePublishDialog();
      const categoryId = await this._ensureCategorySelected();
      const tagStr = await this._collectTags();

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

      if (result && result.status === 1 && (result.did || result.articleUrl)) {
        log("[51cto] 发布成功, did=" + result.did);
        const username = this._extract51ctoUsername();
        const articleId = result.did || (result.articleUrl && result.articleUrl.match(/\/(\d+)\/?$/)?.[1]);
        if (articleId && username) {
          return { article_url: `https://blog.51cto.com/${username}/${articleId}` };
        }
        if (result.articleUrl) {
          return { article_url: result.articleUrl };
        }
        const base = username
          ? `https://blog.51cto.com/${username}/${articleId || 0}`
          : `https://blog.51cto.com/u_0/${articleId || 0}`;
        return { article_url: base };
      }

      const errMsg = (result && result.error) || (result && result.raw && result.raw.msg) || "unknown";
      throw new Error(`51cto 发布失败: ${errMsg}`);
    }

    async _forceShowPublishPanel() {
      const panel = document.querySelector(".editor-dialog__wrapper");
      if (panel) {
        panel.style.display = "block";
        panel.style.visibility = "visible";
        panel.style.opacity = "1";
      }
    }

    _generateAbstract(html, markdown) {
      const text = (markdown || html || "")
        .replace(/<[^>]+>/g, "")
        .replace(/[#*`>\-~\[\]()!]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return text.substring(0, 200);
    }

    async _collectTags() {
      await this._fillTags();
      await this.delay(300);

      const tagElements = document.querySelectorAll(
        ".tab-list .tag-item, .tab-list .el-tag"
      );
      const tags = [...tagElements]
        .map((el) => el.textContent.trim().replace(/×$/, "").trim())
        .filter(Boolean);

      if (tags.length > 0) {
        return tags.join(",");
      }

      const config = this.articleData.publish_config || {};
      if (config.tags) {
        const arr = Array.isArray(config.tags)
          ? config.tags
          : config.tags.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean);
        if (arr.length > 0) return arr.join(",");
      }

      const fallback = (this.articleData.title || "").trim().substring(0, 20);
      return fallback || "技术";
    }

    _extract51ctoUsername() {
      const meta = document.querySelector('meta[name="author"]');
      if (meta && meta.content) return meta.content;
      const link = document.querySelector('a[href*="blog.51cto.com/"][href*="/u"]');
      if (link) {
        const m = link.href.match(/blog\.51cto\.com\/([^/]+)/);
        if (m) return m[1];
      }
      const bodyText = document.body?.innerHTML || "";
      const m = bodyText.match(/blog\.51cto\.com\/([a-zA-Z0-9_]+)\//);
      if (m) return m[1];
      return null;
    }

    async _ensureCategorySelected() {
      const config = this.articleData.publish_config || {};

      if (config.category) {
        log("[51cto] 选择用户配置的分类: " + config.category);
        const items = document.querySelectorAll(
          ".types-select-box .select_item, .types_content .select_item"
        );
        const target = [...items].find(
          (el) => el.textContent.trim() === config.category
        );
        if (target) {
          target.click();
          await this.delay(300);
          return target.getAttribute("data-id") || target.dataset.id || "";
        }
        console.warn(
          '[51cto] 分类 "' + config.category + '" 不在列表中，使用默认'
        );
      }

      const checked = document.querySelector(".select_item_check");
      if (checked) {
        log("[51cto] 已有默认分类: " + checked.textContent.trim());
        return checked.getAttribute("data-id") || checked.dataset.id || "";
      }

      const firstItem = document.querySelector(
        ".types-select-box .select_item, .types_content .select_item"
      );
      if (firstItem) {
        log(
          "[51cto] 无默认分类，选择第一个: " + firstItem.textContent.trim()
        );
        firstItem.click();
        await this.delay(300);
        return firstItem.getAttribute("data-id") || firstItem.dataset.id || "";
      }
      return "";
    }

    /**
     * Fill tags in the publish panel. Tags are mandatory — without them,
     * clicking "发布" silently fails and only saves as draft.
     *
     * Reads from publish_config.tags (array or comma-separated string),
     * falls back to article title (truncated to 20 chars).
     */
    async _fillTags() {
      // Check if tags already exist (e.g. re-publish scenario)
      const existingTags = document.querySelectorAll(
        ".tab-list .tag-item, .tab-list .el-tag"
      );
      if (existingTags.length > 0) {
        log("[51cto] 已有 " + existingTags.length + " 个标签，跳过填写");
        return;
      }

      const config = this.articleData.publish_config || {};
      let tags = [];

      if (config.tags) {
        if (Array.isArray(config.tags)) {
          tags = config.tags;
        } else if (typeof config.tags === "string" && config.tags.trim()) {
          tags = config.tags
            .split(/[,，;；]/)
            .map((t) => t.trim())
            .filter(Boolean);
        }
      }

      // Fallback: use article title as tag
      if (tags.length === 0) {
        const title = (this.articleData.title || "").trim();
        if (title) {
          tags = [title.substring(0, 20)];
          log(
            '[51cto] 未配置标签，使用文章标题作为默认标签: "' + tags[0] + '"'
          );
        }
      }

      if (tags.length === 0) {
        console.warn("[51cto] 无法生成标签，发布可能失败");
        return;
      }

      const tagInput = document.querySelector(
        'input.tag-paper, input[placeholder*="标签"]'
      );
      if (!tagInput) {
        console.warn("[51cto] 未找到标签输入框");
        return;
      }

      for (const tag of tags.slice(0, 5)) {
        log('[51cto] 填写标签: "' + tag + '"');
        tagInput.focus();
        tagInput.select();
        document.execCommand("delete");

        // Use execCommand insertText — native setter doesn't trigger
        // Vue's reactivity on this input, but execCommand does
        document.execCommand("insertText", false, tag);
        await this.delay(300);

        // Press Enter to confirm the tag
        tagInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
        await this.delay(300);
      }

      log("[51cto] 已填写 " + Math.min(tags.length, 5) + " 个标签");
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
