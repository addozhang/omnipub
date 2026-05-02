/**
 * csdn.js — CSDN 适配器
 *
 * 目标页面：mp.csdn.net/mp_blog/creation/editor（CKEditor 4 富文本编辑器）
 *
 * 发布流程（一步）：
 * 所有设置项（标签、原创、分类等）在编辑器下方的滚动区域中，
 * 点击 .btn-outline-danger（"发布博客"）直接提交。
 * 成功后跳转到 /mp_blog/creation/success/{articleId}。
 *
 * 正文通过 MAIN world CKEDITOR.instances[].setData(html) 填充。
 *
 * 注意：文章标签为必填项（.mark_selection），未填写时
 * 表单项会标记 .is-error 且发布请求不会发出。
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class CsdnPublisher extends BasePublisher {
    constructor() {
      super("csdn");
      this.publishSelectors = [".btn-outline-danger"];
    }

    async beforeFill() {
      // 关闭 AI 助手抽屉（默认打开，会遮挡编辑器）
      try {
        const closeBtn = document.querySelector(".edit-title-close");
        if (closeBtn) {
          closeBtn.click();
          log("[csdn] 关闭 AI 助手抽屉");
          await this.delay(300);
        }
      } catch (e) {
        log("[csdn] 关闭 AI 助手失败:", e.message);
      }

      // 关闭草稿恢复横幅
      try {
        const dismissBtn = document.querySelector(
          ".draft-tips .close, .draft-tips .el_mcm-icon-close, .draft-bar .close-btn"
        );
        if (dismissBtn) {
          dismissBtn.click();
          log("[csdn] 关闭草稿恢复横幅");
          await this.delay(200);
        }
      } catch {
        // 可忽略
      }
    }

    async fillPublishConfig(config) {
      if (config.tags && config.tags.length > 0) {
        await this._fillTags(config.tags);
      }
      if (config.original !== undefined) {
        await this._setOriginal(config.original);
      }
    }

    async _fillTags(tags) {
      try {
        log(`[csdn] 填充标签: ${tags.join(", ")}`);

        // 方式 1：点击预设标签云中的匹配标签
        const presetTags = document.querySelectorAll(
          ".mark_selection .el_mcm-tag"
        );
        let matched = 0;
        for (const tag of tags.slice(0, 5)) {
          const lowerTag = tag.toLowerCase();
          const preset = [...presetTags].find(
            (el) => el.textContent?.trim().toLowerCase() === lowerTag
          );
          if (preset) {
            preset.click();
            matched++;
            await this.delay(300);
          }
        }
        if (matched > 0) {
          log(`[csdn] 通过预设标签云匹配了 ${matched} 个标签`);
          return;
        }

        // 方式 2：通过输入框手动添加标签
        const tagInput = document.querySelector(
          '.tag__input input, input[placeholder*="标签"], input[placeholder*="文章标签"]'
        );
        if (!tagInput) {
          console.warn("[csdn] 未找到标签输入框，尝试点击第一个预设标签");
          if (presetTags.length > 0) {
            presetTags[0].click();
          }
          return;
        }
        for (const tag of tags.slice(0, 5)) {
          tagInput.focus();
          tagInput.value = tag;
          tagInput.dispatchEvent(new Event("input", { bubbles: true }));
          await this.delay(600);
          tagInput.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
          );
          await this.delay(400);
        }
      } catch (e) {
        console.warn(`[csdn] 填充标签失败:`, e.message);
      }
    }

    async _setOriginal(isOriginal) {
      try {
        log(`[csdn] 设置原创声明: ${isOriginal}`);
        const originalCheckbox = document.querySelector(
          'input[type="checkbox"].is-original, .is-original input, #is-original'
        );
        if (!originalCheckbox) {
          const label = [...document.querySelectorAll("label, .el-checkbox")].find(
            (el) => el.textContent.includes("原创")
          );
          if (label) {
            const checked =
              label.classList.contains("is-checked") ||
              label.querySelector("input:checked");
            if (isOriginal && !checked) label.click();
            else if (!isOriginal && checked) label.click();
            return;
          }
          console.warn("[csdn] 未找到原创声明复选框");
          return;
        }
        if (isOriginal && !originalCheckbox.checked) originalCheckbox.click();
        else if (!isOriginal && originalCheckbox.checked)
          originalCheckbox.click();
      } catch (e) {
        console.warn(`[csdn] 设置原创声明失败:`, e.message);
      }
    }

    async fillBody() {
      const html = this.articleData.html || `<p>${this.articleData.markdown || ""}</p>`;
      log("[csdn] 通过 MAIN world 调用 CKEDITOR.setData()");

      const resp = await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "ckeditor_setData",
        args: { content: html },
      });

      if (resp && resp.success) {
        log("[csdn] CKEditor setData 成功");
        await this.delay(2000);
        return true;
      }

      log("[csdn] MAIN world setData 失败，降级使用基类 fillBody()");
      return super.fillBody();
    }

    async afterFill() {
      log('[csdn] 点击"发布博客"...');
      const btn = await this.waitForElement(
        ".btn-outline-danger, .btn-publish-red, .btn-publish",
        8000
      );
      if (!btn) {
        throw new Error("未找到发布博客按钮");
      }

      await this._ensureTagsFilled();

      this._apiResult = null;
      await this._installSaveArticleInterceptor();

      try {
        btn.click();
        return await this._waitForPublishResult(12000);
      } finally {
        if (this._messageHandler) {
          window.removeEventListener("message", this._messageHandler);
          this._messageHandler = null;
        }
      }
    }

    /**
     * XHR 拦截器：捕获 saveArticle API 响应。
     * CSDN 的 400 错误（如"每日发文上限"）不会在 DOM 中显示，
     * 必须通过 MAIN world XHR 拦截 + postMessage 回传检测。
     */
    async _installSaveArticleInterceptor() {
      this._messageHandler = (event) => {
        if (event.data?.type === "__csdn_save_result__") {
          this._apiResult = event.data.payload;
          log(`[csdn] saveArticle result received:`, this._apiResult);
        }
      };
      window.addEventListener("message", this._messageHandler);

      await chrome.runtime.sendMessage({
        action: "executeInMainWorld",
        code: "csdn_installSaveInterceptor",
        args: {},
      });
    }

    async _ensureTagsFilled() {
      const formItem = document
        .querySelector(".mark_selection")
        ?.closest(".el_mcm-form-item");
      if (!formItem) return;

      // 检查是否已有选中标签（closable 标签表示已选中）
      const selected = formItem.querySelectorAll(
        ".el_mcm-tag.is-closable, .tag-item"
      );
      if (selected.length > 0) {
        log(`[csdn] 已有 ${selected.length} 个标签`);
        return;
      }

      // 没有标签，从预设中选第一个
      log("[csdn] 未选择标签（必填），尝试选择预设标签");
      const presetTag = document.querySelector(
        ".mark_selection .el_mcm-tag:not(.is-closable)"
      );
      if (presetTag) {
        presetTag.click();
        await this.delay(300);
        log(`[csdn] 自动选择了标签: ${presetTag.textContent?.trim()}`);
      }
    }

    /**
     * 等待发布结果：页面跳转到 success 页 或 出现表单验证错误
     */
    async _waitForPublishResult(timeout = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (location.href.includes("/success/")) {
          log("[csdn] 发布成功，已跳转到成功页");
          const articleUrl = await this._extractArticleUrl();
          return articleUrl ? { article_url: articleUrl } : null;
        }

        if (this._apiResult) {
          if (this._apiResult.status >= 400 || this._apiResult.code >= 400) {
            throw new Error(`CSDN 发布失败 (${this._apiResult.status}): ${this._apiResult.msg}`);
          }
          if (this._apiResult.status === 200 && this._apiResult.code === 200) {
            if (this._apiResult.articleId) {
              log("[csdn] saveArticle API 返回成功，从响应中提取 articleId");
              const articleUrl = await this._extractArticleUrl();
              return articleUrl ? { article_url: articleUrl } : null;
            }
            log("[csdn] saveArticle API 返回成功，等待页面跳转...");
          }
        }

        const errorItems = document.querySelectorAll(
          ".el_mcm-form-item.is-error"
        );
        if (errorItems.length > 0) {
          const labels = [...errorItems]
            .map(
              (el) =>
                el.querySelector(".el_mcm-form-item__label")?.textContent?.trim() ||
                "未知字段"
            )
            .join(", ");
          throw new Error(`CSDN 表单验证失败: ${labels}`);
        }

        const toast = document.querySelector(".el_mcm-message--error");
        if (toast) {
          const msg = toast.textContent?.trim() || "发布失败";
          throw new Error(`CSDN 发布被拒绝: ${msg}`);
        }

        await this.delay(500);
      }

      throw new Error("CSDN 发布超时：未检测到成功跳转或 API 响应");
    }

    async _extractArticleUrl() {
      try {
        const match = location.href.match(/\/success\/(\d+)/);
        let articleId = match ? match[1] : null;

        if (!articleId && this._apiResult?.articleId) {
          const raw = String(this._apiResult.articleId);
          const idMatch = raw.match(/(\d{5,})/);
          articleId = idMatch ? idMatch[1] : raw;
        }

        if (!articleId) return null;

        const cookies = await chrome.cookies.getAll({ domain: ".csdn.net", name: "UserName" });
        const username = cookies[0]?.value;
        if (username) {
          return `https://blog.csdn.net/${username}/article/details/${articleId}`;
        }

        // Fallback: without username, use generic URL (CSDN will 302 to correct URL)
        log("[csdn] UserName cookie 未找到，使用不含 username 的 URL");
        return `https://blog.csdn.net/article/details/${articleId}`;
      } catch (e) {
        log("[csdn] 提取 article_url 失败:", e.message);
        return null;
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

  const publisher = new CsdnPublisher();
  publisher.init();
})();
