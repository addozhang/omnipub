/**
 * toutiao.js — 今日头条适配器
 *
 * 头条使用 Syllepsis（基于 ProseMirror）富文本编辑器。
 * 标题区域是 contenteditable div（.publish-editor-title）。
 *
 * 发布流程：
 *   0. 上传外部图片到头条 CDN（解决 error 7112 图片校验失败）
 *   1. 等待草稿自动保存成功（"草稿已保存"）
 *   2. 关闭可能遮挡的 AI 助手面板
 *   3. 点击"预览并发布"按钮
 *   4. 等待按钮文字变为"确认发布"或直接发布成功
 *   5. 如果按钮点击无效，降级使用 HTTP API 直接发布
 *
 * UI 组件库：ByteDesign (byte- 前缀)
 *
 * 图片上传 API（fallback chain）：
 *   1. POST /tools/catch_picture/ — URL-based server-side fetch（头条服务端下载图片）
 *   2. POST /mp/agw/article_material/photo/upload_picture — Binary blob upload
 *   参考：loks666/blogSync (Wechatsync)、chemany/toutiao_mcp_server
 *
 * 发布 API（备用）：
 *   POST https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article
 *   参考：blogSync/Wechatsync 项目 (loks666/blogSync)
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[toutiao]", ...args);

  /** 头条 CDN 域名 — 已上传的图片 URL 以此开头，无需重复上传 */
  const TOUTIAO_CDN_HOSTS = [
    "p1.toutiaoimg.com",
    "p3.toutiaoimg.com",
    "p6.toutiaoimg.com",
    "p9.toutiaoimg.com",
    "p26.toutiaoimg.com",
    "sf1-cdn-tos.toutiaostatic.com",
    "sf3-cdn-tos.toutiaostatic.com",
    "sf6-cdn-tos.toutiaostatic.com",
    "lf3-cdn-tos.bytescm.com",
  ];

  /** 图片上传最大并发数 */
  const MAX_IMAGE_UPLOAD_CONCURRENT = 3;

  /** 单张图片上传超时（毫秒） */
  const IMAGE_UPLOAD_TIMEOUT = 30000;

  /** 头条标题字数上限（2-30 字） */
  const MAX_TITLE_LENGTH = 30;

  class ToutiaoPublisher extends BasePublisher {
    constructor() {
      super("toutiao");
      this.publishSelectors = [".byte-btn-primary.publish-btn"];
      // E-6: Ensure only one publish path (button OR API) fires per invocation.
      this._publishAttempted = false;
    }

    // ----------------------------------------------------------
    // beforeFill — 在内容填充前上传外部图片到头条 CDN
    // ----------------------------------------------------------

    async beforeFill() {
      await this._uploadImages();
    }

    /**
     * 填充标题 — 头条标题是 .publish-editor-title 内的 textarea
     * 注意：.publish-editor-title 本身是外层 div，不能直接填充
     */
    async fillTitle() {
      const selectors = [
        '.publish-editor-title textarea[placeholder*="标题"]',
        '.publish-editor-title textarea',
        'textarea[placeholder*="标题"]',
        ".publish-editor-title [contenteditable]",
        '[data-placeholder*="标题"]',
        ".article-title-input",
      ];

      let titleEl = null;
      for (const sel of selectors) {
        titleEl = document.querySelector(sel);
        if (titleEl) break;
      }

      if (!titleEl) {
        titleEl = await this.waitForElement(selectors[0], 10000);
      }

      if (!titleEl) {
        throw new Error("[toutiao] 未找到标题输入框");
      }

      let title = this.articleData?.title || "";

      if (title.length > MAX_TITLE_LENGTH) {
        title = this._truncateTitle(title, MAX_TITLE_LENGTH);
        log(`标题超限(${this.articleData.title.length}字), 截断为(${title.length}字): "${title}"`);
      }
      log(`填充标题: "${title}"`);

      titleEl.focus();
      await this.delay(100);

      if (titleEl.tagName === "INPUT" || titleEl.tagName === "TEXTAREA") {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          titleEl.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        if (nativeSetter) nativeSetter.call(titleEl, title);
        else titleEl.value = title;
        titleEl.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        titleEl.textContent = title;
        titleEl.dispatchEvent(new Event("input", { bubbles: true }));
        titleEl.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await this.delay(300);
      log(`标题填充完成`);
    }

    _truncateTitle(title, maxLen) {
      // 优先在标点符号处截断：——、：、:、，、—、｜、|、-
      const breakPoints = ["——", "：", ":", "，", "—", "｜", "|", " - "];
      const minKeep = Math.floor(maxLen * 0.5);

      for (const bp of breakPoints) {
        let searchFrom = maxLen;
        while (searchFrom > 0) {
          const idx = title.lastIndexOf(bp, searchFrom);
          if (idx <= 0) break;
          const candidate = title.substring(0, idx).trimEnd();
          if (candidate.length >= minKeep && candidate.length <= maxLen) return candidate;
          searchFrom = idx - 1;
        }
      }

      let cut = title.substring(0, maxLen);
      const lastSpace = cut.lastIndexOf(" ");
      if (lastSpace > minKeep) cut = cut.substring(0, lastSpace);
      return cut;
    }

    /**
     * 填充正文 — 头条使用 Syllepsis (ProseMirror) 编辑器
     * 使用 clipboard paste 方式，ProseMirror 能正确处理 HTML 粘贴内容
     */
    async fillBody() {
      const editor = await this.waitForElement(
        '.ProseMirror[contenteditable="true"], .syl-editor .ProseMirror',
        15000
      );
      if (!editor) {
        throw new Error("[toutiao] 未找到 ProseMirror 编辑器");
      }

      const markdown = this.articleData?.markdown || "";
      const html = this.articleData?.html || "";
      log(`填充正文 (md=${markdown.length} chars, html=${html.length} chars)`);

      editor.focus();
      await this.delay(200);

      // selectAll + clipboard paste
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);

      const dt = new DataTransfer();
      dt.setData("text/html", html || markdown);
      dt.setData("text/plain", markdown);

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      editor.dispatchEvent(pasteEvent);

      await this.delay(500);

      if (editor.textContent && editor.textContent.length > 10) {
        log(`正文填充成功 (${editor.textContent.length} chars in DOM)`);
      } else {
        console.warn("[toutiao] 正文填充后内容为空，尝试 innerHTML fallback");
        editor.innerHTML = html || `<p>${markdown}</p>`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    // ----------------------------------------------------------
    // 图片上传到头条 CDN
    // ----------------------------------------------------------

    /**
     * 检查 URL 是否已经是头条 CDN 地址
     * @param {string} url
     * @returns {boolean}
     */
    _isToutiaoCdnUrl(url) {
      try {
        const hostname = new URL(url).hostname;
        return TOUTIAO_CDN_HOSTS.some(h => hostname === h || hostname.endsWith("." + h));
      } catch {
        return false;
      }
    }

    /**
     * 从 URL 推断文件名和 MIME 类型
     * @param {string} url
     * @returns {{ filename: string, mimeType: string }}
     */
    _inferImageMeta(url) {
      let filename = "image.jpg";
      let mimeType = "image/jpeg";
      try {
        const pathname = new URL(url).pathname;
        const basename = pathname.split("/").pop() || "image.jpg";
        // 去掉查询参数残留
        const clean = basename.split("?")[0];
        if (clean && /\.\w+$/.test(clean)) {
          filename = clean;
        }
        const ext = filename.split(".").pop().toLowerCase();
        const mimeMap = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
        };
        mimeType = mimeMap[ext] || "image/jpeg";
      } catch {
        // use defaults
      }
      return { filename, mimeType };
    }

    /**
     * 上传单张图片到头条 CDN — fallback 链：
     *   1. /tools/catch_picture/ (URL-based 服务端抓图)
     *   2. /mp/agw/article_material/photo/upload_picture (二进制上传)
     *
     * @param {string} imgUrl - 原始图片 URL
     * @returns {Promise<string|null>} 成功返回 CDN URL，失败返回 null
     */
    async _uploadSingleImage(imgUrl) {
      try {
        log(`上传图片: ${imgUrl}`);

        const cdnUrl = await this._uploadByUrl(imgUrl);
        if (cdnUrl) return cdnUrl;

        return await this._uploadByBlob(imgUrl);
      } catch (e) {
        if (e.name === "AbortError") {
          log(`图片上传超时: ${imgUrl}`);
        } else {
          log(`图片上传异常: ${imgUrl} — ${e.message}`);
        }
        return null;
      }
    }

    /**
     * URL-based 服务端抓图 — 头条服务器下载图片，无需客户端 fetch blob
     * Ref: blogSync/Wechatsync toutiao.js uploadFileBySrc()
     */
    async _uploadByUrl(imgUrl) {
      try {
        const headers = { "Content-Type": "application/x-www-form-urlencoded" };
        const csrfToken = this._getCsrfToken();
        if (csrfToken) headers["X-CSRFToken"] = csrfToken;

        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), IMAGE_UPLOAD_TIMEOUT);

        let resp;
        try {
          resp = await fetch("https://mp.toutiao.com/tools/catch_picture/", {
            method: "POST",
            headers,
            body: new URLSearchParams({ upfile: imgUrl, version: "2" }),
            credentials: "include",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(tid);
        }

        if (!resp.ok) {
          log(`URL 上传失败 (HTTP ${resp.status}): ${imgUrl}`);
          return null;
        }

        const result = await resp.json();
        if (result.images && result.images.length > 0) {
          const cdnUrl = result.images[0].url || result.images[0].web_url;
          if (cdnUrl) {
            log(`URL 上传成功: ${imgUrl} → ${cdnUrl}`);
            return cdnUrl;
          }
        }

        log(`URL 上传响应异常: ${JSON.stringify(result)}`);
        return null;
      } catch (e) {
        log(`URL 上传失败: ${e.message}`);
        return null;
      }
    }

    /**
     * 二进制 blob 上传 — 下载图片后上传到 article_material API
     * Ref: blogSync/Wechatsync toutiao.js uploadFile()
     */
    async _uploadByBlob(imgUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_UPLOAD_TIMEOUT);

        let imgResponse;
        try {
          imgResponse = await fetch(imgUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!imgResponse.ok) {
          log(`下载图片失败 (HTTP ${imgResponse.status}): ${imgUrl}`);
          return null;
        }

        const blob = await imgResponse.blob();
        if (!blob.size) {
          log(`下载图片为空: ${imgUrl}`);
          return null;
        }
        log(`图片已下载: ${blob.size} 字节, type=${blob.type}`);

        const { filename, mimeType } = this._inferImageMeta(imgUrl);
        const actualMime = (blob.type && blob.type.startsWith("image/")) ? blob.type : mimeType;

        const formData = new FormData();
        formData.append("upfile", new File([blob], filename, { type: actualMime }));

        const headers = {};
        const csrfToken = this._getCsrfToken();
        if (csrfToken) headers["X-CSRFToken"] = csrfToken;

        const uploadController = new AbortController();
        const uploadTimeoutId = setTimeout(() => uploadController.abort(), IMAGE_UPLOAD_TIMEOUT);

        let uploadResponse;
        try {
          uploadResponse = await fetch(
            "https://mp.toutiao.com/mp/agw/article_material/photo/upload_picture?type=ueditor&pgc_watermark=1&action=uploadimage&encode=utf-8",
            {
              method: "POST",
              headers,
              body: formData,
              credentials: "include",
              signal: uploadController.signal,
            }
          );
        } finally {
          clearTimeout(uploadTimeoutId);
        }

        if (!uploadResponse.ok) {
          log(`Blob 上传失败 (HTTP ${uploadResponse.status}): ${imgUrl}`);
          return null;
        }

        const result = await uploadResponse.json();
        // blogSync format: { state: "SUCCESS", url: "..." }
        if (result.state === "SUCCESS" && result.url) {
          log(`Blob 上传成功: ${imgUrl} → ${result.url}`);
          return result.url;
        }
        // Legacy format: { message: "success", data: { url: "..." } }
        if (result.message === "success" && result.data && result.data.url) {
          log(`Blob 上传成功 (legacy): ${imgUrl} → ${result.data.url}`);
          return result.data.url;
        }

        log(`Blob 上传响应异常: ${JSON.stringify(result)}`);
        return null;
      } catch (e) {
        if (e.name === "AbortError") {
          log(`Blob 上传超时: ${imgUrl}`);
        } else {
          log(`Blob 上传异常: ${imgUrl} — ${e.message}`);
        }
        return null;
      }
    }

    /**
     * 扫描文章 HTML 中的所有外部 <img>，上传到头条 CDN 并替换 src。
     * - 跳过已经是头条 CDN 的图片
     * - 跳过 data: URI
     * - 上传失败的图片保留原始 src（不剥离，尽力而为）
     * - 同时更新 articleData.html 和 articleData.markdown（仅 URL 替换）
     *
     * 使用并发控制避免同时发起过多请求。
     */
    async _uploadImages() {
      if (!this.articleData) return;

      const html = this.articleData.html || "";
      if (!html) {
        log("无 HTML 内容，跳过图片上传");
        return;
      }

      // 提取所有 <img> 的 src
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const images = [];
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        // 跳过 data URI
        if (src.startsWith("data:")) continue;
        // 跳过已经是头条 CDN 的图片
        if (this._isToutiaoCdnUrl(src)) {
          log(`跳过已是 CDN 图片: ${src}`);
          continue;
        }
        images.push(src);
      }

      if (images.length === 0) {
        log("无需上传的外部图片");
        return;
      }

      log(`发现 ${images.length} 张外部图片需要上传`);

      // 去重
      const uniqueUrls = [...new Set(images)];
      const urlMap = new Map(); // originalUrl → cdnUrl

      // 分批并发上传
      for (let i = 0; i < uniqueUrls.length; i += MAX_IMAGE_UPLOAD_CONCURRENT) {
        const batch = uniqueUrls.slice(i, i + MAX_IMAGE_UPLOAD_CONCURRENT);
        const results = await Promise.all(
          batch.map(async (url) => {
            const cdnUrl = await this._uploadSingleImage(url);
            return { url, cdnUrl };
          })
        );
        for (const { url, cdnUrl } of results) {
          if (cdnUrl) {
            urlMap.set(url, cdnUrl);
          }
        }
      }

      if (urlMap.size === 0) {
        log("所有图片上传均失败，保留原始内容");
        return;
      }

      log(`成功上传 ${urlMap.size}/${uniqueUrls.length} 张图片，替换 URL...`);

      // 替换 HTML 中的图片 URL
      let newHtml = html;
      let newMarkdown = this.articleData.markdown || "";
      for (const [originalUrl, cdnUrl] of urlMap) {
        // 使用全局替换，因为同一图片可能出现多次
        // 对 URL 中的特殊正则字符进行转义
        const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "g");
        newHtml = newHtml.replace(regex, cdnUrl);
        if (newMarkdown) {
          newMarkdown = newMarkdown.replace(regex, cdnUrl);
        }
      }

      this.articleData.html = newHtml;
      if (newMarkdown) {
        this.articleData.markdown = newMarkdown;
      }
      log("图片 URL 替换完成");
    }

    // ----------------------------------------------------------
    // 发布配置
    // ----------------------------------------------------------

    async fillPublishConfig(config) {
      await this._selectNoCover();

      if (config.tags && config.tags.length > 0) {
        try {
          log(`填充标签: ${config.tags.join(", ")}`);
          const tagInput = document.querySelector(
            '.byte-tag-input input, input[placeholder*="标签"], input[placeholder*="添加标签"]'
          );
          if (!tagInput) {
            console.warn("[toutiao] 未找到标签输入框");
            return;
          }
          for (const tag of config.tags.slice(0, 5)) {
            tagInput.focus();
            tagInput.value = tag;
            tagInput.dispatchEvent(new Event("input", { bubbles: true }));
            await this.delay(600);
            tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await this.delay(400);
          }
        } catch (e) {
          console.warn(`[toutiao] 填充标签失败:`, e.message);
        }
      }
    }

    async _selectNoCover() {
      try {
        const radios = document.querySelectorAll(
          ".article-cover .byte-radio, .article-cover-radio-group .byte-radio"
        );
        for (const radio of radios) {
          if (radio.textContent.trim() === "无封面") {
            const input = radio.querySelector("input[type='radio']");
            if (input) {
              input.click();
              log("已选择无封面");
              await this.delay(300);
              return;
            }
          }
        }
        const allLabels = [...document.querySelectorAll(".byte-radio-inner-text")];
        const noCover = allLabels.find(el => el.textContent.trim() === "无封面");
        if (noCover) {
          noCover.closest(".byte-radio")?.querySelector("input")?.click() ||
            noCover.click();
          log("已通过文字匹配选择无封面");
          await this.delay(300);
        }
      } catch (e) {
        console.warn("[toutiao] 选择无封面失败:", e.message);
      }
    }

    // ----------------------------------------------------------
    // UI 辅助
    // ----------------------------------------------------------

    async _closeAIAssistant() {
      try {
        // Actual DOM: div.ai-assistant.is-expand (380×829px panel blocking editor)
        const aiPanel = document.querySelector('.ai-assistant.is-expand');
        if (aiPanel) {
          const closeBtn = aiPanel.querySelector(
            '.creative-assistant-close, .ai-assistant-close, [class*="close"]'
          );
          if (closeBtn) {
            closeBtn.click();
            log("点击关闭按钮关闭 AI 助手面板");
            await this.delay(500);
          } else {
            aiPanel.classList.remove("is-expand");
            log("移除 is-expand 类关闭 AI 助手面板");
            await this.delay(300);
          }
        }

        // Fallback: legacy ByteDesign drawer structure
        const drawerMask = document.querySelector('.byte-drawer-mask');
        const drawer = document.querySelector('.byte-drawer-wrapper.ai-assistant-drawer');
        if (drawerMask) drawerMask.remove();
        if (drawer) drawer.remove();

        if (!aiPanel) {
          const fallbackBtn = document.querySelector(
            '.creative-assistant-close, .ai-assistant-close, [class*="assistant"] [class*="close"]'
          );
          if (fallbackBtn) {
            fallbackBtn.click();
            log("兜底关闭 AI 助手面板");
            await this.delay(500);
          }
        }
      } catch {
        // ignore
      }
    }

    async _waitForDraftSaved(timeout = 20000) {
      log("等待草稿保存...");
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const saveStatus = document.querySelector(
          '.draft-save-status, .auto-save-tip, [class*="save-status"], [class*="draft-tip"]'
        );
        if (saveStatus) {
          const text = saveStatus.textContent.trim();
          if (text.includes("已保存") || text.includes("saved")) {
            log(`草稿已保存: "${text}"`);
            return true;
          }
          if (text.includes("保存失败") || text.includes("failed")) {
            log(`草稿保存失败: "${text}", 继续等待...`);
          }
        }

        // Also check for generic save success indicators
        const allText = document.body.innerText;
        if (allText.includes("草稿已保存") || allText.includes("草稿保存成功")) {
          log("检测到草稿保存成功文字");
          return true;
        }

        await this.delay(1000);
      }
      log("等待草稿保存超时，继续尝试发布...");
      return false;
    }

    _simulateRealClick(element) {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      const events = [
        new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
        new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }),
        new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
        new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }),
        new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }),
      ];

      for (const evt of events) {
        element.dispatchEvent(evt);
      }
    }

    // ----------------------------------------------------------
    // afterFill — 发布流程
    // ----------------------------------------------------------

    async afterFill() {
      await this._closeAIAssistant();

      await this.delay(5000);
      const draftSaved = await this._waitForDraftSaved(20000);

      let pgcId = "0";

      if (!draftSaved) {
        log("草稿自动保存未确认，尝试 API 保存草稿...");
        const savedId = await this._tryApiSaveDraft();
        if (savedId) {
          pgcId = savedId;
          log(`API 草稿保存成功 (pgc_id=${pgcId})，尝试 API 发布...`);
          if (await this._tryApiPublish(pgcId)) {
            await this._dismissPostPublishModal();
            return;
          }
          log("API 发布失败，继续尝试按钮...");
        } else {
          log("API 草稿保存也失败，尝试直接 API 发布...");
          if (await this._tryApiPublish()) {
            await this._dismissPostPublishModal();
            return;
          }
          log("API 发布也失败，仍尝试按钮点击...");
        }
      }

      log("查找发布按钮...");
      const btn = await this.waitForPublishButton(8000);
      if (!btn) {
        if (draftSaved) {
          log("未找到发布按钮，尝试 API 发布...");
          if (await this._tryApiPublish(pgcId)) {
            await this._dismissPostPublishModal();
            return;
          }
        }
        throw new Error("未找到预览并发布按钮");
      }

      log(`点击发布按钮: "${btn.textContent.trim()}" (class="${btn.className}")`);
      btn.scrollIntoView({ block: "center" });
      await this.delay(300);

      this._publishAttempted = true; // E-6: mark before click so API fallback won't double-publish
      btn.click();
      await this.delay(2000);

      let confirmBtn = this._findConfirmButton();
      if (confirmBtn) {
        log(`找到确认发布按钮: "${confirmBtn.textContent.trim()}"`);
        this._simulateRealClick(confirmBtn);
        await this._dismissPostPublishModal();
        return;
      }

      log("Native click 无效，尝试 pointer events...");
      this._simulateRealClick(btn);
      await this.delay(2000);

      confirmBtn = this._findConfirmButton();
      if (confirmBtn) {
        log(`找到确认发布按钮: "${confirmBtn.textContent.trim()}"`);
        this._simulateRealClick(confirmBtn);
        await this._dismissPostPublishModal();
        return;
      }

      log("Pointer events 无效，尝试 React internals...");
      const reactClicked = this._tryReactClick(btn);
      if (reactClicked) {
        await this.delay(2000);
        confirmBtn = this._findConfirmButton();
        if (confirmBtn) {
          this._simulateRealClick(confirmBtn);
          await this._dismissPostPublishModal();
          return;
        }
      }

      log("按钮点击全部无效，API 最终尝试...");
      if (await this._tryApiPublish(pgcId)) {
        await this._dismissPostPublishModal();
        return;
      }

      throw new Error("头条发布失败：所有策略（按钮点击 + API）均未成功");
    }

    async _dismissPostPublishModal() {
      await this.delay(2000);
      const cancelBtn = [...document.querySelectorAll("button, .byte-btn")]
        .find(b => /^取消$/.test(b.textContent.trim()));
      if (cancelBtn) {
        log(`关闭作品同步授权弹窗: "${cancelBtn.textContent.trim()}"`);
        cancelBtn.click();
      }
    }

    // ----------------------------------------------------------
    // Direct API publish — bypasses UI button entirely
    // Reference: blogSync/Wechatsync (loks666/blogSync)
    // POST https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article
    //
    // 两步流程（解决 code 7050 "保存失败"）：
    //   1. save=1, pgc_id=0 → 创建草稿 → 返回 pgc_id
    //   2. save=0, pgc_id=<上一步的 pgc_id> → 正式发布
    // ----------------------------------------------------------

    /**
     * 从 cookie 中提取 CSRF token
     * @returns {string|null}
     */
    _getCsrfToken() {
      const match = document.cookie.match(/passport_csrf_token=([^;]+)/);
      return match ? match[1] : null;
    }

    /**
     * 判断 API 响应是否表示成功（保存或发布）
     * 头条 API 成功响应格式: { code: 0, data: { pgc_id: "1234567" }, message: "success" }
     * 失败响应格式: { code: 7050, data: { pgc_id: 0 }, message: "保存失败" }
     *
     * 必须同时检查:
     *   1. result.code === 0（或 result.err_no === 0）
     *   2. result.data.pgc_id 为真值（非 0、非空）
     * 仅检查 pgc_id 不够 — 失败响应也带 pgc_id: 0
     */
    _isApiSuccess(result) {
      const codeOk = result.code === 0 || result.err_no === 0;
      const hasPgcId = result.data && result.data.pgc_id;
      return codeOk && hasPgcId;
    }

    /**
     * 构造 API 请求公共参数
     * @param {Object} overrides - 覆盖参数（如 save, pgc_id）
     * @returns {{ headers: Object, body: string }} 请求头和表单体
     */
    _buildApiRequest(overrides = {}) {
      let title = this.articleData.title;
      if (title && title.length > MAX_TITLE_LENGTH) {
        title = this._truncateTitle(title, MAX_TITLE_LENGTH);
        log(`API 请求标题截断(${this.articleData.title.length}→${title.length}字): "${title}"`);
      }
      const content = this.articleData.html || this.articleData.markdown || "";

      const params = {
        title,
        content,
        article_ad_type: "2",
        article_type: "0",
        from_diagnosis: "0",
        origin_debut_check_pgc_normal: "0",
        tree_plan_article: "0",
        save: "0",
        pgc_id: "0",
        pgc_feed_covers: "[]",
        ...overrides,
      };

      const formData = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        formData.append(key, String(value));
      }

      const headers = { "Content-Type": "application/x-www-form-urlencoded" };
      const csrfToken = this._getCsrfToken();
      if (csrfToken) {
        headers["X-CSRFToken"] = csrfToken;
      }

      return { headers, body: formData.toString(), csrfToken };
    }

    /**
     * 保存草稿到服务器 — 解决直接发布时 "保存失败" 的问题
     * 用 save=1 调 publish API，服务器创建草稿并返回 pgc_id
     *
     * @returns {string|false} 成功返回 pgc_id，失败返回 false
     */
    async _tryApiSaveDraft() {
      try {
        if (!this.articleData) {
          log("API 保存草稿：无文章数据");
          return false;
        }

        let title = this.articleData.title;
        const content = this.articleData.html || this.articleData.markdown || "";
        if (!title || !content) {
          log("API 保存草稿：标题或内容为空");
          return false;
        }

        if (title.length > MAX_TITLE_LENGTH) {
          title = this._truncateTitle(title, MAX_TITLE_LENGTH);
        }

        log("API 保存草稿：准备请求...");
        log(`  标题: "${title}" (${title.length}字)`);
        log(`  内容长度: ${content.length} 字符`);

        const { headers, body, csrfToken } = this._buildApiRequest({
          save: "1",   // 1 = 保存草稿
          pgc_id: "0", // 0 = 新文章
        });

        if (csrfToken) {
          log(`API 保存草稿：使用 CSRF token: ${csrfToken.substring(0, 8)}...`);
        }

        const response = await fetch(
          "https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article",
          {
            method: "POST",
            headers,
            body,
            credentials: "include",
          }
        );

        if (!response.ok) {
          log(`API 保存草稿：HTTP 错误 ${response.status}`);
          return false;
        }

        const result = await response.json();
        log("API 保存草稿：响应", JSON.stringify(result));

        if (this._isApiSuccess(result)) {
          const pgcId = String(result.data.pgc_id);
          log(`API 保存草稿成功！pgc_id: ${pgcId}`);
          return pgcId;
        }

        log(`API 保存草稿失败: code=${result.code}, message="${result.message}"`);
        return false;
      } catch (e) {
        log(`API 保存草稿异常: ${e.message}`);
        return false;
      }
    }

    /**
     * 通过 API 直接发布文章
     * @param {string} [pgcId="0"] - 文章 pgc_id。传入已保存草稿的 id 可避免 "保存失败"
     * @returns {boolean} 是否发布成功
     */
    async _tryApiPublish(pgcId = "0") {
      // E-6: Only attempt to publish once per FILL_AND_PUBLISH invocation.
      // Without this guard, the button-click path and the API fallback path
      // can both succeed in the same afterFill(), creating a duplicate article.
      if (this._publishAttempted) {
        log("_tryApiPublish: 已发布过，跳过重复调用");
        return false;
      }
      this._publishAttempted = true;
      try {
        if (!this.articleData) {
          log("API 发布：无文章数据");
          this._publishAttempted = false; // reset so caller can retry if needed
          return false;
        }

        const title = this.articleData.title;
        const content = this.articleData.html || this.articleData.markdown || "";

        if (!title || !content) {
          log("API 发布：标题或内容为空");
          return false;
        }

        log("API 发布：准备请求...");
        log(`  标题: "${title}"`);
        log(`  内容长度: ${content.length} 字符`);
        log(`  pgc_id: ${pgcId}`);

        const { headers, body, csrfToken } = this._buildApiRequest({
          save: "0",        // 0 = 发布
          pgc_id: pgcId,    // 用传入的 pgc_id（已保存的草稿 ID）
        });

        if (csrfToken) {
          log(`API 发布：使用 CSRF token: ${csrfToken.substring(0, 8)}...`);
        } else {
          log("API 发布：未找到 CSRF token，尝试不带 token 发布");
        }

        const response = await fetch(
          "https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article",
          {
            method: "POST",
            headers,
            body,
            credentials: "include",
          }
        );

        if (!response.ok) {
          log(`API 发布：HTTP 错误 ${response.status}`);
          return false;
        }

        const result = await response.json();
        log("API 发布：响应", JSON.stringify(result));

        if (this._isApiSuccess(result)) {
          log(`API 发布成功！文章 ID: ${result.data.pgc_id}`);
          return true;
        }

        log(`API 发布失败: code=${result.code}, err_no=${result.err_no}, message="${result.message}"`);
        return false;
      } catch (e) {
        log(`API 发布异常: ${e.message}`);
        return false;
      }
    }

    // ----------------------------------------------------------
    // 按钮查找 & React 兼容
    // ----------------------------------------------------------

    _findConfirmButton() {
      // Look for button with text "确认发布"
      const btns = document.querySelectorAll(".publish-btn, button");
      for (const b of btns) {
        if (!b.disabled && b.textContent.trim() === "确认发布") {
          return b;
        }
      }
      return null;
    }

    _tryReactClick(element) {
      try {
        const fiberKey = Object.keys(element).find(k =>
          k.startsWith("__reactInternalInstance") || k.startsWith("__reactFiber")
        );
        if (!fiberKey) return false;

        const fiber = element[fiberKey];
        let current = fiber;
        for (let i = 0; i < 10 && current; i++) {
          if (current.memoizedProps && typeof current.memoizedProps.onClick === "function") {
            try {
              current.memoizedProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
              log("React onClick 调用成功");
              return true;
            } catch (e) {
              log("React onClick 调用失败:", e.message);
            }
          }
          current = current.return;
        }
        return false;
      } catch {
        return false;
      }
    }

    async waitForPublishButton(timeout = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const bySelector = document.querySelector(".byte-btn-primary.publish-btn");
        if (bySelector && !bySelector.disabled) return bySelector;

        const byText = [...document.querySelectorAll("button")].find(
          el => !el.disabled && /^(预览并发布|发布文章|发布)$/.test(el.textContent.trim())
        );
        if (byText) return byText;

        await this.delay(200);
      }
      return null;
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  const publisher = new ToutiaoPublisher();
  publisher.init();
})();
