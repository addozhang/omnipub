/**
 * segmentfault.js — 思否适配器
 *
 * 思否使用 CodeMirror Markdown 编辑器。
 * 标题：#title
 * 发布：.btn.btn-primary（文字"提交"，标题+内容+标签都填好后启用）
 *
 * 标签面板结构：
 *   #tags-toggle (dropdown-toggle) → 点击打开/关闭面板
 *   .dropdown-menu.show → 面板容器
 *     input[type="search"] → 搜索框（native setter 触发 React）
 *     #tagSearchResult → 搜索结果区（.dropdown-item.search-item）
 *     .tab-content → 分类 tab，每个 tab 里有 .badge-tag（<a>）
 *   选中后标签显示为 button.tag-input（在 #tags-toggle 的同级）
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  class SegmentfaultPublisher extends BasePublisher {
    constructor() {
      super("segmentfault");
      this.publishSelectors = [".btn.btn-primary"];
      this._tagsApplied = false;
    }

    async fillPublishConfig(config) {
      const tags = config?.tags;
      if (!Array.isArray(tags) || tags.length === 0) return;

      log("[segmentfault] fillPublishConfig: 使用用户配置的标签", tags);
      try {
        await this._ensureTagPanelOpen();
        await this._selectSpecificTags(tags);
        if (this._getSelectedTagCount() > 0) {
          this._tagsApplied = true;
          log("[segmentfault] 标签设置成功，已选", this._getSelectedTagCount(), "个");
        } else {
          console.warn("[segmentfault] 标签设置后未检测到已选标签，将在 afterFill 中回退");
        }
      } catch (e) {
        console.warn("[segmentfault] fillPublishConfig 标签设置失败:", e.message);
      }
    }

    async afterFill() {
      if (!this._tagsApplied) {
        try {
          await this._selectFallbackTag();
        } catch (e) {
          console.warn(`[segmentfault] 填充标签失败:`, e.message);
        }
      }

      log("[segmentfault] 等待提交按钮可用...");
      const btn = await this._waitForSubmitButton(15000);
      if (!btn) {
        throw new Error("提交按钮未找到或未启用，内容可能未填充完成");
      }
      log("[segmentfault] 点击提交...");
      btn.click();
    }

    /**
     * 确保标签面板打开。幂等 — 已开则跳过。
     * 判断依据：#tags-toggle 的 aria-expanded 属性
     */
    async _ensureTagPanelOpen() {
      const toggle = document.querySelector("#tags-toggle");
      if (toggle?.getAttribute("aria-expanded") === "true") {
        log("[segmentfault] 标签面板已打开，跳过");
        return;
      }

      if (!toggle) {
        // Fallback: 文本搜索
        const allBtns = document.querySelectorAll("a, button, span");
        for (const el of allBtns) {
          if (el.textContent?.trim().includes("添加标签") && el.offsetHeight > 0) {
            el.click();
            await this.delay(1500);
            return;
          }
        }
        throw new Error("未找到 '添加标签' 按钮");
      }

      toggle.click();
      await this.delay(1500);
    }

    /**
     * 清空搜索框，恢复默认标签列表
     */
    async _clearSearch() {
      const input = document.querySelector('.dropdown-menu.show input[type="search"]');
      if (!input) return;
      if (!input.value) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeSetter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await this.delay(300);
    }

    /**
     * 搜索并选择用户配置的标签
     */
    async _selectSpecificTags(tags) {
      const searchInput = document.querySelector('.dropdown-menu.show input[type="search"]');

      if (searchInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

        for (const tag of tags.slice(0, 5)) {
          log(`[segmentfault] 搜索标签: "${tag}"`);

          // 清空搜索
          searchInput.focus();
          nativeSetter.call(searchInput, "");
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          await this.delay(300);

          // 输入标签名
          nativeSetter.call(searchInput, tag);
          searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          await this.delay(1200);

          // 搜索结果在 #tagSearchResult 里，是 .dropdown-item.search-item
          const picked = this._pickSearchResult(tag) || this._findMatchingBadge(tag);
          if (picked) {
            picked.click();
            log(`[segmentfault] 选中: "${picked.textContent?.trim()}"`);
          } else {
            // 回车确认自定义标签
            searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
            log(`[segmentfault] 回车确认自定义标签: "${tag}"`);
          }
          await this.delay(500);

          // 选标签后面板可能关闭，重新打开
          await this._ensureTagPanelOpen();
        }

        // 清空搜索框，恢复 badge 列表
        await this._clearSearch();
      } else {
        // 无搜索框，直接在 badge 里找
        for (const tag of tags.slice(0, 5)) {
          const badge = this._findMatchingBadge(tag);
          if (badge) {
            badge.click();
            log(`[segmentfault] 选中标签: "${badge.textContent?.trim()}"`);
            await this.delay(500);
          } else {
            console.warn(`[segmentfault] 未找到匹配标签: "${tag}"`);
          }
        }
      }
    }

    /**
     * 在搜索结果区域（#tagSearchResult）查找匹配项
     */
    _pickSearchResult(tagName) {
      const container = document.querySelector("#tagSearchResult");
      if (!container) return null;

      const items = container.querySelectorAll(".dropdown-item, .search-item, a");
      const normalized = tagName.toLowerCase().trim();

      // 优先精确匹配
      for (const item of items) {
        if (item.offsetHeight > 0 && item.textContent?.trim().toLowerCase() === normalized) return item;
      }
      // 包含匹配
      for (const item of items) {
        if (item.offsetHeight > 0 && item.textContent?.trim().toLowerCase().includes(normalized)) return item;
      }
      return null;
    }

    /**
     * 在 .badge-tag 列表中查找匹配项
     */
    _findMatchingBadge(tagName) {
      const badges = document.querySelectorAll(".badge-tag");
      const normalized = tagName.toLowerCase().trim();
      for (const b of badges) {
        if (b.offsetHeight > 0 && b.textContent?.trim().toLowerCase() === normalized) return b;
      }
      for (const b of badges) {
        if (b.offsetHeight > 0 && b.textContent?.trim().toLowerCase().includes(normalized)) return b;
      }
      return null;
    }

    /**
     * 获取已选标签数量。选中的标签显示为 button.tag-input
     */
    _getSelectedTagCount() {
      const toggle = document.querySelector("#tags-toggle");
      if (!toggle) return 0;
      const container = toggle.parentElement;
      if (!container) return 0;
      return container.querySelectorAll("button.tag-input").length;
    }

    /**
     * 回退选择：打开面板，清空搜索，点击第一个可见 badge
     */
    async _selectFallbackTag() {
      await this._ensureTagPanelOpen();
      await this._clearSearch();

      let badge = null;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        badge = document.querySelector(".badge-tag");
        if (badge && badge.offsetHeight > 0) break;
        badge = null;
        await this.delay(300);
      }

      if (!badge) {
        console.warn("[segmentfault] 未找到 .badge-tag 标签选项");
        return;
      }

      log(`[segmentfault] 回退选择标签: "${badge.textContent?.trim()}"`);
      badge.click();
      await this.delay(500);
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async _waitForSubmitButton(timeout = 10000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const btns = document.querySelectorAll(".btn.btn-primary");
        for (const el of btns) {
          const text = el.textContent?.trim();
          if (text === "提交" && !el.disabled) return el;
        }
        await this.delay(300);
      }
      return null;
    }
  }

  const publisher = new SegmentfaultPublisher();
  publisher.init();
})();
