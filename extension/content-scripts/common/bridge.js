/**
 * bridge.js — 页面 ↔ 插件通信桥
 *
 * 提供 content-script 与 service-worker 之间的消息传递封装，
 * 以及页面脚本与 content-script 之间通过 window.postMessage 的通信。
 *
 * 全局变量：window.MessageBridge
 */

(function () {
  "use strict";

  /**
   * 消息通信桥
   */
  const MessageBridge = {
    /**
     * 向 service-worker (background) 发送消息并等待响应
     * @param {object} message - 消息对象，必须包含 action 字段
     * @returns {Promise<object>} service-worker 的响应
     */
    sendToBackground(message) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          });
        } catch (e) {
          reject(e);
        }
      });
    },

    /**
     * 获取当前 session
     * @returns {Promise<string|null>}
     */
    async getSession() {
      const resp = await this.sendToBackground({ action: "getSession" });
      return resp && resp.success ? resp.data : null;
    },

    /**
     * 上报发布结果
     * @param {object} data - { publication_id, platform_article_id?, article_url?, status }
     * @returns {Promise<object>}
     */
    async reportPublishResult(data) {
      return this.sendToBackground({
        action: "reportPublishResult",
        data,
      });
    },

    /**
     * 上报统计数据
     * @param {number} publicationId - 发布记录 ID
     * @param {object} stats - { view_count, like_count, comment_count, collect_count }
     * @returns {Promise<object>}
     */
    async reportStats(publicationId, stats) {
      return this.sendToBackground({
        action: "reportStats",
        publicationId,
        stats,
      });
    },

    /**
     * 监听来自页面脚本的 postMessage 消息
     * @param {string} type - 消息类型标识
     * @param {function} handler - 处理函数 (data) => void
     */
    onPageMessage(type, handler) {
      window.addEventListener("message", (event) => {
        // 只接受同源消息
        if (event.source !== window) return;
        if (!event.data || event.data.type !== type) return;
        handler(event.data);
      });
    },

    /**
     * 向页面脚本发送 postMessage 消息
     * @param {string} type - 消息类型标识
     * @param {object} data - 附加数据
     */
    sendToPage(type, data) {
      window.postMessage({ type, ...data }, "*");
    },

    /**
     * 监听来自其他 content-script 或 background 的 runtime 消息
     * @param {string} action - 消息 action 标识
     * @param {function} handler - 处理函数 (message, sender) => response
     */
    onRuntimeMessage(action, handler) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action !== action) return false;

        const result = handler(message, sender);

        // 支持异步 handler
        if (result instanceof Promise) {
          result
            .then(sendResponse)
            .catch((e) => sendResponse({ success: false, error: e.message }));
          return true; // 异步响应
        }

        if (result !== undefined) {
          sendResponse(result);
        }
        return false;
      });
    },
  };

  // ============================================================
  // 导出到全局
  // ============================================================

  window.MessageBridge = MessageBridge;
})();
