/**
 * bilibili.js — 哔哩哔哩专栏适配器
 *
 * B站专栏编辑器（2026-03）：
 *   主页面: member.bilibili.com/platform/upload/text/new-edit
 *   编辑器 iframe: member.bilibili.com/york/read-editor?...
 *   标题：textarea.title-input__inner (maxlength=50)
 *   编辑器：TipTap/ProseMirror (.tiptap.ProseMirror.eva3-editor, contenteditable)
 *   发布按钮：.vui_button.vui_button--blue ("发布") — 在 iframe 内
 *   UI 组件库：vui_* (B站自研)
 *
 * manifest.json 中 all_frames: true，content script 会注入到主页面和 iframe。
 * 只在 iframe（york/read-editor）中初始化 publisher，主页面跳过。
 *
 * 注意：外部 <img> 标签会导致 B站专栏 API 静默阻止提交，需要剥离。
 *
 * 登录 Cookie：SESSDATA
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[bilibili]", ...args);

  if (!window.location.href.includes("york/read-editor")) {
    log("skip — not in editor iframe");
    return;
  }

  class BilibiliPublisher extends BasePublisher {
    constructor() {
      super("bilibili");
      this.publishSelectors = [".vui_button.vui_button--blue"];
    }

    async fillTitle() {
      log("filling title...");
      const title = this.articleData?.title || "";
      const input = await this._waitForElement(
        'textarea.title-input__inner, textarea[placeholder*="请输入标题"], input[placeholder*="请输入标题"]',
        15000
      );
      if (!input) throw new Error("title input not found");

      this._setNativeValue(input, title);
      log("title filled:", title);
    }

    async fillBody() {
      log("filling body...");
      const html = this.articleData?.html || "";
      const markdown = this.articleData?.markdown || "";
      const rawContent = html || markdown || "";

      const content = rawContent.replace(/<img[^>]*>/gi, "");

      const editor = await this._waitForElement(
        '.tiptap.ProseMirror, .ProseMirror, .eva3-editor, [contenteditable="true"]',
        20000
      );
      if (!editor) throw new Error("editor not found");

      editor.focus();
      await this.delay(300);

      const pasted = await this._clipboardPaste(editor, content);
      if (!pasted) {
        log("clipboard paste failed, trying execCommand...");
        document.execCommand("selectAll");
        const ok = document.execCommand("insertHTML", false, content);
        if (!ok) {
          log("execCommand failed, innerHTML fallback...");
          editor.innerHTML = content;
          editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }
      }

      log("body filled");
    }

    async afterFill() {
      // The publish API call (/x/dynamic/feed/create/opus) is made from the
      // PARENT page, not the editor iframe. The fetch interceptor must be
      // installed in the parent frame via targetParent: true.
      log("step 1: install fetch interceptor in parent page...");
      const installResult = await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "bilibili_installFetchInterceptor",
        targetParent: true,
      });
      if (!installResult?.success) {
        throw new Error("failed to install fetch interceptor: " + (installResult?.error || "unknown"));
      }

      log("step 2: click publish button in iframe...");
      const selectors = [".vui_button.vui_button--blue", "button.submit-btn", "button.pub-btn"];
      let btn = null;
      const btnTimeout = 10000;
      const start = Date.now();
      while (Date.now() - start < btnTimeout && !btn) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && !el.disabled && el.offsetHeight > 0 && /发布/.test(el.textContent)) {
            btn = el;
            break;
          }
        }
        if (!btn) {
          const allBtns = [...document.querySelectorAll("button")];
          btn = allBtns.find(el => !el.disabled && el.offsetHeight > 0 && /^发布$/.test(el.textContent.trim())) || null;
        }
        if (!btn) await this.delay(300);
      }
      if (!btn) {
        await this._cleanupInterceptor();
        throw new Error("publish button not found");
      }
      btn.click();
      log("publish button clicked");

      log("step 3: poll parent page for captured URL...");
      const pollTimeout = 15000;
      const pollStart = Date.now();
      while (Date.now() - pollStart < pollTimeout) {
        await this.delay(500);
        const check = await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "bilibili_checkFetchResult",
          args: { cleanup: false },
          targetParent: true,
        });
        if (check?.detail?.startsWith("ok:http")) {
          const articleUrl = check.detail.substring(3);
          log("article_url:", articleUrl);
          await this._cleanupInterceptor();
          return { article_url: articleUrl };
        }
      }

      await this._cleanupInterceptor();
      log("published but no article_url captured");
      return null;
    }

    async _cleanupInterceptor() {
      try {
        await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "bilibili_checkFetchResult",
          args: { cleanup: true },
          targetParent: true,
        });
      } catch { /* best-effort cleanup */ }
    }

    async _clipboardPaste(editor, html) {
      try {
        editor.focus();
        document.execCommand("selectAll");
        await this.delay(100);

        const dt = new DataTransfer();
        dt.setData("text/html", html);
        dt.setData("text/plain", html.replace(/<[^>]+>/g, ""));

        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });

        editor.dispatchEvent(pasteEvent);
        await this.delay(500);

        const textContent = editor.textContent || "";
        if (textContent.trim().length > 0) {
          log("clipboard paste succeeded");
          return true;
        }

        log("clipboard paste resulted in empty content");
        return false;
      } catch (e) {
        log("clipboard paste error:", e.message);
        return false;
      }
    }

    async _waitForElement(selector, timeout) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el && el.offsetHeight > 0) return el;
        await this.delay(300);
      }
      return null;
    }

    _setNativeValue(el, value) {
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    delay(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }
  }

  const publisher = new BilibiliPublisher();
  publisher.init();
})();
