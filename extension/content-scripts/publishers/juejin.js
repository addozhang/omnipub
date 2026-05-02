/**
 * juejin.js — 掘金适配器（API 发布版）
 *
 * 掘金发布流程完全通过 REST API 实现：
 *   1. beforeFill(): 上传外部图片到掘金 CDN
 *   2. afterFill(): 通过 API 创建草稿 → 发布 → 返回文章 URL
 *
 * API 端点：
 *   - POST /content_api/v1/article_draft/create — 创建草稿
 *   - POST /content_api/v1/article/publish — 发布草稿
 *   - POST /tag_api/v1/query_category_list — 分类列表
 *   - POST /tag_api/v1/query_tag_list — 标签搜索
 *
 * 认证：cookie-based（sessionid），content script 内 fetch + credentials: "include"
 */

(function () {
  "use strict";

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log("[juejin]", ...args);

  const API_BASE = "https://api.juejin.cn";

  const JUEJIN_CDN_HOSTS = [
    "p1-juejin.byteimg.com",
    "p3-juejin.byteimg.com",
    "p6-juejin.byteimg.com",
    "p9-juejin.byteimg.com",
    "p1-jj.byteimg.com",
    "p3-jj.byteimg.com",
    "p6-jj.byteimg.com",
    "p9-jj.byteimg.com",
  ];
  const MAX_IMAGE_UPLOAD_CONCURRENT = 3;

  class JuejinPublisher extends BasePublisher {
    constructor() {
      super("juejin");
      this.publishSelectors = [];
    }

    // ============================================================
    // API helpers
    // ============================================================

    async _apiPost(endpoint, body = {}) {
      log(`API POST ${endpoint}`, body);
      const resp = await chrome.runtime.sendMessage({
        action: "juejinApi",
        endpoint,
        body,
      });
      if (!resp?.success) {
        throw new Error(`掘金 API 错误 (${endpoint}): ${resp?.error || "unknown"}`);
      }
      return resp.data;
    }

    // ============================================================
    // Category & Tag resolution
    // ============================================================

    async _resolveCategory(categoryName) {
      const categories = await this._apiPost("/tag_api/v1/query_category_list");
      if (!Array.isArray(categories)) {
        log("分类列表格式异常:", categories);
        return null;
      }
      if (categoryName) {
        const match = categories.find(
          (c) => c.category?.category_name === categoryName || c.category_name === categoryName
        );
        if (match) {
          const id = match.category_id || match.category?.category_id;
          log(`分类匹配: "${categoryName}" → ${id}`);
          return id;
        }
        log(`未找到分类 "${categoryName}"，使用第一个可用分类`);
      }
      const first = categories[0];
      const id = first?.category_id || first?.category?.category_id;
      log(`使用默认分类: "${first?.category?.category_name || first?.category_name}" → ${id}`);
      return id;
    }

    async _resolveTags(tagNames) {
      if (!tagNames || tagNames.length === 0) {
        log("未配置标签，获取热门标签...");
        const data = await this._apiPost("/tag_api/v1/query_tag_list", {
          key_word: "",
          cursor: "0",
        });
        const tags = data || [];
        if (tags.length > 0) {
          const tag = tags[0];
          const id = tag.tag_id || tag.tag?.tag_id;
          log(`使用默认标签: "${tag.tag?.tag_name || tag.tag_name}" → ${id}`);
          return id ? [String(id)] : [];
        }
        return [];
      }

      const tagIds = [];
      for (const name of tagNames.slice(0, 3)) {
        try {
          const data = await this._apiPost("/tag_api/v1/query_tag_list", {
            key_word: name,
            cursor: "0",
          });
          const tags = data || [];
          const match = tags.find(
            (t) => (t.tag?.tag_name || t.tag_name) === name
          );
          if (match) {
            tagIds.push(String(match.tag_id || match.tag?.tag_id));
            log(`标签匹配: "${name}" → ${tagIds[tagIds.length - 1]}`);
          } else if (tags.length > 0) {
            const first = tags[0];
            tagIds.push(String(first.tag_id || first.tag?.tag_id));
            log(`标签 "${name}" 无精确匹配，使用: "${first.tag?.tag_name || first.tag_name}"`);
          } else {
            log(`标签 "${name}" 无搜索结果`);
          }
        } catch (e) {
          log(`标签 "${name}" 搜索失败:`, e.message);
        }
      }
      return tagIds;
    }

    // ============================================================
    // Brief / summary extraction
    // ============================================================

    _extractBrief(markdown, maxLen = 100) {
      if (!markdown) return "";
      const plain = markdown
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]+`/g, "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/[*_~`>|\\-]/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return plain.substring(0, maxLen);
    }

    // ============================================================
    // Image upload (reuse existing logic — delegates to service worker)
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

    _isJuejinCdnUrl(url) {
      try {
        const hostname = new URL(url).hostname;
        return JUEJIN_CDN_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
      } catch {
        return false;
      }
    }

    _inferImageMeta(url) {
      let filename = "image.jpg";
      let mimeType = "image/jpeg";
      try {
        const pathname = new URL(url).pathname;
        const basename = pathname.split("/").pop() || "image.jpg";
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
      }
      return { filename, mimeType };
    }

    async _uploadSingleImage(imgUrl) {
      try {
        log(`上传图片 (via SW): ${imgUrl}`);
        const { filename, mimeType } = this._inferImageMeta(imgUrl);
        const response = await chrome.runtime.sendMessage({
          action: "uploadImage",
          imageUrl: imgUrl,
          uploadUrl: `${API_BASE}/upload_api/v1/upload`,
          filename,
          mimeType,
        });
        if (response?.success && response.cdnUrl) {
          log(`图片上传成功: ${imgUrl} → ${response.cdnUrl}`);
          return response.cdnUrl;
        }
        log(`图片上传失败: ${imgUrl} — ${response?.error || "unknown"}`);
        return null;
      } catch (e) {
        log(`图片上传异常: ${imgUrl} — ${e.message}`);
        return null;
      }
    }

    async _uploadImages() {
      if (!this.articleData) return;

      const html = this.articleData.html || "";
      const markdown = this.articleData.markdown || "";
      const content = html || markdown;
      if (!content) {
        log("无内容，跳过图片上传");
        return;
      }

      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
      const images = new Set();

      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if (!src.startsWith("data:") && !this._isJuejinCdnUrl(src)) {
          images.add(src);
        }
      }
      while ((match = mdImgRegex.exec(markdown)) !== null) {
        const src = match[1];
        if (!src.startsWith("data:") && !this._isJuejinCdnUrl(src)) {
          images.add(src);
        }
      }

      if (images.size === 0) {
        log("无需上传的外部图片");
        return;
      }

      log(`发现 ${images.size} 张外部图片需要上传`);

      const uniqueUrls = [...images];
      const urlMap = new Map();

      for (let i = 0; i < uniqueUrls.length; i += MAX_IMAGE_UPLOAD_CONCURRENT) {
        const batch = uniqueUrls.slice(i, i + MAX_IMAGE_UPLOAD_CONCURRENT);
        const results = await Promise.all(
          batch.map(async (url) => {
            const cdnUrl = await this._uploadSingleImage(url);
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

      log(`成功上传 ${urlMap.size}/${uniqueUrls.length} 张图片，替换 URL...`);

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
    // API-based publish (replaces all DOM manipulation)
    // ============================================================

    async afterFill() {
      const config = this.articleData.publish_config || {};
      const title = this.articleData.title || "Untitled";
      const markdown = this.articleData.markdown || "";

      if (!markdown && !this.articleData.html) {
        throw new Error("文章内容为空，无法发布");
      }

      // 1. Resolve category
      log("解析分类...");
      const categoryId = await this._resolveCategory(config.category);
      if (!categoryId) {
        throw new Error("无法获取分类 ID（分类列表为空）");
      }

      // 2. Resolve tags
      log("解析标签...");
      const tagIds = await this._resolveTags(config.tags);
      if (tagIds.length === 0) {
        log("警告: 未获取到任何标签 ID，掘金可能要求至少一个标签");
      }

      // 3. Generate brief
      const brief = this._extractBrief(markdown);
      log(`摘要 (${brief.length} 字): ${brief.substring(0, 50)}...`);

      // 4. Create draft
      log("创建草稿...");
      const draftData = await this._apiPost("/content_api/v1/article_draft/create", {
        title,
        mark_content: markdown,
        brief_content: brief,
        cover_image: config.cover_image || "",
        tag_ids: tagIds,
        category_id: categoryId,
        edit_type: 10,
        html_content: "deprecated",
      });

      const draftId = draftData?.id;
      if (!draftId) {
        throw new Error(`创建草稿失败: 未返回 draft_id — ${JSON.stringify(draftData)}`);
      }
      log(`草稿已创建: ${draftId}`);

      // 5. Publish — E-5: delete orphaned draft if publish step throws
      let publishData;
      try {
        log("发布草稿...");
        publishData = await this._apiPost("/content_api/v1/article/publish", {
          draft_id: draftId,
          sync_to_org: false,
          column_ids: [],
        });
      } catch (publishErr) {
        // Best-effort cleanup: delete the draft so it doesn't accumulate.
        // Swallow errors — draft deletion is not critical.
        try {
          await this._apiPost("/content_api/v1/article_draft/delete", {
            draft_id: draftId,
          });
          log(`发布失败，已删除草稿 ${draftId}`);
        } catch (delErr) {
          log(`发布失败且草稿删除也失败 (draft_id=${draftId}):`, delErr.message);
        }
        throw publishErr;
      }

      const articleId = publishData?.article_id;
      if (!articleId) {
        // API returned 200 but no article_id — also attempt draft cleanup
        try {
          await this._apiPost("/content_api/v1/article_draft/delete", { draft_id: draftId });
          log(`发布响应缺少 article_id，已删除草稿 ${draftId}`);
        } catch {}
        throw new Error(`发布失败: 未返回 article_id — ${JSON.stringify(publishData)}`);
      }

      const articleUrl = `https://juejin.cn/post/${articleId}`;
      log(`发布成功: ${articleUrl}`);

      return { article_url: articleUrl };
    }
  }

  const publisher = new JuejinPublisher();
  publisher.init();
})();
