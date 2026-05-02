/**
 * tencent-cloud.js — 腾讯云开发者社区适配器
 *
 * 编辑器：Cherry Markdown Editor（腾讯开源，底层 CodeMirror 5）
 * 标题：.cdc-article-editor__title-input（textarea, 建议80字以内）
 * 正文：CodeMirror 实例（.cherry-editor > .CodeMirror）
 *
 * 发布流程（两步）：
 *   1. 点击"去发布"（.cdc-btn.cdc-btn--primary）→ 打开 .editor-publish-drawer 面板
 *   2. 填写：
 *      - 文章来源 radio(value=1原创) — TDesign radio，必须点击 .t-radio 容器
 *      - 文章标签(.cdc-tags-input__input index 0) — 必填，搜索 API + 下拉选择
 *      - 自定义关键词(.cdc-tags-input__input index 1) — 可选，Enter 创建
 *      - 摘要(textarea) — 需 nativeInputValueSetter 触发 Vue 响应
 *   3. 点击"确认发布"（.editor-publish-drawer__opt .cdc-btn--primary）
 *   4. 检测成功/失败（API 响应 or DOM 错误提示）
 *
 * 已知陷阱：
 *   - "文章标签"是必填字段，缺失时"确认发布"点击被 Vue 表单校验静默拦截（无异常）
 *   - 摘要 textarea 直接 .value= 不触发 Vue 响应，必须用 nativeInputValueSetter
 *   - 标签搜索必须用真实键盘输入（逐字符 input 事件），不能批量 set value
 *   - 标签下拉项必须点击 span.cdc-tags-input__dropdown-item-text（不是 li 父级）
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[tencent-cloud]", ...args);

  /** 发布成功检测超时（毫秒） */
  const PUBLISH_RESULT_TIMEOUT = 15000;

  /** nativeInputValueSetter — 绕过 Vue/React 响应式拦截（仅用于 textarea 等不需要 MAIN world 的场景） */
  const getNativeTextareaSetter = () =>
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;

  /**
   * 在 MAIN world 中模拟输入关键词到指定的 tag input 框。
   * 通过 service worker 的 chrome.scripting.executeScript({ world: "MAIN" }) 执行，
   * 使用 CompositionEvent（CJK）或逐字符 InputEvent（非 CJK）触发 Vue 响应式 + API 搜索。
   *
   * @param {number} inputIndex - .cdc-tags-input__input 的索引（0=文章标签, 1=自定义关键词）
   * @param {string} keyword - 要输入的关键词
   * @returns {Promise<{success: boolean, detail?: string, error?: string}>}
   */
  function typeInTagInput(inputIndex, keyword) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "executeInMainWorld",
          code: "tencent_searchTag",
          args: { inputIndex, keyword },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: "no response" });
          }
        }
      );
    });
  }

  class TencentCloudPublisher extends BasePublisher {
    constructor() {
      super("tencent-cloud");
      this.publishSelectors = [];
    }

    // ----------------------------------------------------------
    // afterFill — 打开发布面板 → 填写配置 → 确认发布 → 检测结果
    // ----------------------------------------------------------

    async afterFill() {
      log("Step 1: 点击去发布");
      const publishBtn = await this.waitForElement(
        ".cdc-btn.cdc-btn--primary",
        8000
      );
      if (!publishBtn) {
        throw new Error("未找到去发布按钮 .cdc-btn.cdc-btn--primary");
      }
      publishBtn.click();

      log("等待发布设置面板");
      const drawer = await this.waitForElement(
        ".editor-publish-drawer",
        8000
      );
      if (!drawer) {
        throw new Error("发布设置面板未出现 .editor-publish-drawer");
      }
      await this.delay(500);

      await this._selectArticleSource();
      await this._fillArticleTags();
      await this._fillCustomKeywords();
      await this._fillSummary();

      log("Step 3: 点击确认发布...");
      const confirmBtn = await this._findConfirmButton(publishBtn, 10000);
      if (!confirmBtn) {
        throw new Error(
          "未找到确认发布按钮，文章可能未发布（仅保存为草稿）"
        );
      }
      log(`点击确认: "${confirmBtn.textContent.trim()}"`);
      confirmBtn.click();

      await this._waitForPublishResult();
    }

    // ----------------------------------------------------------
    // 文章来源选择
    // ----------------------------------------------------------

    /**
     * TDesign radio: .t-radio__former, value=1(原创)/2(转载)/3(翻译)
     * 必须点击 .t-radio 容器才能触发 Vue 响应式更新
     */
    async _selectArticleSource() {
      log("选择文章来源: 原创...");
      const radios = document.querySelectorAll(
        ".editor-publish-drawer input[type='radio'].t-radio__former"
      );

      if (radios.length === 0) {
        console.warn("[tencent-cloud] 未找到文章来源 radio 按钮");
        return;
      }

      let targetRadio = [...radios].find((r) => r.value === "1") || radios[0];

      const label = targetRadio.closest(".t-radio");
      if (label) {
        label.click();
      } else {
        targetRadio.click();
      }
      await this.delay(300);

      if (!targetRadio.checked) {
        log("radio click 未生效，fallback 直接设 checked + dispatch change");
        targetRadio.checked = true;
        targetRadio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      log("文章来源已选择: 原创 ✓");
    }

    // ----------------------------------------------------------
    // 文章标签（必填） — 搜索 API + 下拉选择
    // ----------------------------------------------------------

    async _fillArticleTags() {
      const config = this.publishConfig || {};
      let tags = config.tags;
      if (typeof tags === "string") {
        tags = tags.split(",").map(s => s.trim()).filter(Boolean);
      }
      if (!tags || tags.length === 0) {
        throw new Error("无标签配置，文章标签为必填项，请在平台设置中配置 tags");
      }

      log(`填充文章标签: ${tags.join(", ")}`);
      const tagInputs = document.querySelectorAll(".cdc-tags-input__input");
      const articleTagInput = tagInputs[0];
      if (!articleTagInput) {
        throw new Error("未找到文章标签输入框（.cdc-tags-input__input index 0）");
      }

      const articleTags = tags.slice(0, 3);
      let selectedCount = 0;

      for (const tag of articleTags) {
        const success = await this._searchAndSelectTag(articleTagInput, tag);
        if (success) {
          selectedCount++;
        } else {
          log(`  文章标签 "${tag}" 搜索无结果或选择失败，跳过`);
        }
      }

      if (selectedCount === 0) {
        throw new Error(`文章标签选择失败: 尝试了 ${articleTags.join(", ")} 但均无结果`);
      }
      log(`文章标签填充完成: ${selectedCount}/${articleTags.length} 个标签已选择`);
    }

    async _searchAndSelectTag(input, keyword) {
      log(`  搜索文章标签: "${keyword}"`);
      const resp = await typeInTagInput(0, keyword);

      if (!resp || !resp.success) {
        log(`  MAIN world 输入模拟失败:`, resp);
        return false;
      }

      await this.delay(1200);

      let items = document.querySelectorAll(
        ".cdc-tags-input__dropdown-item-text"
      );
      log(`  dropdown items: ${items.length}`);

      if (items.length === 0) {
        await this.delay(1500);
        items = document.querySelectorAll(
          ".cdc-tags-input__dropdown-item-text"
        );
        log(`  dropdown items (retry): ${items.length}`);
      }
      if (items.length === 0) {
        log(`  标签 "${keyword}" 搜索无下拉结果`);
        return false;
      }

      let targetItem = [...items].find(
        (el) => el.textContent.trim().toLowerCase() === keyword.toLowerCase()
      );
      if (!targetItem) {
        targetItem = items[0];
        log(`  无精确匹配，选择第一个: "${targetItem.textContent.trim()}"`);
      }

      targetItem.click();
      await this.delay(400);
      log(`  文章标签 "${targetItem.textContent.trim()}" 已选择 ✓`);
      return true;
    }

    // ----------------------------------------------------------
    // 自定义关键词（可选） — Enter 键创建
    // ----------------------------------------------------------

    async _fillCustomKeywords() {
      const config = this.publishConfig || {};
      let tags = config.tags;
      if (typeof tags === "string") {
        tags = tags.split(",").map(s => s.trim()).filter(Boolean);
      }
      if (!tags || tags.length === 0) {
        return;
      }

      const tagInputs = document.querySelectorAll(".cdc-tags-input__input");
      const keywordInput = tagInputs.length >= 2 ? tagInputs[1] : null;
      if (!keywordInput) {
        log("未找到自定义关键词输入框（index 1），跳过");
        return;
      }

      log(`填充自定义关键词: ${tags.join(", ")}`);

      for (const tag of tags.slice(0, 5)) {
        const resp = await typeInTagInput(1, tag);

        if (!resp || !resp.success) {
          log(`  自定义关键词 "${tag}" MAIN world 输入失败:`, resp);
          continue;
        }
        await this.delay(300);

        keywordInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          })
        );
        await this.delay(200);
        keywordInput.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          })
        );
        await this.delay(400);
        log(`  自定义关键词 "${tag}" 已添加 ✓`);
      }
    }

    // ----------------------------------------------------------
    // 摘要填充 — 必须用 nativeInputValueSetter
    // ----------------------------------------------------------

    /**
     * 优先点击"一键提取"按钮从正文自动生成摘要。
     * 降级：去除 markdown 标记后截取前 200 字，用 nativeTextareaSetter 填充。
     */
    async _fillSummary() {
      log("填充摘要...");

      const summaryTextarea = document.querySelector(
        ".editor-publish-drawer__textarea-main"
      );
      if (!summaryTextarea) {
        console.warn("[tencent-cloud] 未找到摘要输入框");
        return;
      }

      const extractBtn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("一键提取")
      );

      if (extractBtn) {
        log('点击"一键提取"按钮...');
        extractBtn.click();
        await this.delay(1500);

        if (summaryTextarea.value && summaryTextarea.value.trim().length > 0) {
          log(
            `一键提取成功: "${summaryTextarea.value.substring(0, 50)}..." (${summaryTextarea.value.length}字)`
          );
          return;
        }
        log("一键提取未生成内容，降级为手动填充");
      }

      const content =
        this.articleData?.markdown_content ||
        this.articleData?.title ||
        "技术文章";
      const plainText = content
        .replace(/^#+\s+/gm, "")
        .replace(/[*_~`]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\n+/g, " ")
        .trim();
      const summary = plainText.substring(0, 200);

      log(
        `手动填充摘要: "${summary.substring(0, 50)}..." (${summary.length}字)`
      );

      summaryTextarea.focus();
      await this.delay(200);
      getNativeTextareaSetter().call(summaryTextarea, summary);
      summaryTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      summaryTextarea.dispatchEvent(new Event("change", { bubbles: true }));
      await this.delay(300);

      if (!summaryTextarea.value || summaryTextarea.value.trim().length === 0) {
        log("WARNING: 摘要填充后 value 仍为空，Vue 响应可能未触发");
      } else {
        log(`摘要已填充: ${summaryTextarea.value.length}字 ✓`);
      }
    }

    // ----------------------------------------------------------
    // 发布结果检测
    // ----------------------------------------------------------

    /**
     * 点击"确认发布"后，检测发布结果。
     *
     * 腾讯云的表单校验失败时不抛异常，只在页面上显示错误提示。
     * 发布成功时显示 toast "发布成功！文章正在审核中"。
     *
     * 检测策略：
     * 1. 监听 addArticle API 请求（通过 XHR/fetch 拦截）
     * 2. 监听 DOM 中的成功/错误提示
     * 3. 超时后检查是否有错误提示
     */
    async _waitForPublishResult() {
      log("等待发布结果...");

      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, arg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          observer.disconnect();
          fn(arg);
        };

        const observer = new MutationObserver(() => {
          const successPortals = document.querySelectorAll(
            ".cdc-portal-wrapper"
          );
          for (const portal of successPortals) {
            if (portal.textContent.includes("发布成功")) {
              log("检测到发布成功提示 ✓");
              settle(resolve);
              return;
            }
          }

          const errorTips = document.querySelectorAll(
            ".cdc-message-tip-container"
          );
          for (const tip of errorTips) {
            const text = tip.textContent.trim();
            if (text && text.length > 0) {
              log(`检测到错误提示: "${text}"`);
              settle(reject, new Error(`腾讯云发布失败: ${text}`));
              return;
            }
          }

          // "请选择文章标签" 等校验错误仅出现在 drawer 内部 DOM，不会触发 toast
          const formErrors = document.querySelectorAll(
            ".editor-publish-drawer .t-input__tips--error, .editor-publish-drawer .cdc-form-item__error"
          );
          for (const err of formErrors) {
            const text = err.textContent.trim();
            if (text && text.length > 0) {
              log(`检测到表单校验错误: "${text}"`);
              settle(reject, new Error(`腾讯云表单校验失败: ${text}`));
              return;
            }
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        const timer = setTimeout(() => {
          const hasError = document.querySelector(
            ".cdc-message-tip-container, .editor-publish-drawer .t-input__tips--error"
          );
          if (hasError && hasError.textContent.trim()) {
            settle(
              reject,
              new Error(
                `腾讯云发布失败（超时）: ${hasError.textContent.trim()}`
              )
            );
          } else {
            const drawerStillOpen = document.querySelector(
              ".editor-publish-drawer"
            );
            if (!drawerStillOpen) {
              log("发布面板已关闭，推测发布成功");
              settle(resolve);
            } else {
              settle(
                reject,
                new Error(
                  "腾讯云发布超时: 未检测到成功或失败提示，发布面板仍打开"
                )
              );
            }
          }
        }, PUBLISH_RESULT_TIMEOUT);

        const immediateError = document.querySelector(
          ".cdc-message-tip-container"
        );
        if (immediateError && immediateError.textContent.trim()) {
          settle(
            reject,
            new Error(
              `腾讯云发布失败: ${immediateError.textContent.trim()}`
            )
          );
        }
      });
    }

    // ----------------------------------------------------------
    // 查找确认发布按钮
    // ----------------------------------------------------------

    async _findConfirmButton(excludeBtn, timeout = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const drawerBtns = [
          ...document.querySelectorAll(
            ".editor-publish-drawer__opt .cdc-btn.cdc-btn--primary, .editor-publish-drawer__opt button"
          ),
        ];
        const match = drawerBtns.find(
          (el) =>
            el !== excludeBtn &&
            !el.disabled &&
            /^(确认发布|发布|提交)$/.test(el.textContent.trim())
        );
        if (match) return match;

        const allBtns = [
          ...document.querySelectorAll(
            ".editor-publish-drawer .cdc-btn.cdc-btn--primary, .editor-publish-drawer button"
          ),
        ];
        const fallback = allBtns.find(
          (el) =>
            el !== excludeBtn &&
            !el.disabled &&
            /^(确认发布|发布|提交)$/.test(el.textContent.trim())
        );
        if (fallback) return fallback;

        await this.delay(300);
      }
      return null;
    }

    // ----------------------------------------------------------
    // 工具方法
    // ----------------------------------------------------------

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

  const publisher = new TencentCloudPublisher();
  publisher.init();
})();
