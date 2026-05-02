/**
 * zhihu.js — 知乎专栏适配器（API 发布版）
 *
 * 知乎发布流程完全通过 REST API 实现：
 *   1. afterFill(): 创建草稿 → 保存内容 → 发布 → 返回文章 URL
 *
 * API 端点：
 *   - POST   /api/articles/drafts          — 创建草稿
 *   - PATCH  /api/articles/{id}/draft       — 保存草稿内容
 *   - PUT    /api/articles/{id}/publish     — 发布草稿
 *   - POST   /api/uploaded_images           — 外部图片转存到知乎 CDN
 *
 * 认证：cookie-based（z_c0），通过 service worker 在知乎页面 MAIN world 执行 fetch
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[zhihu]", ...args);

  const ZHIHU_CDN_HOSTS = [
    "pic1.zhimg.com",
    "pic2.zhimg.com",
    "pic3.zhimg.com",
    "pic4.zhimg.com",
    "picx.zhimg.com",
  ];

  class ZhihuPublisher extends BasePublisher {
    constructor() {
      super("zhihu");
      this.publishSelectors = [];
    }

    // ============================================================
    // API helpers — route through service worker
    // ============================================================

    /**
     * Send API request via service worker → executeScript in zhihu page MAIN world.
     * @param {string} method - HTTP method (GET/POST/PATCH/PUT/DELETE)
     * @param {string} endpoint - Path relative to https://zhuanlan.zhihu.com
     * @param {object|null} body - JSON body (null for GET/DELETE)
     */
    async _api(method, endpoint, body = null) {
      log(`API ${method} ${endpoint}`, body ? JSON.stringify(body).substring(0, 200) : "");
      const resp = await chrome.runtime.sendMessage({
        action: "zhihuApi",
        method,
        endpoint,
        body,
      });
      if (!resp?.success) {
        throw new Error(`知乎 API 错误 (${method} ${endpoint}): ${resp?.error || "unknown"}`);
      }
      return resp.data;
    }

    // ============================================================
    // Image upload — transfer external images to zhihu CDN
    // ============================================================

    _isZhihuCdnUrl(url) {
      try {
        const hostname = new URL(url).hostname;
        return ZHIHU_CDN_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
      } catch {
        return false;
      }
    }

    async _uploadImage(imageUrl) {
      try {
        log(`上传图片: ${imageUrl}`);
        const resp = await chrome.runtime.sendMessage({
          action: "zhihuUploadImage",
          imageUrl,
        });
        if (resp?.success && resp.cdnUrl) {
          log(`图片上传成功: ${imageUrl} → ${resp.cdnUrl}`);
          return resp.cdnUrl;
        }
        log(`图片上传失败: ${imageUrl} — ${resp?.error || "unknown"}`);
        return null;
      } catch (e) {
        log(`图片上传异常: ${imageUrl} — ${e.message}`);
        return null;
      }
    }

    async _uploadImages() {
      if (!this.articleData) return;

      const html = this.articleData.html || "";
      const markdown = this.articleData.markdown || "";
      if (!html && !markdown) {
        log("无内容，跳过图片上传");
        return;
      }

      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
      const images = new Set();

      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if (!src.startsWith("data:") && !this._isZhihuCdnUrl(src)) {
          images.add(src);
        }
      }
      while ((match = mdImgRegex.exec(markdown)) !== null) {
        const src = match[1];
        if (!src.startsWith("data:") && !this._isZhihuCdnUrl(src)) {
          images.add(src);
        }
      }

      if (images.size === 0) {
        log("无需上传的外部图片");
        return;
      }

      log(`发现 ${images.size} 张外部图片需要上传`);

      // E-8: Upload images in parallel (batches of 3) instead of sequentially.
      // Sequential uploads at ~30s each would exceed the 60s SW timeout for
      // articles with more than 2 images.
      const MAX_CONCURRENT = 3;
      const uniqueUrls = [...images];
      const urlMap = new Map();

      for (let i = 0; i < uniqueUrls.length; i += MAX_CONCURRENT) {
        const batch = uniqueUrls.slice(i, i + MAX_CONCURRENT);
        const results = await Promise.all(
          batch.map(async (url) => {
            const cdnUrl = await this._uploadImage(url);
            return { url, cdnUrl };
          })
        );
        for (const { url, cdnUrl } of results) {
          if (cdnUrl) urlMap.set(url, cdnUrl);
        }
      }

      if (urlMap.size === 0) {
        log("所有图片上传均失败，保留原始内容");
        return;
      }

      log(`成功上传 ${urlMap.size}/${images.size} 张图片，替换 URL...`);

      let newHtml = html;
      let newMarkdown = markdown;
      for (const [originalUrl, cdnUrl] of urlMap) {
        const escaped = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(escaped, "g");
        newHtml = newHtml.replace(regex, cdnUrl);
        if (newMarkdown) newMarkdown = newMarkdown.replace(regex, cdnUrl);
      }

      this.articleData.html = newHtml;
      if (newMarkdown) this.articleData.markdown = newMarkdown;
      log("图片 URL 替换完成");
    }

    // ============================================================
    // Override base-publisher stages — skip all DOM operations
    // ============================================================

    async waitForPageReady() {
      log("API 发布模式，跳过等待编辑器就绪");
      await new Promise((r) => setTimeout(r, 1000));
    }

    async beforeFill() {
      await this._uploadImages();
    }

    async fillTitle() {
      log("跳过 DOM 填充标题（使用 API 发布）");
    }

    async fillBody() {
      log("跳过 DOM 填充正文（使用 API 发布）");
    }

    async fillPublishConfig() {
      log("跳过 DOM 填充发布配置（使用 API 发布）");
    }

    // ============================================================
    // API-based publish — create draft → save content → publish
    // ============================================================

    async afterFill() {
      const title = this.articleData?.title || "Untitled";
      const html = this.articleData?.html || "";

      if (!html && !this.articleData?.markdown) {
        throw new Error("文章内容为空，无法发布");
      }

      // 1. Create draft
      log("创建草稿...");
      const draft = await this._api("POST", "/api/articles/drafts", {});
      const draftId = draft?.id;
      if (!draftId) {
        throw new Error(`创建草稿失败: 未返回 draft id — ${JSON.stringify(draft)}`);
      }
      log(`草稿已创建: ${draftId}`);

      try {
        // 2. Save draft content
        log("保存草稿内容...");
        await this._api("PATCH", `/api/articles/${draftId}/draft`, {
          title,
          content: html,
          table_of_contents: true,
          delta_time: 30,
        });
        log("草稿内容已保存");

        // 3. Publish
        log("发布草稿...");
        const publishResult = await this._api("PUT", `/api/articles/${draftId}/publish`, {
          commentPermission: "anyone",
          invitedReviewers: [],
        });

        const articleUrl = publishResult?.url || `https://zhuanlan.zhihu.com/p/${draftId}`;
        log(`发布成功: ${articleUrl}`);

        return { article_url: articleUrl };
      } catch (err) {
        // H-E2: Best-effort cleanup — delete orphaned draft so it doesn't
        // accumulate in the user's zhihu drafts on every failed publish attempt.
        log(`发布失败，清理草稿 ${draftId}...`);
        try {
          await this._api("DELETE", `/api/articles/${draftId}`);
          log(`草稿 ${draftId} 已清理`);
        } catch (cleanupErr) {
          log(`草稿清理失败（忽略）: ${cleanupErr.message}`);
        }
        throw err;
      }
    }
  }

  const publisher = new ZhihuPublisher();
  publisher.init();
})();
