/**
 * editor-adapters.js — 编辑器适配器
 *
 * 配置驱动的编辑器适配器工厂。
 * 根据后端配置的 editor_type 自动选择合适的适配器来填充内容。
 *
 * 支持的编辑器类型：
 * - codemirror / bytemd — CodeMirror 系列编辑器
 * - monaco — Monaco Editor (VS Code 编辑器内核)
 * - prosemirror — ProseMirror 富文本编辑器
 * - quill — Quill 富文本编辑器
 * - textarea — 原生 textarea
 * - iframe_richtext — iframe 内嵌富文本（如 UEditor）
 * - richtext — 通用 contenteditable 富文本（如 Draft.js）
 * - auto_detect / mixed — 自动检测编辑器类型
 *
 * 全局变量：window.EditorAdapterFactory
 */

(function () {
  "use strict";

  // ============================================================
  // 工具函数
  // ============================================================

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(...args);

  /**
   * 触发原生 DOM 事件，确保框架能捕获到变更
   * @param {HTMLElement} element - 目标元素
   * @param {string[]} eventNames - 要触发的事件名列表
   */
  function dispatchEvents(element, eventNames) {
    eventNames.forEach((name) => {
      element.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    });
  }

  /**
   * 使用 InputEvent 设置元素值（React 等框架能捕获）
   * @param {HTMLElement} element - 目标元素
   * @param {string} value - 要设置的值
   */
  function setNativeValue(element, value) {
    // 获取原生 value setter，绕过 React 等框架的 getter/setter 拦截
    const proto = Object.getPrototypeOf(element);
    const descriptor =
      Object.getOwnPropertyDescriptor(proto, "value") ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    // 触发 InputEvent 让框架感知变更
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" })
    );
    dispatchEvents(element, ["change", "keyup"]);
  }

  /**
   * 尝试使用 execCommand 插入文本
   * @param {HTMLElement} element - 目标元素
   * @param {string} text - 要插入的文本
   * @returns {boolean} 是否成功
   */
  function tryExecCommand(element, text) {
    try {
      element.focus();
      // 全选后替换
      if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
        element.select();
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return document.execCommand("insertText", false, text);
    } catch (e) {
      console.warn("[EditorAdapters] execCommand 失败:", e);
      return false;
    }
  }

  /**
   * 尝试通过剪贴板粘贴内容
   * @param {HTMLElement} element - 目标元素
   * @param {string} text - 要粘贴的文本
   * @param {string} [html] - HTML 格式（可选）
   * @returns {Promise<boolean>} 是否成功
   */
  async function tryClipboardPaste(element, text, html) {
    try {
      element.focus();

      // 构造 paste 事件
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      if (html) {
        clipboardData.setData("text/html", html);
      }

      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });

      element.dispatchEvent(pasteEvent);
      return true;
    } catch (e) {
      console.warn("[EditorAdapters] 剪贴板粘贴失败:", e);
      return false;
    }
  }

  /**
   * 延时工具
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================
  // CodeMirror 适配器
  // ============================================================

  class CodeMirrorAdapter {
    constructor(config) {
      this.config = config || {};
    }

    async fill(element, articleData) {
      const content = articleData.markdown || articleData.html || "";

      // Strategy 1-3: direct JS access (only works in MAIN world, not in content script isolated world)
      if (element.CodeMirror) {
        log("[CodeMirror] 策略1: element.CodeMirror.setValue()");
        element.CodeMirror.setValue(content);
        return true;
      }

      const cmElement = element.closest(".CodeMirror") || element.querySelector(".CodeMirror");
      if (cmElement && cmElement.CodeMirror) {
        log("[CodeMirror] 策略2: .CodeMirror 容器 setValue()");
        cmElement.CodeMirror.setValue(content);
        return true;
      }

      const cm6Element = element.closest(".cm-editor") || element.querySelector(".cm-editor");
      if (cm6Element) {
        const cmView = cm6Element.cmView;
        if (cmView && cmView.view) {
          log("[CodeMirror] 策略3: CodeMirror 6 view.dispatch()");
          const view = cmView.view;
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: content,
            },
          });
          return true;
        }
      }

      // Strategy 4: chrome.scripting.executeScript in MAIN world via service worker
      // In MV3, inline <script> injection is blocked by CSP.
      // Use chrome.scripting.executeScript({ world: "MAIN" }) instead.
      const cmDomElement = element.closest(".CodeMirror") || element.querySelector(".CodeMirror") || document.querySelector(".CodeMirror");
      if (cmDomElement) {
        log("[CodeMirror] 策略4: chrome.scripting MAIN world setValue()");
        const success = await this._fillViaMainWorld(content);
        if (success) return true;
        log("[CodeMirror] MAIN world 执行失败，继续降级");
      }

      // Strategy 5: contenteditable fallback
      const cmContent = element.querySelector(".cm-content") || element.querySelector("[contenteditable]");
      if (cmContent) {
        log("[CodeMirror] 降级使用 contenteditable");
        cmContent.focus();
        if (!tryExecCommand(cmContent, content)) {
          await tryClipboardPaste(cmContent, content);
        }
        return true;
      }

      console.warn("[CodeMirror] 所有策略均失败");
      return false;
    }

    async _fillViaMainWorld(content) {
      try {
        const resp = await chrome.runtime.sendMessage({
          action: "executeInMainWorld",
          code: "codemirror_setValue",
          args: { content },
        });
        return resp && resp.success;
      } catch (e) {
        log("[CodeMirror] MAIN world execution failed:", e.message);
        return false;
      }
    }
  }

  // ============================================================
  // Monaco Editor 适配器
  // ============================================================

  class MonacoAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到 Monaco Editor
     * 降级策略：monaco.editor.getModels() → element 查找 → textarea → execCommand
     * @param {HTMLElement} element - 编辑器容器元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const content = articleData.markdown || articleData.html || "";

      // 策略 1：通过全局 monaco 对象
      if (typeof monaco !== "undefined" && monaco.editor) {
        const models = monaco.editor.getModels();
        if (models.length > 0) {
          log("[Monaco] 使用 monaco.editor.getModels()[0].setValue()");
          models[0].setValue(content);
          return true;
        }

        // 尝试获取编辑器实例
        const editors = monaco.editor.getEditors ? monaco.editor.getEditors() : [];
        if (editors.length > 0) {
          log("[Monaco] 使用 monaco.editor.getEditors()[0].setValue()");
          editors[0].setValue(content);
          return true;
        }
      }

      // 策略 2：通过 DOM 结构查找 textarea
      const textarea = element.querySelector("textarea.inputarea") || element.querySelector("textarea");
      if (textarea) {
        log("[Monaco] 降级使用 textarea");
        textarea.focus();
        if (tryExecCommand(textarea, content)) {
          return true;
        }
      }

      // 策略 3：通过 contenteditable 区域
      const editArea =
        element.querySelector(".view-lines") ||
        element.querySelector("[contenteditable]");
      if (editArea) {
        log("[Monaco] 降级使用 contenteditable 区域");
        editArea.focus();
        await tryClipboardPaste(editArea, content);
        return true;
      }

      console.warn("[Monaco] 所有策略均失败");
      return false;
    }
  }

  // ============================================================
  // ProseMirror 适配器
  // ============================================================

  class ProseMirrorAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到 ProseMirror 编辑器
     *
     * ProseMirror 维护独立的内部文档状态（EditorState），直接修改 innerHTML
     * 不会触发 ProseMirror transaction，导致内部状态与 DOM 不一致。
     * 因此必须优先使用剪贴板粘贴（ClipboardEvent），ProseMirror 的 clipboard
     * handler 会正确解析 HTML 并创建 transaction 更新内部状态。
     *
     * 降级策略：clipboard paste → execCommand insertHTML → innerHTML（最后兜底）
     * @param {HTMLElement} element - 编辑器容器元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      // ProseMirror 使用 HTML 内容
      const htmlContent = articleData.html || `<p>${articleData.markdown || ""}</p>`;

      // 找到 ProseMirror 的编辑区域
      const editor =
        element.querySelector(".ProseMirror") ||
        element.querySelector("[contenteditable=true]") ||
        (element.getAttribute("contenteditable") === "true" ? element : null);

      if (!editor) {
        console.warn("[ProseMirror] 找不到编辑区域");
        return false;
      }

      // 记录替换前的文本长度，用于验证内容是否成功写入
      const beforeText = editor.innerText || "";

      // 策略 1（推荐）：通过剪贴板粘贴 HTML — ProseMirror 能正确处理
      try {
        log("[ProseMirror] 策略 1: 剪贴板粘贴（推荐）");
        editor.focus();
        // 先全选清除已有内容
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel.removeAllRanges();
        sel.addRange(range);

        const pasted = await tryClipboardPaste(editor, articleData.markdown || "", htmlContent);
        if (pasted) {
          await delay(500);
          // 验证内容确实被插入（ProseMirror 可能静默忽略 paste 事件）
          const afterText = editor.innerText || "";
          if (afterText.length > beforeText.length || afterText !== beforeText) {
            log("[ProseMirror] 策略 1 成功：内容已通过剪贴板粘贴");
            return true;
          }
          log("[ProseMirror] 策略 1 粘贴事件被忽略，内容未变化，降级...");
        }
      } catch (e) {
        console.warn("[ProseMirror] 剪贴板粘贴失败:", e);
      }

      // 策略 2：execCommand insertHTML — 部分 ProseMirror 也支持
      try {
        log("[ProseMirror] 策略 2: execCommand insertHTML");
        editor.focus();
        document.execCommand("selectAll", false, null);
        const ok = document.execCommand("insertHTML", false, htmlContent);
        if (ok) {
          await delay(300);
          const afterText = editor.innerText || "";
          if (afterText.length > beforeText.length || afterText !== beforeText) {
            log("[ProseMirror] 策略 2 成功：内容已通过 execCommand 插入");
            return true;
          }
          log("[ProseMirror] 策略 2 execCommand 返回 true 但内容未变化，降级...");
        }
      } catch (e) {
        console.warn("[ProseMirror] execCommand insertHTML 失败:", e);
      }

      // 策略 3（兜底）：innerHTML + 完整事件序列
      // 直接设置 innerHTML 不更新 ProseMirror 内部 EditorState，
      // 但通过触发完整的 input → selectionchange → compositionend → blur/focus 事件链，
      // 可以让 Syllepsis/ProseMirror 框架检测到 DOM 变更并将其同步到内部状态。
      // 这个事件序列参考了多个成功的头条自动化项目（axdlee/toutiao-publish 等）。
      try {
        log("[ProseMirror] 策略 3（兜底）: innerHTML + 完整 ProseMirror 事件序列");
        editor.focus();
        editor.innerHTML = htmlContent;

        // 阶段 1：触发 input 事件（通知 DOM 变更）
        editor.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

        // 阶段 2：触发 selectionchange（ProseMirror 监听 document 级别的 selectionchange）
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));

        // 阶段 3：触发 compositionend（关键！ProseMirror 用此事件做 DOM→State 同步）
        editor.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: editor.innerText,
          })
        );

        // 阶段 4：触发 change
        editor.dispatchEvent(new Event("change", { bubbles: true }));

        // 阶段 5：blur/focus 循环触发保存逻辑
        await delay(150);
        editor.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
        await delay(100);
        editor.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

        await delay(200);
        log("[ProseMirror] 策略 3 完成：已触发完整事件序列");
        return true;
      } catch (e) {
        console.warn("[ProseMirror] innerHTML + 事件序列失败:", e);
      }

      console.warn("[ProseMirror] 所有策略均失败");
      return false;
    }
  }


  // ============================================================
  // Quill 适配器
  // ============================================================

  class QuillAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到 Quill 编辑器
     * 降级策略：Quill 实例 API → innerHTML → clipboard paste → execCommand
     * @param {HTMLElement} element - 编辑器容器元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const htmlContent = articleData.html || `<p>${articleData.markdown || ""}</p>`;

      // 策略 1：查找 Quill 实例
      const quillContainer = element.closest(".ql-container") || element.querySelector(".ql-container");
      if (quillContainer && quillContainer.__quill) {
        log("[Quill] 使用 Quill 实例 API");
        const quill = quillContainer.__quill;
        quill.clipboard.dangerouslyPasteHTML(htmlContent);
        return true;
      }

      // 策略 2：通过全局 Quill
      if (typeof Quill !== "undefined") {
        const qlEditor = element.querySelector(".ql-editor") || element;
        const quillInstances = Quill.find(qlEditor);
        if (quillInstances) {
          log("[Quill] 使用 Quill.find() 实例");
          quillInstances.clipboard.dangerouslyPasteHTML(htmlContent);
          return true;
        }
      }

      // 策略 3：直接操作 .ql-editor
      const qlEditor =
        element.querySelector(".ql-editor") ||
        (element.classList.contains("ql-editor") ? element : null);
      if (qlEditor) {
        log("[Quill] 降级使用 innerHTML");
        qlEditor.focus();
        qlEditor.innerHTML = htmlContent;
        dispatchEvents(qlEditor, ["input", "change"]);
        await delay(100);
        return true;
      }

      // 策略 4：contenteditable
      const editable = element.querySelector("[contenteditable=true]");
      if (editable) {
        log("[Quill] 降级使用 contenteditable");
        editable.focus();
        editable.innerHTML = htmlContent;
        dispatchEvents(editable, ["input", "change"]);
        return true;
      }

      console.warn("[Quill] 所有策略均失败");
      return false;
    }
  }

  // ============================================================
  // Textarea 适配器
  // ============================================================

  class TextareaAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到 textarea 或 input
     * 降级策略：setNativeValue → execCommand → 直接赋值
     * @param {HTMLElement} element - textarea 或 input 元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const content = articleData.markdown || articleData.html || "";

      const target =
        element.tagName === "TEXTAREA" || element.tagName === "INPUT"
          ? element
          : element.querySelector("textarea") || element.querySelector("input[type=text]");

      if (!target) {
        console.warn("[Textarea] 找不到 textarea/input 元素");
        return false;
      }

      // 策略 1：使用 setNativeValue（兼容 React）
      try {
        log("[Textarea] 使用 setNativeValue");
        setNativeValue(target, content);
        return true;
      } catch (e) {
        console.warn("[Textarea] setNativeValue 失败:", e);
      }

      // 策略 2：execCommand
      log("[Textarea] 降级使用 execCommand");
      target.focus();
      target.select();
      if (tryExecCommand(target, content)) {
        return true;
      }

      // 策略 3：直接赋值
      log("[Textarea] 再降级直接赋值 value");
      target.value = content;
      dispatchEvents(target, ["input", "change", "keyup"]);
      return true;
    }
  }

  // ============================================================
  // iframe 富文本适配器（UEditor 等）
  // ============================================================

  class IframeAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到 iframe 内嵌的富文本编辑器
     * 降级策略：UEditor API → iframe body innerHTML → contentDocument → execCommand
     * @param {HTMLElement} element - iframe 元素或其容器
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const htmlContent = articleData.html || `<p>${articleData.markdown || ""}</p>`;

      // 找到 iframe
      const iframe =
        element.tagName === "IFRAME"
          ? element
          : element.querySelector("iframe");

      if (!iframe) {
        console.warn("[Iframe] 找不到 iframe 元素");
        return false;
      }

      // 策略 1：通过 UEditor API
      if (typeof UE !== "undefined") {
        const editorId = iframe.id || this.config.editor_id;
        if (editorId) {
          const ueInstance = UE.getEditor(editorId);
          if (ueInstance && ueInstance.setContent) {
            log("[Iframe] 使用 UEditor API");
            ueInstance.setContent(htmlContent);
            return true;
          }
        }
      }

      // 策略 2：直接操作 iframe body
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const body = iframeDoc.body;
        if (body) {
          log("[Iframe] 使用 iframe body.innerHTML");
          body.innerHTML = htmlContent;
          dispatchEvents(body, ["input", "change"]);
          return true;
        }
      } catch (e) {
        console.warn("[Iframe] 无法访问 iframe 内容（跨域?）:", e);
      }

      // 策略 3：通过 postMessage（跨域 iframe）
      try {
        log("[Iframe] 尝试 postMessage");
        iframe.contentWindow.postMessage(
          { type: "mp-fill-content", html: htmlContent },
          "*"
        );
        // 等待一会儿看是否成功（无法确定，返回 true）
        await delay(500);
        return true;
      } catch (e) {
        console.warn("[Iframe] postMessage 失败:", e);
      }

      console.warn("[Iframe] 所有策略均失败");
      return false;
    }
  }

  // ============================================================
  // 通用富文本适配器（contenteditable / Draft.js 等）
  // ============================================================

  class RichTextAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 填充内容到通用富文本编辑器
     * 降级策略：innerHTML + input → clipboard paste → execCommand
     * @param {HTMLElement} element - contenteditable 元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const htmlContent = articleData.html || `<p>${articleData.markdown || ""}</p>`;

      const editable =
        element.getAttribute("contenteditable") === "true"
          ? element
          : element.querySelector("[contenteditable=true]");

      if (!editable) {
        console.warn("[RichText] 找不到 contenteditable 元素");
        return false;
      }

      // 策略 1：innerHTML + 事件触发
      try {
        log("[RichText] 使用 innerHTML + input 事件");
        editable.focus();
        editable.innerHTML = htmlContent;
        dispatchEvents(editable, ["input", "change"]);
        await delay(100);
        return true;
      } catch (e) {
        console.warn("[RichText] innerHTML 失败:", e);
      }

      // 策略 2：剪贴板粘贴
      log("[RichText] 降级使用剪贴板粘贴");
      editable.focus();
      const pasted = await tryClipboardPaste(editable, articleData.markdown || "", htmlContent);
      if (pasted) return true;

      // 策略 3：execCommand
      log("[RichText] 再降级使用 execCommand insertHTML");
      editable.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertHTML", false, htmlContent);
        return true;
      } catch (e) {
        console.warn("[RichText] execCommand insertHTML 失败:", e);
      }

      console.warn("[RichText] 所有策略均失败");
      return false;
    }
  }

  // ============================================================
  // 自动检测适配器
  // ============================================================

  class AutoDetectAdapter {
    constructor(config) {
      this.config = config || {};
    }

    /**
     * 自动检测编辑器类型
     * 检测优先级：CodeMirror → Monaco → ProseMirror → Quill → textarea → contenteditable
     * @param {HTMLElement} containerElement - 容器元素
     * @returns {object|null} { type: string, adapter: BaseAdapter }
     */
    detect(containerElement) {
      // CodeMirror 5
      if (
        containerElement.querySelector(".CodeMirror") ||
        containerElement.closest(".CodeMirror") ||
        containerElement.CodeMirror
      ) {
        return { type: "codemirror", adapter: new CodeMirrorAdapter(this.config) };
      }

      // CodeMirror 6
      if (
        containerElement.querySelector(".cm-editor") ||
        containerElement.closest(".cm-editor")
      ) {
        return { type: "codemirror", adapter: new CodeMirrorAdapter(this.config) };
      }

      // ByteMD (底层是 CodeMirror)
      if (
        containerElement.querySelector(".bytemd") ||
        containerElement.closest(".bytemd")
      ) {
        return { type: "codemirror", adapter: new CodeMirrorAdapter(this.config) };
      }

      // Monaco
      if (
        containerElement.querySelector(".monaco-editor") ||
        containerElement.closest(".monaco-editor") ||
        (typeof monaco !== "undefined")
      ) {
        return { type: "monaco", adapter: new MonacoAdapter(this.config) };
      }

      // ProseMirror
      if (
        containerElement.querySelector(".ProseMirror") ||
        containerElement.closest(".ProseMirror")
      ) {
        return { type: "prosemirror", adapter: new ProseMirrorAdapter(this.config) };
      }

      // Quill
      if (
        containerElement.querySelector(".ql-editor") ||
        containerElement.querySelector(".ql-container") ||
        containerElement.closest(".ql-container")
      ) {
        return { type: "quill", adapter: new QuillAdapter(this.config) };
      }

      // iframe（UEditor 等）
      const iframe = containerElement.querySelector("iframe");
      if (iframe) {
        return { type: "iframe_richtext", adapter: new IframeAdapter(this.config) };
      }

      // textarea
      const textarea = containerElement.querySelector("textarea");
      if (textarea || containerElement.tagName === "TEXTAREA") {
        return { type: "textarea", adapter: new TextareaAdapter(this.config) };
      }

      // contenteditable
      const editable = containerElement.querySelector("[contenteditable=true]");
      if (editable || containerElement.getAttribute("contenteditable") === "true") {
        return { type: "richtext", adapter: new RichTextAdapter(this.config) };
      }

      return null;
    }

    /**
     * 自动检测并填充
     * @param {HTMLElement} element - 编辑器容器元素
     * @param {object} articleData - { markdown, html, title }
     */
    async fill(element, articleData) {
      const detected = this.detect(element);
      if (detected) {
        log(`[AutoDetect] 检测到 ${detected.type} 编辑器`);
        return detected.adapter.fill(element, articleData);
      }

      // 最后兜底：尝试所有适配器
      console.warn("[AutoDetect] 无法自动检测编辑器类型，逐一尝试");
      const adapters = [
        new CodeMirrorAdapter(this.config),
        new MonacoAdapter(this.config),
        new ProseMirrorAdapter(this.config),
        new QuillAdapter(this.config),
        new TextareaAdapter(this.config),
        new RichTextAdapter(this.config),
        new IframeAdapter(this.config),
      ];

      for (const adapter of adapters) {
        try {
          const result = await adapter.fill(element, articleData);
          if (result) return true;
        } catch {
          // 继续尝试下一个
        }
      }

      console.error("[AutoDetect] 所有适配器均失败");
      return false;
    }
  }

  // ============================================================
  // 适配器工厂
  // ============================================================

  /**
   * 编辑器适配器工厂
   * 根据 editor_type 创建对应的适配器
   */
  class EditorAdapterFactory {
    /**
     * @param {string} editorType - 编辑器类型标识
     * @param {object} config - 编辑器配置
     * @returns {object} 适配器实例
     */
    static create(editorType, config) {
      switch (editorType) {
        case "codemirror":
          return new CodeMirrorAdapter(config);
        case "bytemd":
          return new CodeMirrorAdapter(config); // ByteMD 底层也是 CodeMirror
        case "monaco":
          return new MonacoAdapter(config);
        case "prosemirror":
          return new ProseMirrorAdapter(config);
        case "quill":
          return new QuillAdapter(config);
        case "textarea":
          return new TextareaAdapter(config);
        case "iframe_richtext":
          return new IframeAdapter(config);
        case "richtext":
          return new RichTextAdapter(config);
        case "markdown":
          return new AutoDetectAdapter(config);
        case "auto_detect":
        case "mixed":
          return new AutoDetectAdapter(config);
        default:
          console.warn(`[EditorAdapterFactory] 未知编辑器类型 "${editorType}"，使用自动检测`);
          return new AutoDetectAdapter(config);
      }
    }
  }

  // ============================================================
  // 导出到全局
  // ============================================================

  window.EditorAdapterFactory = EditorAdapterFactory;

  // 也导出各个适配器，方便直接使用
  window.EditorAdapters = {
    CodeMirrorAdapter,
    MonacoAdapter,
    ProseMirrorAdapter,
    QuillAdapter,
    TextareaAdapter,
    IframeAdapter,
    RichTextAdapter,
    AutoDetectAdapter,
  };
})();
