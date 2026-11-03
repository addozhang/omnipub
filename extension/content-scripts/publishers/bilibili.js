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
      const input0 = await this._waitForElement(
        'textarea.title-input__inner, textarea[placeholder*="请输入标题"], input[placeholder*="请输入标题"]',
        15000
      );
      if (!input0) throw new Error("title input not found");

      // 2026-11 改版后观察到：编辑器 App 挂载早期会把受控输入重置回空值，
      // 填充后必须校验实际值，被清空则重试（等 App 初始化完成）。
      // 每次尝试都重新查询节点：Vue 重渲染可能替换 textarea 元素，
      // 旧引用仍保留旧值会造成"填充成功"的误判。
      const TITLE_SEL = 'textarea.title-input__inner, textarea[placeholder*="请输入标题"], input[placeholder*="请输入标题"]';
      for (let attempt = 1; attempt <= 5; attempt++) {
        const input = document.querySelector(TITLE_SEL) || input0;
        this._setNativeValue(input, title);
        await this.delay(800);
        const live = document.querySelector(TITLE_SEL) || input;
        if (live.value === title) {
          log(`title filled (attempt ${attempt})`);
          return;
        }
        log(`title wiped after set (attempt ${attempt}), value="${live.value}" — retrying`);
      }
      throw new Error("标题填充未生效：输入后值被编辑器重置（App 可能未完成初始化）");
    }

    async fillBody() {
      log("filling body...");
      const html = this.articleData?.html || "";
      const markdown = this.articleData?.markdown || "";
      const rawContent = html || markdown || "";

      const content = rawContent.replace(/<img[^>]*>/gi, "");

      const editor0 = await this._waitForElement(
        '.tiptap.ProseMirror, .ProseMirror, .eva3-editor, [contenteditable="true"]',
        20000
      );
      if (!editor0) throw new Error("editor not found");

      // 2026-11 改版后：粘贴的内容可能被编辑器初始化清空，必须校验重试。
      // 同 fillTitle：每次尝试重新查询编辑器节点，避免 Vue 重渲染导致引用过期。
      const BODY_SEL = '.tiptap.ProseMirror, .ProseMirror, .eva3-editor, [contenteditable="true"]';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const editor = document.querySelector(BODY_SEL) || editor0;
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

        await this.delay(1000);
        const textLen = (editor.innerText || "").trim().length;
        if (textLen > 50) {
          log(`body filled (attempt ${attempt}), textLen=${textLen}`);
          return;
        }
        log(`body empty after paste (attempt ${attempt}), textLen=${textLen} — retrying`);
      }
      throw new Error("正文填充未生效：粘贴后编辑器内容为空（可能被编辑器初始化重置）");
    }

    async afterFill() {
      // 点击前校验填充结果：空内容点击发布会被表单校验静默拦截（无 API 调用），
      // 表现为「成功点击但什么都没发生」的假阳性。
      const titleNow = ((document.querySelector('textarea.title-input__inner') || {}).value || "").trim();
      const bodyLen = (((document.querySelector('.tiptap.ProseMirror, .ProseMirror') || {}).innerText) || "").trim().length;
      log(`pre-publish check: title="${titleNow.slice(0, 20)}" bodyLen=${bodyLen}`);
      if (!titleNow || bodyLen < 50) {
        throw new Error(`填充校验失败：title="${titleNow.slice(0, 20)}" bodyLen=${bodyLen}，不执行发布`);
      }

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
      // 2026-11 改版后发布 API 也可能从编辑器 iframe 发起，父页拦截器会漏捕获。
      // 在本 frame 再装一份拦截器，两处都能捕获。
      this._installLocalInterceptor();
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
      // 2026-11 新编辑器为二段式发布：第一次点击通常只触发 draft/add 存草稿，
      // 实际发布需要草稿保存完成后的再次点击（或稍后自动继续）。
      // 策略：最多两轮点击，每轮轮询捕获/错误提示/创作列表确认。
      for (let clickRound = 1; clickRound <= 2; clickRound++) {
        btn.click();
        log(`publish button clicked (round ${clickRound})`);

        const pollTimeout = 20000;
        const pollStart = Date.now();
        let pollCount = 0;
        while (Date.now() - pollStart < pollTimeout) {
          await this.delay(500);
          pollCount++;

          // 本 frame（read-editor iframe）捕获结果
          const local = window.__bilibiliLocalCapture;
          if (local) {
            if (local.ok) {
              log("local captured article_url:", local.articleUrl);
              await this._cleanupInterceptor();
              return { article_url: local.articleUrl };
            }
            await this._cleanupInterceptor();
            throw new Error("B站发布被拒绝: " + (local.msg || ("code=" + local.code)));
          }

          // 父页面捕获结果
          const check = await chrome.runtime.sendMessage({
            action: "executeInMainWorld",
            code: "bilibili_checkFetchResult",
            args: { cleanup: false },
            targetParent: true,
          });
          if (check?.detail?.startsWith("ok:http")) {
            const articleUrl = check.detail.substring(3);
            log("article_url (parent):", articleUrl);
            await this._cleanupInterceptor();
            return { article_url: articleUrl };
          }

          // 编辑器内可见的错误提示（表单校验/平台拒绝）
          const tip = this._readErrorTip();
          if (tip) {
            await this._cleanupInterceptor();
            throw new Error("B站发布失败: " + tip);
          }

          // 发布实际完成可能晚于拦截窗口（二段式），定期查创作列表确认
          if (pollCount % 8 === 0) {
            const foundUrl = await this._checkCreationList();
            if (foundUrl) {
              log("confirmed via creation list:", foundUrl);
              await this._cleanupInterceptor();
              return { article_url: foundUrl };
            }
          }
        }

        if (clickRound < 2) {
          log("round 1 produced no publish API — draft likely saved, clicking again...");
          // 草稿保存后按钮状态可能变化，重新查找
          btn = null;
          const retryStart = Date.now();
          while (Date.now() - retryStart < 8000 && !btn) {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && !el.disabled && el.offsetHeight > 0 && /发布/.test(el.textContent)) { btn = el; break; }
            }
            if (!btn) await this.delay(300);
          }
          if (!btn) break;
        }
      }

      // 最终兜底：发布完成可能晚于轮询窗口（二段式延迟），最后查一次创作列表
      log("final fallback — poll opus creation list to confirm publish...");
      const verifyStart = Date.now();
      while (Date.now() - verifyStart < 45000) {
        await this.delay(5000);
        const foundUrl = await this._checkCreationList();
        if (foundUrl) {
          log("confirmed via creation list:", foundUrl);
          await this._cleanupInterceptor();
          return { article_url: foundUrl };
        }
        const tip = this._readErrorTip();
        if (tip) {
          await this._cleanupInterceptor();
          throw new Error("B站发布失败: " + tip);
        }
      }

      await this._cleanupInterceptor();
      // 确认不到发布结果：绝不能按成功上报（假阳性），也不猜测状态。
      throw new Error("发布未确认：未捕获到发布 API 响应，创作列表中也未找到本文（请人工核对图文管理）");
    }

    /**
     * 兜底确认：查创作列表 API 是否出现本文（标题匹配 + 当天发布）。
     * 仅匹配当天的记录，避免重发场景误判到历史文章。
     */
    async _checkCreationList() {
      try {
        const r = await fetch(
          "https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/creationlist?ps=5&pn=1&classification_type=0&creation_type=0",
          { credentials: "include" }
        );
        const j = await r.json();
        const items = (j.data && (j.data.items || j.data.list)) || [];
        const title = this.articleData?.title || "";
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const todayPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        for (const it of items) {
          if ((it.title || "") === title && String(it.pub_time || "").startsWith(todayPrefix)) {
            const rid = it.rid || it.dyn_id;
            return rid ? "https://www.bilibili.com/read/cv" + rid : null;
          }
        }
      } catch { /* 网络异常时继续重试 */ }
      return null;
    }

    /**
     * 在本 frame 安装 fetch 拦截器，捕获发布 API 响应（含错误码）。
     * 新版编辑器的发布请求从 iframe 发起，父页拦截器捕获不到。
     */
    _installLocalInterceptor() {
      if (window.__bilibiliLocalInterceptor) return;
      const PUBLISH_URLS = ["/x/dynamic/feed/create/opus", "/x/article/creative/article/submit"];
      const origFetch = window.fetch;
      window.__bilibiliOrigFetch = origFetch;
      window.__bilibiliLocalCapture = null;
      window.fetch = async function (...fetchArgs) {
        const response = await origFetch.apply(this, fetchArgs);
        const url = typeof fetchArgs[0] === "string" ? fetchArgs[0] : fetchArgs[0]?.url;
        if (url && PUBLISH_URLS.some((u) => url.includes(u))) {
          const clone = response.clone();
          try {
            const json = await clone.json();
            const articleId = json.data?.dyn_rid || json.data?.aid;
            window.__bilibiliLocalCapture = {
              ok: json.code === 0 && !!articleId,
              code: json.code,
              msg: json.message || json.msg || "",
              articleUrl: articleId ? "https://www.bilibili.com/read/cv" + articleId : null,
            };
          } catch { window.__bilibiliLocalCapture = { ok: false, code: -1, msg: "响应解析失败" }; }
        }
        return response;
      };
      window.__bilibiliLocalInterceptor = true;
    }

    /** 读取编辑器内可见的错误提示（toast/tip），没有则返回 null。
     * 注意排除中性提示（自动保存等），只认真正的错误文案，避免误判。 */
    _readErrorTip() {
      const NEUTRAL = /(成功|保存|自动|加载|处理中|同步|上传中)/;
      const nodes = document.querySelectorAll(
        "[class*='toast'], [class*='message-tip'], [class*='error-tip'], [class*='vui-toast']"
      );
      for (const n of nodes) {
        if (n.offsetHeight > 0) {
          const text = (n.innerText || "").replace(/\s+/g, " ").trim();
          if (text && text.length > 2 && text.length < 120 && !NEUTRAL.test(text)) return text;
        }
      }
      return null;
    }

    async _cleanupInterceptor() {
      // 清理本 frame 的拦截器
      if (window.__bilibiliLocalInterceptor && window.__bilibiliOrigFetch) {
        window.fetch = window.__bilibiliOrigFetch;
        delete window.__bilibiliOrigFetch;
        delete window.__bilibiliLocalCapture;
        delete window.__bilibiliLocalInterceptor;
      }
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
