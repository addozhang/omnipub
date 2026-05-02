/**
 * infoq.js — InfoQ 极客时间写作平台适配器
 *
 * 编辑器 URL: https://xie.infoq.cn/draft/<draftId>
 * 草稿由 service-worker 通过 POST /api/v1/draft/create 创建，
 * 然后直接打开编辑器页面填充内容。
 *
 * UI 组件库：GeekBang 自研 (gk-button, gk-modal 属性选择器)
 *   - 按钮：[gk-button], [gkbtn-color=blue/green/orange]
 *   - 弹窗：[gkmodal-color=*], [gk-modal-footer], [gk-modal-main]
 *   - 确认弹窗：[gkmodal-color=confirm], [gk-confirm-title]
 *   - 编辑器操作弹窗：[gkmodal-color=editor-action]
 *   - CSS Modules 按钮：.Button_button_* (带 hash 后缀)
 *
 * 2026-03 更新：InfoQ 不使用 Ant Design，所有 ant-* 选择器已替换为 gk-* 选择器
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class InfoqPublisher extends BasePublisher {
    constructor() {
      super("infoq");
      this.publishSelectors = [
        "[gk-button][gkbtn-color=blue]",
        "[gk-button][gkbtn-color=green]",
        "[gk-button][gkbtn-color=orange]",
        '[class*="Button_button_"]',
        ".submit-btn",
        ".draft-submit-btn",
      ];
    }

    async beforeFill() {
      await this.delay(1000);
      // Dismiss feature announcement modals ("知道了" buttons)
      for (let i = 0; i < 3; i++) {
        const dismissBtn = [...document.querySelectorAll("button, [gk-button], [role='button'], span")]
          .find(el => /^知道了$/.test((el.textContent || "").trim()));
        if (dismissBtn) {
          dismissBtn.click();
          await this.delay(500);
        } else {
          break;
        }
      }
    }

    async fillPublishConfig(config) {
      if (config.tags && config.tags.length > 0) {
        try {
          log(`[infoq] 填充标签: ${config.tags.join(", ")}`);
          // GeekBang uses custom tag input; try generic selectors
          const tagInput = document.querySelector(
            'input[placeholder*="标签"], input[placeholder*="tag"], .tag-input input, [class*="tag"] input'
          );
          if (!tagInput) {
            console.warn("[infoq] 未找到标签输入框");
            return;
          }
          for (const tag of config.tags.slice(0, 5)) {
            tagInput.focus();
            tagInput.value = tag;
            tagInput.dispatchEvent(new Event("input", { bubbles: true }));
            await this.delay(800);
            // Try to find and click suggestion dropdown item
            const suggestion = document.querySelector(
              '[class*="suggest"] li, [class*="dropdown"] li, [class*="option"]'
            );
            if (suggestion && suggestion.textContent.includes(tag)) {
              suggestion.click();
            } else {
              tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
            await this.delay(400);
          }
        } catch (e) {
          console.warn(`[infoq] 填充标签失败:`, e.message);
        }
      }
    }

    async afterFill() {
      log("[infoq] 查找发布按钮...");
      const btn = await this.waitForPublishButton(10000);
      if (!btn) {
        throw new Error("未找到发布按钮");
      }
      log(`[infoq] 点击发布: "${btn.textContent.trim()}"`);
      btn.click();

      log("[infoq] 等待确认弹窗...");
      const confirmBtn = await this.waitForConfirmButton(15000);
      if (!confirmBtn) {
        throw new Error("确认弹窗未出现，文章可能未发布（仅保存为草稿）");
      }
      log(`[infoq] 点击弹窗确认: "${confirmBtn.textContent.trim()}"`);
      confirmBtn.click();

      // 发布后 InfoQ 跳转到 /article/{id}，等待跳转以捕获 article_url
      const articleUrl = await this._waitForArticleUrl(15000);
      if (articleUrl) {
        log(`[infoq] 捕获到文章 URL: ${articleUrl}`);
        return { article_url: articleUrl };
      }

      // Fallback: 从当前 draft URL 推导（draftId 通常等于 articleId）
      const draftMatch = location.href.match(/\/draft\/([a-zA-Z0-9]+)/);
      if (draftMatch) {
        const fallbackUrl = `https://xie.infoq.cn/article/${draftMatch[1]}`;
        log(`[infoq] 使用 draftId 推导 URL: ${fallbackUrl}`);
        return { article_url: fallbackUrl };
      }

      log("[infoq] 未捕获到文章 URL");
      return null;
    }

    async _waitForArticleUrl(timeout = 15000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (/\/article\/[a-zA-Z0-9]+/.test(location.href)) {
          return location.href.split("?")[0].split("#")[0];
        }
        await this.delay(500);
      }
      return null;
    }

    /**
     * 等待确认弹窗中的确认按钮。
     * GeekBang UI 使用属性选择器：[gk-modal-footer] [gk-button]
     * 弹窗类型包括：confirm, editor-action, common, base
     * 也兼容 CSS Modules 按钮和旧版 ant-design 选择器作为 fallback。
     */
    async waitForConfirmButton(timeout = 15000) {
      // Selectors ordered by specificity: GeekBang → CSS Modules → Ant (legacy) → generic
      const confirmBtnSelectors = [
        ".dialog-footer-buttons [gkbtn-color=green]",
        ".dialog-footer-buttons [gk-button]",
        "[gk-modal-footer] [gk-button]",
        "[gkmodal-color=confirm] [gk-button]",
        "[gkmodal-color=editor-action] [gk-button]",
        "[gkmodal-color=common] [gk-button]",
        "[gkmodal-color=base] [gk-button]",
        '[gk-modal-footer] [class*="Button_button_"]',
        ".gkui-modal-layer [gk-button]",
        "#gkui-modal-controller [gk-button]",
      ];

      const start = Date.now();
      while (Date.now() - start < timeout) {
        const settingModals = document.querySelectorAll(".dialog-setting");
        let activeModal = null;
        for (const m of settingModals) {
          if (m.innerHTML.length > 50) { activeModal = m; break; }
        }

        if (activeModal) {
          const greenBtn = activeModal.querySelector('[gkbtn-color="green"]');
          if (greenBtn && !greenBtn.disabled) return greenBtn;

          const footerBtns = activeModal.querySelectorAll(".dialog-footer-buttons [gk-button]");
          for (const fb of footerBtns) {
            if (/确定|确认/.test(fb.textContent) && !fb.disabled) return fb;
          }
        }

        for (const sel of confirmBtnSelectors) {
          const el = document.querySelector(sel);
          if (el && !el.disabled && /发布|确认|确定/.test(el.textContent)) {
            return el;
          }
        }

        // Text-only fallback: find any visible button with publish/confirm text
        // that is inside a modal-like container
        const allButtons = [...document.querySelectorAll('[gk-button], [class*="Button_button_"], button')];
        const textMatch = allButtons.find(el => {
          if (el.disabled) return false;
          const text = el.textContent.trim();
          if (!/^(发布|确认发布|确认|确定)$/.test(text)) return false;
          // Ensure it's inside a modal (not the main page publish button)
          const inModal = el.closest(
            '[gkmodal-color], .gkui-modal-layer, #gkui-modal-controller, .dialog-setting, [class*="modal"], [class*="dialog"]'
          );
          return !!inModal;
        });
        if (textMatch) return textMatch;

        await this.delay(300);
      }
      return null;
    }

    /**
     * 等待发布按钮出现。
     * 优先文字匹配（最稳定），然后尝试 GeekBang 属性选择器和 CSS Modules 类名。
     */
    async waitForPublishButton(timeout = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        // Text match first — most reliable
        const byText = [...document.querySelectorAll('[gk-button], [class*="Button_button_"], button, [role="button"]')].find(
          el => /^(发布|发布文章)$/.test(el.textContent.trim()) && !el.disabled
        );
        if (byText) return byText;

        // Selector match with text verification to avoid "save draft" button
        for (const sel of this.publishSelectors) {
          const el = document.querySelector(sel);
          if (el && !el.disabled && /发布/.test(el.textContent)) return el;
        }
        await this.delay(300);
      }
      return null;
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }

  const publisher = new InfoqPublisher();
  publisher.init();
})();
