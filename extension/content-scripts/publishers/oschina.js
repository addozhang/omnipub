(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class OschinaPublisher extends window.BasePublisher {
    constructor() {
      super("oschina");
      this.publishSelectors = [".ant-btn.ant-btn-primary", "button.publish-btn"];
    }

    /**
     * beforeFill: 关闭 AI 写作引导 drawer，然后切换到 Markdown 编辑器。
     *
     * OSCHINA 编辑器默认加载 HTML 编辑器（ProseMirror/TipTap），通过 Ant Tabs
     * 切换到 Markdown 编辑器可以直接填充 markdown 原文，代码块渲染更准确。
     *
     * 切换方式：点击 `.ant-tabs-tab-btn` 中文本为 "Markdown" 的 tab。
     */
    async beforeFill() {
      log("[oschina] beforeFill: 关闭引导 + 切换到 Markdown 编辑器");

      await this.delay(1000);

      // --- 1. 关闭 AI 写作引导 drawer ---
      const drawer = document.querySelector(".ant-drawer");
      if (drawer && drawer.classList.contains("ant-drawer-open")) {
        log("[oschina] 检测到全文写作引导 drawer (ant-drawer-open)");

        const closeTargets = [
          drawer.querySelector("button.ant-drawer-close"),
          drawer.querySelector(".ant-drawer-close"),
          document.querySelector("span.close-guide, .close-guide"),
        ].filter(Boolean);

        for (const target of closeTargets) {
          log(
            `[oschina] 点击关闭: ${target.tagName}.${target.className || ""}`
          );
          target.click();
          await this.delay(1500);

          if (!drawer.classList.contains("ant-drawer-open")) {
            log("[oschina] drawer 已关闭 (ant-drawer-open removed)");
            break;
          }
        }

        await this.delay(500);

        if (drawer.classList.contains("ant-drawer-open")) {
          log("[oschina] drawer 仍然可见，强制隐藏");
          drawer.style.display = "none";
          drawer.style.visibility = "hidden";
          drawer.style.pointerEvents = "none";
          const mask = document.querySelector(".ant-drawer-mask");
          if (mask) mask.style.display = "none";
          await this.delay(300);
        }
      }

      // --- 2. 切换到 Markdown 编辑器 tab ---
      const mdTab = this._findTabByText("Markdown");
      if (mdTab) {
        // 检查是否已经是 Markdown tab（active 状态）
        const parentTab = mdTab.closest(".ant-tabs-tab");
        if (parentTab && parentTab.classList.contains("ant-tabs-tab-active")) {
          log("[oschina] 已在 Markdown 编辑器模式");
        } else {
          log("[oschina] 点击切换到 Markdown 编辑器");
          mdTab.click();
          await this.delay(2000);
        }
        this._useMdEditor = true;
      } else {
        log("[oschina] 未找到 Markdown tab，使用 ProseMirror 模式");
        this._useMdEditor = false;
      }
    }

    async fillTitle() {
      const titleInput = await this.waitForElement(
        'input.title-input, input[placeholder*="标题"], input[placeholder*="请输入"]',
        15000
      );
      if (!titleInput) {
        throw new Error("未找到 OSCHINA 标题输入框");
      }

      const title = this.articleData?.title || "";

      titleInput.focus();
      titleInput.select();

      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(titleInput, title);
      } else {
        titleInput.value = title;
      }
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));

      await this.delay(300);
      log("[oschina] 标题填充完成: " + titleInput.value.substring(0, 30));
    }

    async fillBody() {
      const markdown = this.articleData?.markdown || "";

      if (this._useMdEditor) {
        // Markdown 编辑器模式：直接填充 textarea
        await this._fillMdTextarea(markdown);
      } else {
        // ProseMirror 模式：通过剪贴板粘贴 HTML
        await this._fillProseMirror(markdown);
      }
    }

    /**
     * Markdown 编辑器模式：查找 textarea 并填充 markdown 原文
     */
    async _fillMdTextarea(markdown) {
      let textarea = null;
      for (let i = 0; i < 15; i++) {
        textarea = document.querySelector("textarea");
        if (textarea) break;
        await this.delay(300);
      }

      if (!textarea) {
        log("[oschina] 未找到 textarea，降级到 ProseMirror 模式");
        await this._fillProseMirror(markdown);
        return;
      }

      this._setNativeInputValue(textarea, markdown);
      await this.delay(300);
      log("[oschina] Markdown 正文填充完成, 长度: " + markdown.length);
    }

    /**
     * ProseMirror 模式（降级）：通过剪贴板事件粘贴 HTML 内容
     *
     * 关键：不能先 innerHTML="" 清空——这会破坏 ProseMirror 内部 EditorState，
     * 导致后续 paste 事件被静默忽略。正确做法是 selectAll 后再粘贴覆盖。
     */
    async _fillProseMirror(markdown) {
      const editor =
        document.querySelector(".ProseMirror") ||
        document.querySelector(".tiptap") ||
        document.querySelector('[contenteditable="true"]');

      if (!editor) {
        throw new Error("未找到 OSCHINA ProseMirror 编辑器");
      }

      // 优先使用后端已转换的 HTML，降级到手写转换
      const htmlContent =
        (this.articleData && this.articleData.html) ||
        this._markdownToSimpleHtml(markdown);

      // 聚焦编辑器
      editor.focus();
      await this.delay(200);

      // 策略 1：selectAll + 剪贴板粘贴 — ProseMirror/TipTap 最可靠的方式
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);

        const dt = new DataTransfer();
        dt.setData("text/html", htmlContent);
        dt.setData("text/plain", markdown);

        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });

        editor.dispatchEvent(pasteEvent);
        await this.delay(500);

        if (editor.textContent && editor.textContent.length > 10) {
          log("[oschina] ProseMirror 剪贴板粘贴成功");
          return;
        }
      } catch (e) {
        log("[oschina] ProseMirror 剪贴板粘贴失败:", e.message);
      }

      // 策略 2：execCommand insertHTML
      try {
        editor.focus();
        document.execCommand("selectAll");
        const result = document.execCommand("insertHTML", false, htmlContent);
        if (result && editor.textContent && editor.textContent.length > 10) {
          log("[oschina] execCommand insertHTML 成功");
          return;
        }
      } catch (e) {
        log("[oschina] execCommand 失败:", e.message);
      }

      // 策略 3：innerHTML + compositionend 强制 PM 重新同步 DOM→State
      try {
        editor.innerHTML = htmlContent;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: editor.innerText,
          })
        );
        document.dispatchEvent(new Event("selectionchange"));
        await this.delay(150);
        editor.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        await this.delay(100);
        editor.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
        log("[oschina] innerHTML + compositionend 兜底填充完成");
      } catch (e) {
        console.warn("[oschina] 所有填充策略均失败:", e.message);
      }
    }

    /**
     * 简单的 markdown 转 HTML（用于粘贴到 ProseMirror 的降级方案）
     */
    _markdownToSimpleHtml(markdown) {
      return markdown
        .split("\n\n")
        .map((block) => {
          block = block.trim();
          if (!block) return "";

          // 标题
          const headingMatch = block.match(/^(#{1,6})\s+(.+)$/m);
          if (headingMatch) {
            const level = headingMatch[1].length;
            return `<h${level}>${headingMatch[2]}</h${level}>`;
          }

          // 代码块
          if (block.startsWith("```")) {
            const lines = block.split("\n");
            const lang = lines[0].replace("```", "").trim();
            const code = lines.slice(1, -1).join("\n");
            return `<pre><code class="language-${lang || "text"}">${code.replace(/</g, "&lt;")}</code></pre>`;
          }

          // 列表
          if (/^[-*]\s/.test(block)) {
            const items = block
              .split("\n")
              .filter((l) => /^[-*]\s/.test(l))
              .map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`)
              .join("");
            return `<ul>${items}</ul>`;
          }

          // 有序列表
          if (/^\d+\.\s/.test(block)) {
            const items = block
              .split("\n")
              .filter((l) => /^\d+\.\s/.test(l))
              .map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`)
              .join("");
            return `<ol>${items}</ol>`;
          }

          // 普通段落
          return `<p>${block.replace(/\n/g, "<br>")}</p>`;
        })
        .filter(Boolean)
        .join("");
    }

    /**
     * 使用 native setter 设置 input/textarea 值
     */
    _setNativeInputValue(element, value) {
      const proto = Object.getPrototypeOf(element);
      const descriptor =
        Object.getOwnPropertyDescriptor(proto, "value") ||
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ||
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");

      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("keyup", { bubbles: true }));
    }

    async fillPublishConfig(config) {
      if (config.tags && config.tags.length > 0) {
        try {
          log(`[oschina] 填充标签: ${config.tags.join(", ")}`);
          const tagInput = document.querySelector(
            '.ant-select-search__field, .ant-select-selection-search-input, input[placeholder*="标签"], input[placeholder*="添加标签"]'
          );
          if (!tagInput) {
            console.warn("[oschina] 未找到标签输入框");
            return;
          }
          for (const tag of config.tags.slice(0, 5)) {
            tagInput.focus();
            tagInput.value = tag;
            tagInput.dispatchEvent(new Event("input", { bubbles: true }));
            await this.delay(800);
            const suggestion = document.querySelector(
              ".ant-select-dropdown-menu-item, .ant-select-item, .ant-select-item-option"
            );
            if (suggestion && suggestion.textContent.includes(tag)) {
              suggestion.click();
            } else {
              tagInput.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
              );
            }
            await this.delay(400);
          }
        } catch (e) {
          console.warn(`[oschina] 填充标签失败:`, e.message);
        }
      }
    }

    /**
     * E-7: Resolve the current user's numeric UID using three strategies in order:
     *   1. Current URL pathname (/u/{uid}/blog/write)
     *   2. DOM elements that embed the UID (data attributes, links)
     *   3. OSChina user-info API (GET /action/apiv2/user/myself)
     *
     * Using a dedicated method instead of an inline regex makes each strategy
     * testable and adds graceful fallbacks.
     */
    async _resolveUid() {
      // Strategy 1: URL pathname
      const urlMatch = location.pathname.match(/\/u\/(\d+)/);
      if (urlMatch) {
        log(`[oschina] UID from URL: ${urlMatch[1]}`);
        return urlMatch[1];
      }

      // Strategy 2: DOM — look for links/data-attributes that embed the UID
      const domCandidates = [
        // User avatar or profile links often contain /u/{uid}
        document.querySelector('a[href*="/u/"]'),
        document.querySelector('[data-uid]'),
      ];
      for (const el of domCandidates) {
        if (!el) continue;
        const href = el.getAttribute("href") || "";
        const dataUid = el.getAttribute("data-uid");
        if (dataUid && /^\d+$/.test(dataUid)) {
          log(`[oschina] UID from DOM data-uid: ${dataUid}`);
          return dataUid;
        }
        const hrefMatch = href.match(/\/u\/(\d+)/);
        if (hrefMatch) {
          log(`[oschina] UID from DOM href: ${hrefMatch[1]}`);
          return hrefMatch[1];
        }
      }

      // Strategy 3: OSChina user-info API (authenticated, same origin context)
      try {
        const resp = await fetch(
          "https://www.oschina.net/action/apiv2/user/myself?dataType=json",
          { credentials: "include" }
        );
        if (resp.ok) {
          const json = await resp.json();
          const apiUid = json?.uid || json?.id || json?.data?.uid || json?.data?.id;
          if (apiUid) {
            log(`[oschina] UID from API: ${apiUid}`);
            return String(apiUid);
          }
        }
      } catch (e) {
        log(`[oschina] UID API fallback failed: ${e.message}`);
      }

      return null;
    }

    /**
     * afterFill: 直接调用 OSCHINA 发布 API。
     *
     * OSCHINA 的"发布文章"按钮使用 Ant Design Popconfirm 组件，但在扩展自动化环境下
     * Popconfirm 不渲染内容（Trigger portal 内为空 <!---->）。
     *
     * 解决方案：直接调用 postAction API（与 Popconfirm 的 onConfirm 回调逻辑一致）。
     *
     * API: POST https://apiv1.oschina.net/oschinapi/blog/web/add
     * Auth: Cookie (withCredentials: true, oscid cookie)
     * Payload: { title, content, contentType, type, user, privacy, disableComment, catalog }
     *   - contentType: 0=HTML, 1=Markdown
     * Success: { code: 200, result: blogId }
     */
    async afterFill() {
      log("[oschina] 使用直接 API 调用发布...");

      const API_BASE = "https://apiv1.oschina.net/oschinapi";

      let content;
      let contentType;

      if (this._useMdEditor) {
        // Markdown 模式：从 textarea 获取 markdown 原文
        const textarea = document.querySelector("textarea");
        content = textarea?.value || this.articleData?.markdown || "";
        contentType = 1; // 1=Markdown
        log("[oschina] 使用 Markdown 模式提交, 内容长度: " + content.length);
      } else {
        // HTML 模式（降级）：从 ProseMirror 获取 HTML
        const editor =
          document.querySelector(".ProseMirror") ||
          document.querySelector(".tiptap") ||
          document.querySelector('[contenteditable="true"]');

        if (!editor) {
          throw new Error("未找到编辑器，无法获取内容");
        }

        content = editor.innerHTML;
        contentType = 0; // 0=HTML
        log("[oschina] 使用 HTML 模式提交, 内容长度: " + content.length);
      }

      if (!content || content.trim().length < 10) {
        throw new Error("编辑器内容为空或过短");
      }

      // 从 DOM 获取标题
      const titleInput = document.querySelector(
        'input.title-input, input[placeholder*="标题"]'
      );
      // E-7: Prefer articleData.title (captured before fill) so we don't depend on
      // live DOM which may differ from what was actually sent to the API.
      const title = this.articleData?.title || titleInput?.value || "";
      if (!title.trim()) {
        throw new Error("标题为空");
      }

      // E-7: Multi-strategy UID extraction (URL → DOM → API).
      // afterFill() always runs on /u/{uid}/blog/write, but we add DOM and API
      // fallbacks to guard against edge-case redirect races.
      const uid = await this._resolveUid();
      if (!uid) {
        throw new Error("无法获取用户 UID（URL/DOM/API 均失败）");
      }

      const payload = {
        title: title.trim(),
        content: content,
        contentType: contentType,
        type: "1", // 原创
        originUrl: "",
        catalog: 0,
        privacy: true, // "是否公开" checkbox: true=公开, false=私密
        disableComment: false, // "是否禁用评论" checkbox: true=禁用, false=允许
        user: uid,
      };

      log("[oschina] API 发布参数:", JSON.stringify({
        title: payload.title.substring(0, 30),
        contentLen: payload.content.length,
        contentType: payload.contentType,
        uid: payload.user,
      }));

      try {
        const resp = await fetch(API_BASE + "/blog/web/add", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`API 返回 ${resp.status}: ${text.substring(0, 200)}`);
        }

        const data = await resp.json();

        if (data.code === 200 && data.result) {
          const blogId = data.result;
          const blogUrl = `https://my.oschina.net/u/${uid}/blog/${blogId}`;
          log(`[oschina] 发布成功! blogId=${blogId}, URL=${blogUrl}`);
          return { article_url: blogUrl };
        } else {
          throw new Error(
            `API 返回错误: code=${data.code}, message=${data.message || "unknown"}`
          );
        }
      } catch (e) {
        if (e.message.startsWith("API 返回")) {
          throw e;
        }
        throw new Error(`OSCHINA 发布 API 调用失败: ${e.message}`);
      }
    }

    /**
     * 在 Ant Tabs 中查找指定文本的 tab 按钮
     */
    _findTabByText(text) {
      const tabs = document.querySelectorAll(".ant-tabs-tab-btn");
      for (const tab of tabs) {
        if (tab.textContent.trim() === text) return tab;
      }
      return null;
    }

    findElementByText(selector, text) {
      const elements = document.querySelectorAll(selector);
      return (
        [...elements].find((el) => (el.textContent || "").includes(text)) ||
        null
      );
    }

    async waitForTextButton(text, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const btn = [...document.querySelectorAll("button, .ant-btn")].find(
          (el) => {
            const content = (el.textContent || "").trim();
            return content.includes(text) && !el.disabled;
          }
        );
        if (btn) return btn;
        await this.delay(200);
      }
      return null;
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

  const publisher = new OschinaPublisher();
  publisher.init();
})();
