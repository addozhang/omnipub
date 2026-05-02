/**
 * overlay.js — 填充覆盖层 UI
 *
 * 在填充过程中显示全屏半透明覆盖层，阻止用户操作，避免干扰填充过程。
 *
 * 全局函数：
 * - window.showOverlay(message) — 显示覆盖层
 * - window.hideOverlay() — 隐藏覆盖层
 * - window.updateOverlay(message) — 更新覆盖层文案
 */

(function () {
  "use strict";

  /** 覆盖层元素引用 */
  let overlayElement = null;

  /** 文案元素引用 */
  let messageElement = null;

  /** 进度条元素引用 */
  let progressElement = null;

  /**
   * 创建覆盖层 DOM 结构
   */
  function createOverlay() {
    if (overlayElement) return;

    overlayElement = document.createElement("div");
    overlayElement.id = "mp-publisher-overlay";
    overlayElement.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 100vw",
      "height: 100vh",
      "background: rgba(0, 0, 0, 0.5)",
      "display: flex",
      "flex-direction: column",
      "align-items: center",
      "justify-content: center",
      "z-index: 2147483647", // 最大 z-index
      "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "pointer-events: all",
      "opacity: 0",
      "transition: opacity 0.3s ease",
    ].join(";");

    // 内容容器
    const container = document.createElement("div");
    container.style.cssText = [
      "background: #fff",
      "border-radius: 12px",
      "padding: 32px 40px",
      "text-align: center",
      "box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3)",
      "max-width: 400px",
      "width: 80%",
    ].join(";");

    // Logo / 图标
    const icon = document.createElement("div");
    icon.style.cssText = [
      "width: 48px",
      "height: 48px",
      "margin: 0 auto 16px",
      "background: #2563eb",
      "border-radius: 10px",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "color: #fff",
      "font-size: 20px",
      "font-weight: bold",
    ].join(";");
    icon.textContent = "M";

    // 文案
    messageElement = document.createElement("div");
    messageElement.style.cssText = [
      "font-size: 16px",
      "color: #333",
      "font-weight: 500",
      "margin-bottom: 16px",
      "line-height: 1.5",
    ].join(";");

    // 进度条容器
    const progressContainer = document.createElement("div");
    progressContainer.style.cssText = [
      "width: 100%",
      "height: 4px",
      "background: #e5e7eb",
      "border-radius: 2px",
      "overflow: hidden",
    ].join(";");

    // 进度条（动画）
    progressElement = document.createElement("div");
    progressElement.style.cssText = [
      "width: 30%",
      "height: 100%",
      "background: #2563eb",
      "border-radius: 2px",
      "animation: mp-progress 1.5s ease-in-out infinite",
    ].join(";");

    // 注入动画 CSS
    const style = document.createElement("style");
    style.textContent = `
      @keyframes mp-progress {
        0% { transform: translateX(-100%); }
        50% { transform: translateX(200%); }
        100% { transform: translateX(-100%); }
      }
    `;
    document.head.appendChild(style);

    // 提示文字
    const hint = document.createElement("div");
    hint.style.cssText = [
      "font-size: 12px",
      "color: #999",
      "margin-top: 12px",
    ].join(";");
    hint.textContent = "请勿操作页面，填充完成后将自动恢复";

    // 组装 DOM
    progressContainer.appendChild(progressElement);
    container.appendChild(icon);
    container.appendChild(messageElement);
    container.appendChild(progressContainer);
    container.appendChild(hint);
    overlayElement.appendChild(container);

    // 阻止所有点击穿透
    overlayElement.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    overlayElement.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });

    overlayElement.addEventListener("keydown", (e) => {
      // 允许 Escape 关闭
      if (e.key === "Escape") {
        hideOverlay();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
    });
  }

  /**
   * 显示覆盖层
   * @param {string} message - 显示的文案
   */
  function showOverlay(message) {
    createOverlay();

    messageElement.textContent = message || "正在填充文章内容...";

    if (!overlayElement.parentNode) {
      document.body.appendChild(overlayElement);
    }

    // 强制重排后启动过渡动画
    void overlayElement.offsetHeight;
    overlayElement.style.opacity = "1";
  }

  /**
   * 隐藏覆盖层
   */
  function hideOverlay() {
    if (!overlayElement) return;

    overlayElement.style.opacity = "0";

    setTimeout(() => {
      if (overlayElement && overlayElement.parentNode) {
        overlayElement.parentNode.removeChild(overlayElement);
      }
    }, 300); // 等待过渡动画完成
  }

  /**
   * 更新覆盖层文案
   * @param {string} message - 新的文案
   */
  function updateOverlay(message) {
    if (messageElement) {
      messageElement.textContent = message;
    }
  }

  // ============================================================
  // 导出到全局
  // ============================================================

  window.showOverlay = showOverlay;
  window.hideOverlay = hideOverlay;
  window.updateOverlay = updateOverlay;
})();
