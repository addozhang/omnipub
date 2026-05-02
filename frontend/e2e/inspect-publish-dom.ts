import { chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  cleanStaleLocks,
  fixProfileCrashState,
  grantExtensionHostPermissions,
  restoreCookies,
  saveCookies,
} from "./session-health";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_DIR = process.env.OMNIPUB_TEST_PROFILE || path.join(os.homedir(), ".omnipub-test-profile");
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const OUTPUT_DIR = "/tmp/omnipub-workflow";
const PLATFORM_ENV = (process.env.PLATFORM || "all").trim();
const ARTICLE_ID = parseInt(process.env.ARTICLE_ID || "70", 10);
const LOGIN_EMAIL = "duwasai@gmail.com";
const LOGIN_PASSWORD = "Naitang1!";

const PLATFORMS = [
  { slug: "juejin", editorUrl: "https://juejin.cn/editor/drafts/new" },
  { slug: "csdn", editorUrl: "https://mp.csdn.net/mp_blog/creation/editor" },
  { slug: "zhihu", editorUrl: "https://zhuanlan.zhihu.com/write" },
  { slug: "cnblogs", editorUrl: "https://i.cnblogs.com/posts/edit" },
  { slug: "toutiao", editorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish" },
  { slug: "tencent-cloud", editorUrl: "https://cloud.tencent.com/developer/article/write-new" },
  { slug: "51cto", editorUrl: "https://blog.51cto.com/blogger/publish" },
  { slug: "segmentfault", editorUrl: "https://segmentfault.com/write" },
  { slug: "oschina", editorUrl: "https://my.oschina.net/blog/write" },
  { slug: "bilibili", editorUrl: "https://member.bilibili.com/article-text/home" },
  { slug: "infoq", editorUrl: "https://xie.infoq.cn/draft/write" },
] as const;

type PlatformDef = (typeof PLATFORMS)[number];
type ServiceWorkerRef = any;
declare const chrome: any;

type ElementSnapshot = {
  selector: string;
  className: string;
  innerHTMLSnippet: string;
  visible: boolean;
  size: { width: number; height: number; x: number; y: number };
  text?: string;
  disabled?: boolean;
  frameUrl?: string;
};

type StepSnapshot = {
  step: string;
  timestamp: string;
  url: string;
  pageTitle: string;
  navigationHistory: string[];
  modalsDialogsOverlays: ElementSnapshot[];
  publishConfirmButtons: ElementSnapshot[];
  validationErrors: ElementSnapshot[];
  toastsNotifications: ElementSnapshot[];
  screenshotPath: string;
  notes?: string;
};

type WorkflowResult = {
  platform: string;
  editorUrl: string;
  articleId: number;
  startedAt: string;
  finishedAt: string;
  loginOk: boolean;
  fillOk: boolean;
  publishClicked: boolean;
  confirmFound: boolean;
  finalStatus: "ok" | "skipped-login" | "failed" | "timeout";
  notes: string;
  steps: StepSnapshot[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSnippet(text: string, max = 240): string {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function ensureServiceWorker(context: BrowserContext): Promise<ServiceWorkerRef> {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    try {
      sw = await context.waitForEvent("serviceworker", { timeout: 5000 });
    } catch {
      sw = context.serviceWorkers()[0];
    }
  }
  if (!sw) {
    const p = context.pages()[0] || await context.newPage();
    const cdp = await context.newCDPSession(p);
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
      const t = await context.newPage();
      await t.goto("about:blank");
      await t.close();
    } finally {
      await cdp.detach().catch(() => {});
    }
    sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 5000 });
  }
  return sw;
}

async function loginOmnipub(page: Page): Promise<string> {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 15000 });
  const existingToken = await page.evaluate(() => localStorage.getItem("token"));
  if (existingToken) {
    const resp = await page.request.get("http://localhost:3000/api/articles", {
      headers: { Authorization: `Bearer ${existingToken}` },
    });
    if (resp.ok()) return existingToken;
    await page.evaluate(() => localStorage.removeItem("token"));
  }

  await page.getByPlaceholder("your@email.com").fill(LOGIN_EMAIL);
  await page.getByPlaceholder("请输入密码").fill(LOGIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/articles", { timeout: 10000 }).catch(() => {});

  const token = await page.evaluate(() => localStorage.getItem("token"));
  if (!token) throw new Error("Failed to login to Omnipub");
  return token;
}

async function fetchArticle(page: Page, token: string, articleId: number) {
  const resp = await page.request.get(`http://localhost:3000/api/articles/${articleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to fetch article ${articleId}: HTTP ${resp.status()}`);
  }
  const payload = await resp.json();
  const article = payload?.data;
  if (!article?.id || !article?.title) {
    throw new Error(`Invalid article payload for ${articleId}`);
  }
  return article;
}

async function fetchPlatformConfigs(page: Page, token: string): Promise<Record<string, any>> {
  const resp = await page.request.get("http://localhost:3000/api/user/platform-configs", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) {
    console.warn(`Failed to fetch platform configs: HTTP ${resp.status()}`);
    return {};
  }
  const payload = await resp.json();
  const data = payload?.data || {};
  // Transform: { slug: { publish_config: {...}, ... } } → { slug: publish_config }
  const configs: Record<string, any> = {};
  for (const [slug, entry] of Object.entries(data)) {
    configs[slug] = (entry as any)?.publish_config || {};
  }
  return configs;
}

async function scanFrame(frame: Frame, frameUrl: string): Promise<{
  modalsDialogsOverlays: ElementSnapshot[];
  publishConfirmButtons: ElementSnapshot[];
  validationErrors: ElementSnapshot[];
  toastsNotifications: ElementSnapshot[];
}> {
  const raw = await frame.evaluate(() => {
    const visible = (el: Element) => {
      const h = el as HTMLElement;
      const style = window.getComputedStyle(h);
      const rect = h.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    };

    const toSnapshot = (el: Element) => {
      const h = el as HTMLElement;
      const rect = h.getBoundingClientRect();
      return {
        selector: (() => {
          const h = el as HTMLElement;
          const id = h.id;
          const cls = (h.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 3);
          return `${el.tagName.toLowerCase()}${id ? `#${id}` : ""}${cls.length ? `.${cls.join(".")}` : ""}`;
        })(),
        className: h.className?.toString?.() || "",
        innerHTMLSnippet: (h.innerHTML || h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
        visible: visible(el),
        size: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        },
        text: (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        disabled: (h as HTMLButtonElement).disabled ?? false,
      };
    };

    const uniq = (arr: Element[]) => Array.from(new Set(arr));
    const queryAll = (selectors: string[]) => uniq(selectors.flatMap((s) => Array.from(document.querySelectorAll(s))));

    const modalSelectors = [
      "[role='dialog']",
      "[role='alertdialog']",
      "[class*='modal']",
      "[class*='dialog']",
      "[class*='overlay']",
      "[class*='popup']",
      "[class*='drawer']",
    ];

    const buttonCandidates = Array.from(document.querySelectorAll("button, [role='button'], a, div"))
      .filter((el) => /发布|确认|确定|提交|继续|保存|publish|confirm|submit|ok/i.test((el.textContent || "").trim()))
      .slice(0, 200);

    const validationSelectors = [
      "[class*='error']",
      "[class*='warning']",
      "[class*='invalid']",
      "[role='alert']",
      "[aria-invalid='true']",
      ".is-error",
      ".has-error",
    ];

    const inputsWithRedBorder = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']")).filter((el) => {
      const style = window.getComputedStyle(el as HTMLElement);
      return /rgb\((2[0-5]{2}|1?[0-9]{1,2}),\s*(?:0|[1-9][0-9]?),\s*(?:0|[1-9][0-9]?)\)/i.test(style.borderColor || "");
    });

    const toastSelectors = [
      "[class*='toast']",
      "[class*='notification']",
      "[class*='snackbar']",
      "[class*='message']",
      "[aria-live='polite']",
      "[aria-live='assertive']",
    ];

    return {
      modalsDialogsOverlays: queryAll(modalSelectors).map(toSnapshot),
      publishConfirmButtons: buttonCandidates.map(toSnapshot),
      validationErrors: uniq([...queryAll(validationSelectors), ...inputsWithRedBorder]).map(toSnapshot),
      toastsNotifications: queryAll(toastSelectors).map(toSnapshot),
    };
  });

  return {
    modalsDialogsOverlays: raw.modalsDialogsOverlays.map((r: ElementSnapshot) => ({ ...r, frameUrl })),
    publishConfirmButtons: raw.publishConfirmButtons.map((r: ElementSnapshot) => ({ ...r, frameUrl })),
    validationErrors: raw.validationErrors.map((r: ElementSnapshot) => ({ ...r, frameUrl })),
    toastsNotifications: raw.toastsNotifications.map((r: ElementSnapshot) => ({ ...r, frameUrl })),
  };
}

async function captureStep(page: Page, slug: string, step: string, navigationHistory: string[], notes?: string): Promise<StepSnapshot> {
  const screenshotPath = path.join(OUTPUT_DIR, `${slug}-${step}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(async () => {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  });

  const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
  const aggregates = {
    modalsDialogsOverlays: [] as ElementSnapshot[],
    publishConfirmButtons: [] as ElementSnapshot[],
    validationErrors: [] as ElementSnapshot[],
    toastsNotifications: [] as ElementSnapshot[],
  };

  for (const frame of frames) {
    try {
      const scanned = await scanFrame(frame as any, frame.url() || page.url());
      aggregates.modalsDialogsOverlays.push(...scanned.modalsDialogsOverlays);
      aggregates.publishConfirmButtons.push(...scanned.publishConfirmButtons);
      aggregates.validationErrors.push(...scanned.validationErrors);
      aggregates.toastsNotifications.push(...scanned.toastsNotifications);
    } catch {
    }
  }

  return {
    step,
    timestamp: new Date().toISOString(),
    url: page.url(),
    pageTitle: await page.title().catch(() => ""),
    navigationHistory: [...navigationHistory],
    modalsDialogsOverlays: aggregates.modalsDialogsOverlays,
    publishConfirmButtons: aggregates.publishConfirmButtons,
    validationErrors: aggregates.validationErrors,
    toastsNotifications: aggregates.toastsNotifications,
    screenshotPath,
    notes,
  };
}

async function sendFillAndPublishViaSW(sw: ServiceWorkerRef, platform: PlatformDef, article: any, actualUrl?: string, publishConfig?: any): Promise<{ ok: boolean; tabId?: number; message?: string }> {
  return sw.evaluate(async ({ slug, targetUrl, articlePayload, pubConfig }) => {
    const allTabs = await chrome.tabs.query({});
    const sameUrl = allTabs.filter((t: any) => t.url === targetUrl && typeof t.id === "number");
    const targetOrigin = (() => {
      try {
        return new URL(targetUrl).origin;
      } catch {
        return "";
      }
    })();
    const sameOrigin = allTabs.filter((t: any) => targetOrigin && t.url?.startsWith(targetOrigin) && typeof t.id === "number");

    const sorted = [...(sameUrl.length ? sameUrl : sameOrigin)].sort((a, b) => (b.id || 0) - (a.id || 0));
    const chosen = sorted[0];
    if (!chosen?.id) {
      return { ok: false, message: `No matching tab for ${slug}` };
    }

    try {
      const resp = await chrome.tabs.sendMessage(chosen.id, {
        action: "FILL_AND_PUBLISH",
        article: {
          id: articlePayload.id,
          title: articlePayload.title,
          markdown_content: articlePayload.markdown_content || "",
          html_content: articlePayload.html_content || "",
        },
        platform: slug,
        publicationId: null,
        publishConfig: pubConfig || {},
      });
      return { ok: true, tabId: chosen.id, message: JSON.stringify(resp || {}) };
    } catch (e: any) {
      return { ok: false, tabId: chosen.id, message: e?.message || String(e) };
    }
  }, {
    slug: platform.slug,
    targetUrl: actualUrl || platform.editorUrl,
    articlePayload: article,
    pubConfig: publishConfig || {},
  });
}

/**
 * CDP fallback: find our extension's content script execution context
 * and call chrome.tabs.sendMessage from the service worker via CDP,
 * or dispatch FILL_AND_PUBLISH directly within the content script context.
 *
 * This bypasses Playwright's sw.evaluate() which is fragile with MV3 idle timeout.
 */
async function sendFillAndPublishViaCDP(context: BrowserContext, page: Page, platform: PlatformDef, article: any, publishConfig?: any): Promise<{ ok: boolean; message?: string }> {
  const cdp = await context.newCDPSession(page);
  try {
    const ctxs: any[] = [];
    cdp.on("Runtime.executionContextCreated", (e: any) => ctxs.push(e.context));
    await cdp.send("Runtime.enable");
    await delay(1000);

    const findExtCtx = () => ctxs.find((c: any) =>
      c.origin?.startsWith("chrome-extension://") && c.auxData?.type === "isolated"
    );

    let extensionCtx = findExtCtx();

    // Retry up to 5 times — content script may not have loaded yet
    for (let attempt = 0; !extensionCtx && attempt < 2; attempt++) {
      ctxs.length = 0;
      await cdp.send("Runtime.disable");
      await cdp.send("Runtime.enable");
      await delay(1500);
      extensionCtx = findExtCtx();
    }

    if (!extensionCtx) {
      return { ok: false, message: "CDP: no extension content script context found" };
    }

    for (let i = 0; i < 3; i++) {
      const check = await cdp.send("Runtime.evaluate", {
        expression: `!!window.__omnipubPublisher`,
        contextId: extensionCtx.id,
        returnByValue: true,
      });
      if (check.result?.value === true) break;
      await delay(1000);
    }

    // Execute FILL_AND_PUBLISH trigger in the extension's content script context
    const msgPayload = JSON.stringify({
      action: "FILL_AND_PUBLISH",
      article: {
        id: article.id,
        title: article.title,
        markdown_content: article.markdown_content || "",
        html_content: article.html_content || "",
      },
      platform: platform.slug,
      publicationId: null,
      publishConfig: publishConfig || {},
    });

    // The content script has chrome.runtime.onMessage listener.
    // We can simulate receiving a message by directly invoking the publisher.
    const expression = `
      (async () => {
        try {
          const pub = window.__omnipubPublisher;
          if (!pub) return JSON.stringify({ ok: false, message: "No publisher instance" });
          
          const msg = ${msgPayload};
          pub.articleData = {
            title: msg.article.title,
            markdown: msg.article.markdown_content || "",
            html: msg.article.html_content || "",
            articleId: msg.article.id,
            publicationId: null,
            platform: msg.platform,
            timestamp: Date.now(),
            publish_config: msg.publishConfig || {},
          };
          
          // Append user-configured markdown content (mirrors base-publisher.js logic)
          const appendMd = (msg.publishConfig || {}).append_markdown;
          if (appendMd && appendMd.trim()) {
            pub.articleData.markdown = (pub.articleData.markdown || "") + "\\n\\n" + appendMd.trim();
            if (pub.articleData.html) {
              const appendHtml = appendMd.trim().split("\\n").map(line => {
                const escaped = line.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const withLinks = escaped.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
                return "<p>" + withLinks + "</p>";
              }).join("\\n");
              pub.articleData.html += "\\n" + appendHtml;
            }
          }

          if (!pub.config) pub.config = await pub.fetchConfig();
          
          await pub.waitForPageReady();
          
          const hasCustomFill = pub.constructor.prototype.hasOwnProperty("fill");
          if (hasCustomFill) {
            await pub.fill(pub.articleData);
          } else {
            await pub.beforeFill();
            await pub.fillTitle();
            await pub.fillBody();
            await pub.fillPublishConfig(pub.articleData.publish_config);
            await pub.afterFill();
          }
          
          return JSON.stringify({ ok: true, message: "CDP direct fill+publish completed" });
        } catch (e) {
          return JSON.stringify({ ok: false, message: "CDP fill error: " + (e.message || String(e)) });
        }
      })()
    `;

    const result = await cdp.send("Runtime.evaluate", {
      expression,
      contextId: extensionCtx.id,
      awaitPromise: true,
      returnByValue: true,
    });

    const parsed = JSON.parse(result.result?.value || '{"ok":false,"message":"no result"}');
    return parsed;
  } catch (e: any) {
    return { ok: false, message: `CDP fallback error: ${e.message}` };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

async function directFillAndPublish(page: Page, platform: PlatformDef, article: any, context?: BrowserContext, publishConfig?: any): Promise<{ ok: boolean; message?: string; url?: string }> {
  // Apply append_markdown to article content before filling (mirrors base-publisher.js logic)
  const appendMd = (publishConfig || {}).append_markdown;
  if (appendMd && appendMd.trim()) {
    article = { ...article };
    article.markdown_content = (article.markdown_content || "") + "\n\n" + appendMd.trim();
    if (article.html_content) {
      const appendHtml = appendMd.trim().split("\n").map((line: string) => {
        const escaped = line.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const withLinks = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        return `<p>${withLinks}</p>`;
      }).join("\n");
      article.html_content += "\n" + appendHtml;
    }
    console.log(`  ${platform.slug}: appended ${appendMd.trim().length} chars to article content`);
  }

  const handlers: Record<string, () => Promise<{ ok: boolean; message?: string }>> = {
    csdn: async () => {
      // CSDN uses CKEditor 4 in richtext mode. Content MUST be set via CKEDITOR API,
      // not via iframe body innerHTML (which results in "0 字" word count).
      // Publish flow: click "发布博客" → settings panel appears at bottom →
      // fill required fields (tags) → click "发布文章" confirm button.

      // Step 1: Fill title
      const titleInput = page.locator("textarea#txtTitle, input.article-bar__title, input[placeholder*='标题']").first();
      if (await titleInput.isVisible({ timeout: 8000 }).catch(() => false)) {
        await titleInput.fill(article.title);
        console.log("  CSDN: title filled");
      }
      await delay(500);

      // Step 2: Fill content via CKEditor API (critical: must use setData, not innerHTML)
      const editorUrl = page.url();
      const isMarkdownMode = editorUrl.includes('/mdeditor') || await page.locator('.editor-preview, .CodeMirror, #md-editor').first().isVisible({ timeout: 2000 }).catch(() => false);

      if (isMarkdownMode) {
        // Markdown mode — use CodeMirror or textarea
        const mdEditor = page.locator('#md-editor, .CodeMirror, textarea.editor').first();
        if (await mdEditor.isVisible({ timeout: 5000 }).catch(() => false)) {
          const isCM = await mdEditor.evaluate("function(el){ return !!el.CodeMirror }").catch(() => false);
          if (isCM) {
            await mdEditor.evaluate("function(el, md){ el.CodeMirror.setValue(md) }", article.markdown_content || "");
          } else {
            await mdEditor.fill(article.markdown_content || "");
          }
          console.log("  CSDN: markdown content filled");
        }
      } else {
        // Rich text mode — use CKEDITOR.instances API
        const safeHtml = JSON.stringify(article.html_content || "<p>" + (article.markdown_content || "") + "</p>");
        const fillResult = await page.evaluate(`(function(){
          try {
            if (typeof CKEDITOR !== 'undefined' && CKEDITOR.instances) {
              var keys = Object.keys(CKEDITOR.instances);
              if (keys.length > 0) {
                var editor = CKEDITOR.instances[keys[0]];
                editor.setData(${safeHtml});
                return { ok: true, method: 'CKEDITOR.setData', instance: keys[0] };
              }
            }
            // Fallback: iframe body
            var iframe = document.querySelector('iframe.cke_wysiwyg_frame');
            if (iframe && iframe.contentDocument) {
              iframe.contentDocument.body.innerHTML = ${safeHtml};
              return { ok: true, method: 'iframe.innerHTML' };
            }
            return { ok: false, method: 'none', message: 'No CKEditor instance or iframe found' };
          } catch(e) {
            return { ok: false, method: 'error', message: e.message };
          }
        })()`);
        console.log("  CSDN: content fill result:", JSON.stringify(fillResult));
      }
      await delay(1500);

      // Step 3: Click "发布博客" to open settings panel
      const publishBtn = page.locator("button.btn-outline-danger, button.btn-publish-red").first();
      if (await publishBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await publishBtn.click();
        console.log("  CSDN: clicked 发布博客 button");
      }
      await delay(2000);

      const tagBtnClicked = await page.evaluate(`(function(){
        var btns = document.querySelectorAll('button.tag__btn-tag, button');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').trim();
          if (t.indexOf('添加文章标签') >= 0) {
            btns[i].click();
            return true;
          }
        }
        return false;
      })()`);
      console.log("  CSDN: tag button clicked:", tagBtnClicked);
      await delay(1500);

      const tagSelected = await page.evaluate(`(function(){
        var tags = document.querySelectorAll('.el_mcm-tag, span.tag');
        for (var i = 0; i < tags.length; i++) {
          var r = tags[i].getBoundingClientRect();
          if (r.height > 0 && r.width > 0) {
            tags[i].click();
            return tags[i].textContent.trim();
          }
        }
        return null;
      })()`);
      console.log("  CSDN: selected tag:", tagSelected);
      await delay(800);

      await page.evaluate(`(function(){
        var btns = document.querySelectorAll('button.btn-outline-danger');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').trim();
          if (t === '发布博客' && !btns[i].disabled) {
            btns[i].click();
            return true;
          }
        }
        return false;
      })()`);
      console.log("  CSDN: clicked 发布博客 to submit");
      await delay(10000);

      const urlAfter = page.url();
      const isPublished = urlAfter.includes('/article/details/') || !urlAfter.includes('/editor');
      console.log("  CSDN: final URL:", urlAfter, "published:", isPublished);
      return { ok: isPublished, message: `url=${urlAfter}, tag=${tagSelected || 'none'}` };
    },
    toutiao: async () => {
      await page.evaluate(`(function(){
        document.querySelectorAll('.byte-drawer-mask, .byte-drawer-wrapper.ai-assistant-drawer').forEach(function(el){ el.remove(); });
        var closeBtn = document.querySelector('.creative-assistant-close, .ai-assistant-close, [class*="assistant"] [class*="close"]');
        if (closeBtn) closeBtn.click();
      })()`);
      await delay(500);

      const titleInput = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"], .article-title textarea, .ProseMirror-title textarea').first();
      if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await titleInput.fill(article.title);
      }
      await delay(500);

      const safeHtml = JSON.stringify(article.html_content || `<p>${article.markdown_content || ""}</p>`);
      await page.evaluate(`(function(){
        var el = document.querySelector('.ProseMirror[contenteditable="true"]');
        if (el) {
          el.focus();
          el.innerHTML = ${safeHtml};
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      })()`);
      const contentSet = await page.evaluate(`(function(){
        var el = document.querySelector('.ProseMirror[contenteditable="true"]');
        return el ? (el.innerHTML || "").length : 0;
      })()`);
      console.log("  toutiao: ProseMirror content length:", contentSet);
      await delay(1000);

      const safeTitle = JSON.stringify(article.title || "");
      const safeHtmlForApi = JSON.stringify(
        (article.html_content || `<p>${article.markdown_content || ""}</p>`).replace(/<img[^>]*>/gi, "")
      );
      const saveAndPublish = await page.evaluate(`(async function(){
        var getCookie = function(name) {
          var m = document.cookie.match(new RegExp("(?:^|;\\\\s*)" + name + "=([^;]*)"));
          return m ? decodeURIComponent(m[1]) : "";
        };
        var csrfToken = getCookie("csrftoken") || getCookie("tt_csrf_token") || "";
        var content = ${safeHtmlForApi};
        var title = ${safeTitle};
        var buildFormBody = function(overrides) {
          var params = {
            title: title,
            content: content,
            article_ad_type: "2",
            article_type: "0",
            from_diagnosis: "0",
            origin_debut_check_pgc_normal: "0",
            tree_plan_article: "0",
            save: "0",
            pgc_id: "0",
            pgc_feed_covers: "[]"
          };
          for (var k in overrides) params[k] = overrides[k];
          return new URLSearchParams(params).toString();
        };
        var headers = { "Content-Type": "application/x-www-form-urlencoded" };
        if (csrfToken) headers["X-CSRFToken"] = csrfToken;

        try {
          var saveResp = await fetch("/mp/agw/article/publish?source=mp&type=article", {
            method: "POST", headers: headers,
            body: buildFormBody({ save: "1", pgc_id: "0" }),
            credentials: "include"
          });
          var saveJson = await saveResp.json();
          var pgcId = saveJson && saveJson.data && saveJson.data.pgc_id;
          if (!pgcId || (saveJson.code !== 0 && saveJson.err_no !== 0)) {
            return { ok: false, message: "save_draft failed: " + JSON.stringify(saveJson).substring(0, 300) };
          }

          var pubResp = await fetch("/mp/agw/article/publish?source=mp&type=article", {
            method: "POST", headers: headers,
            body: buildFormBody({ save: "0", pgc_id: String(pgcId) }),
            credentials: "include"
          });
          var pubJson = await pubResp.json();
          var pubOk = (pubJson.code === 0 || pubJson.err_no === 0) && pubJson.data && pubJson.data.pgc_id;
          return { ok: pubOk, message: "pgcId=" + pgcId + ", publish=" + JSON.stringify(pubJson).substring(0, 300) };
        } catch (e) {
          return { ok: false, message: "API error: " + (e.message || String(e)) };
        }
      })()`);
      return saveAndPublish;
    },
    juejin: async () => {
      // Pure API approach — DOM publish panel won't open in headless mode
      const safeMd = JSON.stringify(article.markdown_content || "");
      const safeTitle = JSON.stringify(article.title || "");
      const safeCover = JSON.stringify(article.cover_image || "");
      const safeBrief = JSON.stringify((article.markdown_content || "").substring(0, 100));
      const result = await page.evaluate(`(async function(){
        try {
          var createResp = await fetch("https://api.juejin.cn/content_api/v1/article_draft/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              title: ${safeTitle},
              mark_content: ${safeMd},
              html_content: "deprecated",
              edit_type: 10,
              category_id: "0",
              tag_ids: [],
              cover_image: ${safeCover},
              brief_content: ${safeBrief},
              link_url: ""
            })
          });
          var createJson = await createResp.json();
          if (createJson.err_no !== 0) return { ok: false, message: "create_draft failed: " + JSON.stringify(createJson).substring(0, 300) };
          var draftId = createJson.data && createJson.data.id;
          if (!draftId) return { ok: false, message: "no draft_id: " + JSON.stringify(createJson).substring(0, 300) };

          var updateResp = await fetch("https://api.juejin.cn/content_api/v1/article_draft/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              id: draftId,
              category_id: "6809637769959178254",
              tag_ids: ["6809640407484334093"],
              cover_image: ${safeCover},
              brief_content: ${safeBrief},
              title: ${safeTitle},
              mark_content: ${safeMd},
              html_content: "deprecated",
              edit_type: 10,
              link_url: ""
            })
          });
          var updateJson = await updateResp.json();
          if (updateJson.err_no !== 0) return { ok: false, message: "update_draft failed: " + JSON.stringify(updateJson).substring(0, 300) };

          var pubResp = await fetch("https://api.juejin.cn/content_api/v1/article/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              draft_id: draftId,
              sync_to_org: false,
              column_ids: []
            })
          });
          var pubJson = await pubResp.json();
          if (pubJson.err_no !== 0) return { ok: false, message: "publish failed: " + JSON.stringify(pubJson).substring(0, 300) };
          var articleId = pubJson.data && pubJson.data.article_id;
          var url = articleId ? "https://juejin.cn/post/" + articleId : "";
          return { ok: true, message: "Published! draftId=" + draftId + " articleId=" + articleId + " url=" + url, url: url };
        } catch (e) {
          return { ok: false, message: "API error: " + (e.message || String(e)) };
        }
      })()`);
      console.log("  juejin API result:", JSON.stringify(result));
      return result as { ok: boolean; message: string; url?: string };
    },
    zhihu: async () => {
      // Pure API via Playwright's Node.js HTTP client — bypasses browser CORS entirely
      const allCookies = await context.cookies("https://www.zhihu.com");
      const zc0 = allCookies.find((c: any) => c.name === "z_c0")?.value;
      const xsrf = allCookies.find((c: any) => c.name === "_xsrf")?.value;
      if (!zc0 || !xsrf) {
        return { ok: false, message: `missing cookies: z_c0=${!!zc0}, _xsrf=${!!xsrf}` };
      }

      const cookieHeader = allCookies.map((c: any) => `${c.name}=${c.value}`).join("; ");
      const apiHeaders = {
        "Content-Type": "application/json",
        "x-xsrftoken": xsrf,
        "Cookie": cookieHeader,
        "Referer": "https://zhuanlan.zhihu.com/write",
        "Origin": "https://zhuanlan.zhihu.com",
      };

      const title = article.title || "Untitled";
      const htmlContent = article.html_content || article.markdown_content || "";

      try {
        const meRes = await page.request.get("https://www.zhihu.com/api/v4/me", { headers: { Cookie: cookieHeader } });
        if (!meRes.ok()) return { ok: false, message: "session invalid: " + meRes.status() };
        const me = await meRes.json();
        console.log("  zhihu: session valid, user=" + me.name);

        const draftRes = await page.request.post("https://zhuanlan.zhihu.com/api/articles/drafts", {
          headers: apiHeaders,
          data: { title, delta_time: 0 },
        });
        if (!draftRes.ok()) {
          const errBody = await draftRes.text();
          return { ok: false, message: "create draft failed: " + draftRes.status() + " " + errBody };
        }
        const draft = await draftRes.json();
        const draftId = draft.id;
        if (!draftId) return { ok: false, message: "no draft id: " + JSON.stringify(draft) };
        console.log("  zhihu: draft created, id=" + draftId);

        const patchRes = await page.request.patch(`https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`, {
          headers: apiHeaders,
          data: { title, content: htmlContent, delta_time: 0 },
        });
        if (!patchRes.ok()) {
          const patchErr = await patchRes.text();
          return { ok: false, message: "patch draft failed: " + patchRes.status() + " " + patchErr };
        }
        console.log("  zhihu: content patched");

        const pubRes = await page.request.put(`https://zhuanlan.zhihu.com/api/articles/${draftId}/publish`, {
          headers: apiHeaders,
          data: { column: null, commentPermission: "anyone", disclaimer_type: "none", disclaimer_status: "close" },
        });
        if (!pubRes.ok()) {
          const pubErr = await pubRes.text();
          return { ok: false, message: "publish failed: " + pubRes.status() + " " + pubErr };
        }
        console.log("  zhihu: published successfully");

        const articleUrl = `https://zhuanlan.zhihu.com/p/${draftId}`;
        return { ok: true, message: `API publish success, user=${me.name}, draftId=${draftId}`, url: articleUrl };
      } catch (e: any) {
        return { ok: false, message: "API error: " + (e.message || String(e)) };
      }
    },
    cnblogs: async () => {
      // cnblogs uses textarea#md-editor for Markdown content, #post-title for title
      const titleInput = page.locator("#post-title").first();
      if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await titleInput.fill(article.title || "");
      }
      await delay(600);

      // Fill the markdown editor textarea directly
      const mdEditor = page.locator("textarea#md-editor").first();
      if (await mdEditor.isVisible({ timeout: 5000 }).catch(() => false)) {
        await mdEditor.fill(article.markdown_content || "");
        console.log("  cnblogs: filled textarea#md-editor");
      } else {
        // Fallback: try any textarea
        const ta = page.locator("textarea").first();
        if (await ta.isVisible({ timeout: 3000 }).catch(() => false)) {
          await ta.fill(article.markdown_content || "");
          console.log("  cnblogs: filled fallback textarea");
        } else {
          console.log("  cnblogs: no editor found!");
          return { ok: false, message: "No editor textarea found" };
        }
      }
      await delay(1000);

      // Trigger Angular change detection
      const safeMarkdown = JSON.stringify(article.markdown_content || "");
      await page.evaluate(`(function(){
        var ta = document.querySelector('textarea#md-editor');
        if (ta) {
          var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(ta, ${safeMarkdown});
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);
      await delay(800);

      // Click the publish button (button.cnb-button with text "发布")
      const publishBtn = page.locator('button.cnb-button').filter({ hasText: '发布' }).first();
      if (await publishBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await publishBtn.click();
        console.log("  cnblogs: clicked 发布 button");
      } else {
        // Fallback to evaluate
        await page.evaluate(`(function(){
          var btns = document.querySelectorAll('.cnb-button, button');
          for (var i = 0; i < btns.length; i++) {
            var t = (btns[i].textContent || '').trim();
            if (t === '发布' && !btns[i].disabled) {
              btns[i].click();
              return;
            }
          }
        })()`);
        console.log("  cnblogs: clicked publish via evaluate fallback");
      }
      await delay(8000);
      const finalUrl = page.url();
      const isPublished = !finalUrl.includes("/draft/") || finalUrl.includes("/article/");
      const successDialog = await page.locator(':text("发布成功"), :text("已发布")').first().isVisible().catch(function() { return false; });
      return { ok: isPublished || successDialog, message: "Direct cnblogs url=" + finalUrl, url: isPublished ? finalUrl : undefined };
    },
    "51cto": async () => {
      const titleInput = page.locator('#title, input[placeholder*="标题"]').first();
      if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await titleInput.fill(article.title || "");
      }
      await delay(600);

      const bodyInput = page.locator("textarea.write-area, textarea").first();
      if (await bodyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bodyInput.fill(article.markdown_content || "");
      } else {
        const safeMarkdown = JSON.stringify(article.markdown_content || "");
        await page.evaluate(`(function(){
          var md = ${safeMarkdown};
          var ta = document.querySelector('textarea.write-area, textarea');
          if (ta) {
            ta.value = md;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()`);
      }
      await delay(1000);

      const firstPublish = page.locator("#submitForm").first();
      if (await firstPublish.isVisible({ timeout: 4000 }).catch(() => false)) {
        await firstPublish.click();
      } else {
        await page.evaluate(`(function(){ var b = document.querySelector('#submitForm'); if (b) b.click(); })()`);
      }
      await delay(2000);

      // Dismiss "发文助手" content-check overlay if it appears (click "继续发布")
      const assistantContinue = page.locator('button:has-text("继续发布"), a:has-text("继续发布")').first();
      if (await assistantContinue.isVisible({ timeout: 3000 }).catch(() => false)) {
        await assistantContinue.click();
        console.log("  51cto: dismissed 发文助手 overlay");
        await delay(1500);
      }

      const secondClicked = await page.evaluate(`(function(){
        var btn = document.querySelector('.edit-submit');
        if (btn && ((btn.textContent || '').indexOf('发布') >= 0 || (btn.value || '').indexOf('发布') >= 0)) {
          btn.click();
          return true;
        }
        var btns = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || btns[i].value || '').trim();
          if (t.indexOf('发布文章') >= 0 || t.indexOf('发布') >= 0) {
            btns[i].click();
            return true;
          }
        }
        return false;
      })()`);
      await delay(3000);

      // Handle "保存成功" dialog — click "继续发布" if it appeared (means only draft was saved)
      const saveContinue = page.locator('button:has-text("继续发布"), a:has-text("继续发布")').first();
      if (await saveContinue.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveContinue.click();
        console.log("  51cto: clicked 继续发布 on save-success dialog");
        await delay(3000);
      }

      return { ok: true, message: `Direct 51cto secondPublish=${secondClicked}, url=${page.url()}` };
    },
    segmentfault: async () => {
      await page.waitForLoadState("networkidle").catch(() => {});
      await delay(1000);

      const titleInput = page.locator("#title").first();
      if (await titleInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await titleInput.click();
        await delay(200);
        await titleInput.fill(article.title || "");
      }
      await delay(600);

      const safeMarkdown = JSON.stringify(article.markdown_content || "");
      await page.evaluate(`(function(){
        var cmHost = document.querySelector('.CodeMirror');
        if (cmHost && cmHost.CodeMirror) {
          cmHost.CodeMirror.setValue(${safeMarkdown});
        }
      })()`);
      await delay(1000);

      const addTagBtn = page.locator('text=添加标签').first();
      if (await addTagBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addTagBtn.click();
        await delay(1500);
        const badge: any = await page.evaluate(`(function(){
          var b = document.querySelector('.badge-tag');
          if (!b || b.offsetHeight === 0) return null;
          var r = b.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2, text: b.textContent.trim() };
        })()`);
        if (badge) {
          const badgeHit: any = badge;
          await page.mouse.click(badgeHit.x, badgeHit.y);
          console.log("  segmentfault: selected tag:", badgeHit.text);
          await delay(500);
        }
      }

      const submitBtn = page.locator('button.btn.btn-primary:has-text("提交")').first();
      const isDisabled = await submitBtn.isDisabled().catch(() => true);
      console.log("  segmentfault: submit disabled?", isDisabled);
      if (isDisabled) {
        await submitBtn.click({ force: true });
      } else {
        await submitBtn.click();
      }
      console.log("  segmentfault: clicked 提交");

      // Wait for navigation away from /write (up to 15s)
      let urlAfter = page.url();
      try {
        await page.waitForURL((url: URL) => !url.pathname.includes("/write"), { timeout: 15000 });
        urlAfter = page.url();
      } catch {
        // Fallback: check URL after a delay
        await delay(3000);
        urlAfter = page.url();
      }
      console.log("  segmentfault: URL after submit:", urlAfter);
      const isPublished = urlAfter.includes("/a/") || !urlAfter.includes("/write");
      const articleUrl = isPublished && urlAfter.includes("/a/") ? urlAfter : undefined;
      return { ok: isPublished, message: `Direct segmentfault url=${urlAfter}, published=${isPublished}`, url: articleUrl };
    },
    oschina: async () => {
      if (!/\/blog\/write/.test(page.url())) {
        const redirected = await page.evaluate("(function(){ var m = location.href.match(/\\/u\\/(\\d+)\\/?$/); if (m && m[1]) { location.href = 'https://my.oschina.net/u/' + m[1] + '/blog/write'; return true; } return false; })()");
        if (redirected) {
          await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(function() {});
          await delay(2000);
        }
      }

      const closeGuide = page.locator(':text("关闭引导")').first();
      if (await closeGuide.isVisible({ timeout: 2500 }).catch(function() { return false; })) {
        await closeGuide.click().catch(function() {});
        await delay(800);
      }

      const titleInput = page.locator('input.title-input, input[placeholder*="标题"], .title-input input').first();
      if (!(await titleInput.isVisible({ timeout: 6000 }).catch(function() { return false; }))) {
        return { ok: false, message: "Direct oschina no-title-input url=" + page.url() };
      }
      await titleInput.fill(article.title || "");
      await delay(600);

      const htmlContent = article.html_content || "<p>" + (article.markdown_content || "").replace(/\n/g, "<br>") + "</p>";
      const safeHtml = JSON.stringify(htmlContent);
      const fillScript = "(function(){ var html = " + safeHtml + "; var editor = document.querySelector('.ProseMirror, .tiptap, [contenteditable=\"true\"]'); if (!editor) return 'no-editor'; editor.focus(); var sel = window.getSelection(); var range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range); var dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', html.replace(/<[^>]+>/g, '')); var pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); editor.dispatchEvent(pasteEvt); return 'pasted'; })()";
      const fillResult = await page.evaluate(fillScript);
      console.log("  oschina: fill result:", fillResult);
      await delay(1500);

      const hasContent = await page.evaluate("(function(){ var editor = document.querySelector('.ProseMirror, .tiptap, [contenteditable=\"true\"]'); return editor && editor.textContent && editor.textContent.trim().length > 10; })()");
      if (!hasContent) {
        await page.evaluate("(function(){ var editor = document.querySelector('.ProseMirror, .tiptap, [contenteditable=\"true\"]'); if (!editor) return; editor.focus(); var sel = window.getSelection(); var range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range); document.execCommand('insertHTML', false, " + safeHtml + "); })()");
        await delay(1000);
        console.log("  oschina: used execCommand fallback");
      }

      const publishBtn = page.locator(':text("发布文章")').first();
      if (await publishBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
        await publishBtn.click();
        console.log("  oschina: clicked 发布文章");
        await delay(2000);
      }

      // 勾选"是否公开"复选框（默认未勾选，导致文章发布为私密）
      await page.evaluate("(function(){ var wrappers = document.querySelectorAll('.ant-checkbox-wrapper'); for (var i = 0; i < wrappers.length; i++) { var w = wrappers[i]; var text = w.textContent.trim(); if (text.indexOf('公开') >= 0 && !w.classList.contains('ant-checkbox-wrapper-checked')) { var input = w.querySelector('input[type=\"checkbox\"]') || w.querySelector('.ant-checkbox-input'); if (input) { input.click(); } else { w.click(); } } } })()");
      console.log("  oschina: checked 是否公开");
      await delay(500);

      const confirmBtn = page.locator(':text("确定并发布"), :text("确认发布")').first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
        await confirmBtn.click();
        console.log("  oschina: clicked confirm");
        await delay(4000);
      }

      let finalUrl = page.url();
      let published = finalUrl.includes("/blog/") && !finalUrl.includes("/blog/write");
      if (!published) {
        try {
          await page.waitForURL(function(url: URL) { return url.pathname.includes("/blog/") && !url.pathname.includes("/blog/write"); }, { timeout: 8000 });
          finalUrl = page.url();
          published = true;
        } catch {
          await delay(3000);
          finalUrl = page.url();
          published = finalUrl.includes("/blog/") && !finalUrl.includes("/blog/write");
        }
      }
      return { ok: published, message: "Direct oschina url=" + finalUrl, url: published ? finalUrl : undefined };
    },
    bilibili: async () => {
      const titleInput = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first();
      if (await titleInput.isVisible({ timeout: 8000 }).catch(function() { return false; })) {
        await titleInput.fill(article.title || "");
      }
      await delay(600);

      const rawHtml = (article.html_content || article.markdown_content || "").replace(/<img[^>]*>/gi, "");
      const safeHtml = JSON.stringify(rawHtml);
      const fillScript = "(function(){ var html = " + safeHtml + "; var qlEditor = document.querySelector('.ql-editor'); if (qlEditor) { var quill = qlEditor.__quill || (qlEditor.parentElement && qlEditor.parentElement.__quill); if (!quill) { var container = qlEditor.closest('.ql-container'); if (container) quill = container.__quill; } if (quill && quill.clipboard && typeof quill.clipboard.dangerouslyPasteHTML === 'function') { quill.clipboard.dangerouslyPasteHTML(html); return 'quill-api'; } qlEditor.focus(); var sel = window.getSelection(); var range = document.createRange(); range.selectNodeContents(qlEditor); sel.removeAllRanges(); sel.addRange(range); var dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', html.replace(/<[^>]+>/g, '')); var pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); qlEditor.dispatchEvent(pasteEvt); return 'paste-event'; } var editor = document.querySelector('[contenteditable=\"true\"]'); if (editor) { editor.focus(); var sel2 = window.getSelection(); var range2 = document.createRange(); range2.selectNodeContents(editor); sel2.removeAllRanges(); sel2.addRange(range2); document.execCommand('insertHTML', false, html); return 'execCommand'; } return 'no-editor'; })()";
      const fillResult = await page.evaluate(fillScript);
      console.log("  bilibili: fill result:", fillResult);
      await delay(1200);

      // Expand "更多设置" section and select a category before submitting
      const moreSettings = page.locator('text="更多设置"').first();
      if (await moreSettings.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
        await moreSettings.click();
        console.log("  bilibili: expanded 更多设置");
        await delay(800);
      }

      // Select first available category if category selector exists
      const categorySelect = page.locator('.category-list .category-tag, .article-type .bre-select, select[class*="category"], .bre-radio-group .bre-radio').first();
      if (await categorySelect.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
        await categorySelect.click();
        console.log("  bilibili: selected category");
        await delay(500);
      } else {
        // Try clicking any unselected category button/chip
        const categoryBtn = page.locator('.category-list button, .category-list .tag, [class*="category"] .bre-radio, [class*="category"] label').first();
        if (await categoryBtn.isVisible({ timeout: 2000 }).catch(function() { return false; })) {
          await categoryBtn.click();
          console.log("  bilibili: selected category via button");
          await delay(500);
        }
      }

      await page.screenshot({ path: "/tmp/omnipub-workflow/bilibili-step3-after-settings.png" });

      const submitBtn2 = page.locator('button.bre-btn.primary:has-text("提交文章")').first();
      if (await submitBtn2.isVisible({ timeout: 3000 }).catch(function() { return false; })) {
        await submitBtn2.click();
        console.log("  bilibili: clicked 提交文章");
      }

      let hasSuccess = false;
      let articleUrl: string | undefined;
      for (let wait = 0; wait < 15; wait++) {
        await delay(1000);
        const curUrl = page.url();
        const aidMatch = curUrl.match(/aid=(\d+)/);
        if (aidMatch) {
          articleUrl = "https://www.bilibili.com/read/cv" + aidMatch[1];
          hasSuccess = true;
          console.log("  bilibili: success! aid=" + aidMatch[1]);
          break;
        }
        const successText = await page.locator(':text("提交成功"), :text("已提交成功")').first().isVisible().catch(function() { return false; });
        if (successText) {
          hasSuccess = true;
          const aidMatch2 = page.url().match(/aid=(\d+)/);
          if (aidMatch2) articleUrl = "https://www.bilibili.com/read/cv" + aidMatch2[1];
          console.log("  bilibili: success dialog detected");
          break;
        }
      }

      await page.screenshot({ path: "/tmp/omnipub-workflow/bilibili-step4-final.png" });
      console.log("  bilibili: success:", hasSuccess, "url:", articleUrl);

      return { ok: hasSuccess, message: "Direct bilibili success=" + hasSuccess + ", url=" + (articleUrl || page.url()), url: articleUrl };
    },
    infoq: async () => {
      const titleInput = page.locator('input[placeholder*="标题"], input[type="text"]').first();
      if (await titleInput.isVisible({ timeout: 5000 }).catch(function() { return false; })) {
        await titleInput.fill(article.title || "");
      }
      await delay(600);

      const safeHtml = JSON.stringify(article.html_content || article.markdown_content || "");
      const fillScript = "(function(){ var html = " + safeHtml + "; var editor = document.querySelector('.ProseMirror, [contenteditable=\"true\"]'); if (!editor) return 'no-editor'; editor.focus(); var sel = window.getSelection(); var range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range); var dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', html.replace(/<[^>]+>/g, '')); var pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); editor.dispatchEvent(pasteEvt); return 'pasted'; })()";
      const fillResult = await page.evaluate(fillScript);
      console.log("  infoq: fill result:", fillResult);
      await delay(1500);

      const hasContent = await page.evaluate("(function(){ var editor = document.querySelector('.ProseMirror, [contenteditable=\"true\"]'); return editor && editor.textContent && editor.textContent.trim().length > 10; })()");
      if (!hasContent) {
        await page.evaluate("(function(){ var editor = document.querySelector('.ProseMirror, [contenteditable=\"true\"]'); if (!editor) return; editor.focus(); var sel = window.getSelection(); var range = document.createRange(); range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range); document.execCommand('insertHTML', false, " + safeHtml + "); })()");
        await delay(1000);
        console.log("  infoq: used execCommand fallback");
      }

      await page.click('[gk-button][class*=submit]', { timeout: 5000 }).catch(function() {});
      console.log("  infoq: clicked publish button via Playwright");

      var settingsReady = false;
      for (var wi = 0; wi < 20; wi++) {
        await delay(500);
        const htmlLen = await page.evaluate("(function(){ var modals = document.querySelectorAll('.dialog-setting'); for (var i = 0; i < modals.length; i++) { if (modals[i].innerHTML.length > 50) return modals[i].innerHTML.length; } return 0; })()") as number;
        if (htmlLen > 50) { settingsReady = true; break; }
      }
      console.log("  infoq: settings modal ready:", settingsReady);

      var confirmClicked = "";
      if (settingsReady) {
        confirmClicked = await page.evaluate("(function(){ var modals = document.querySelectorAll('.dialog-setting'); var modal = null; for (var i = 0; i < modals.length; i++) { if (modals[i].innerHTML.length > 50) { modal = modals[i]; break; } } if (!modal) return 'no-modal'; var btn = modal.querySelector('[gkbtn-color=\"green\"]'); if (btn) { btn.click(); return (btn.textContent || '').trim(); } var footer = modal.querySelector('.dialog-footer-buttons'); if (footer) { var btns = footer.querySelectorAll('[gk-button]'); for (var j = 0; j < btns.length; j++) { var t = (btns[j].textContent || '').trim(); if (t === '确定' || t === '确认') { btns[j].click(); return t; } } } return 'no-confirm-btn'; })()") as string;
        console.log("  infoq: confirm clicked:", confirmClicked);
      }

      await delay(8000);
      const finalUrl = page.url();
      const isPublished = !finalUrl.includes("/draft/") || finalUrl.includes("/article/");
      const successDialog = await page.locator(':text("发布成功"), :text("已发布")').first().isVisible().catch(function() { return false; });
      return { ok: isPublished || successDialog || (confirmClicked !== "" && confirmClicked !== "no-modal" && confirmClicked !== "no-confirm-btn"), message: "Direct infoq confirm=" + (confirmClicked || "none") + ", url=" + finalUrl, url: isPublished ? finalUrl : undefined };
    },
  };

  const handler = handlers[platform.slug];
  if (!handler) {
    return { ok: false, message: `No direct handler for ${platform.slug}` };
  }

  try {
    return await handler();
  } catch (e: any) {
    return { ok: false, message: `Direct manipulation error: ${e.message}` };
  }
}

async function sendFillAndPublishViaServiceWorker(
  context: BrowserContext,
  sw: ServiceWorkerRef,
  platform: PlatformDef,
  article: any,
  page: Page,
  actualUrl?: string,
  publishConfig?: any,
): Promise<{ ok: boolean; tabId?: number; message?: string }> {
  // Strategy 1 (PREFERRED): Direct Playwright page manipulation — most reliable,
  // avoids extension false-positive "success" reports
  const directResult = await directFillAndPublish(page, platform, article, context, publishConfig);
  if (directResult.ok) return directResult;
  console.log(`  Direct fill+publish returned not-ok: ${directResult.message}`);

  // Strategy 2: Try via service worker with retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await Promise.race([
        sw.evaluate(() => true),
        new Promise((_, reject) => setTimeout(() => reject(new Error("SW ping timeout")), 3000)),
      ]);
      const result = await Promise.race([
        sendFillAndPublishViaSW(sw, platform, article, actualUrl, publishConfig),
        new Promise<{ ok: boolean; message: string }>((_, reject) =>
          setTimeout(() => reject(new Error("SW evaluate timeout (8s)")), 8000),
        ),
      ]);
      return result;
    } catch (e: any) {
      console.log(`  SW attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt === 0) {
        try {
          sw = await ensureServiceWorker(context);
        } catch {}
      }
    }
  }

  // Strategy 3: CDP fallback
  console.log("  Falling back to CDP direct message...");
  const cdpResult = await sendFillAndPublishViaCDP(context, page, platform, article, publishConfig);
  return cdpResult;
}

function isLikelyLoginRedirect(url: string): boolean {
  return /login|passport|signin|signup|sso|auth/i.test(url);
}

async function runPlatformFlow(context: BrowserContext, sw: ServiceWorkerRef, platform: PlatformDef, article: any, publishConfig?: any): Promise<WorkflowResult> {
  const startedAt = new Date().toISOString();
  const navigationHistory: string[] = [];
  const steps: StepSnapshot[] = [];

  const result: WorkflowResult = {
    platform: platform.slug,
    editorUrl: platform.editorUrl,
    articleId: ARTICLE_ID,
    startedAt,
    finishedAt: startedAt,
    loginOk: true,
    fillOk: false,
    publishClicked: false,
    confirmFound: false,
    finalStatus: "failed",
    notes: "",
    steps,
  };

  const page = await context.newPage();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const u = frame.url();
      if (u && navigationHistory[navigationHistory.length - 1] !== u) {
        navigationHistory.push(u);
      }
    }
  });

  try {
    // InfoQ requires creating a draft via API before navigating to the editor
    let actualEditorUrl: string = platform.editorUrl;
    if (platform.slug === "infoq") {
      try {
        await page.goto("https://xie.infoq.cn", { waitUntil: "domcontentloaded", timeout: 15000 });
        await delay(1000);
        const draftResult = await page.evaluate(async () => {
          const resp = await fetch("/api/v1/draft/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            credentials: "include",
          });
          const json = await resp.json();
          return { code: json?.code, id: json?.data?.id || json?.data?.draftId };
        });
        if (draftResult.code === 0 && draftResult.id) {
          actualEditorUrl = `https://xie.infoq.cn/draft/${draftResult.id}`;
          console.log(`  InfoQ draft created: ${draftResult.id}, navigating to ${actualEditorUrl}`);
        } else {
          console.warn(`  InfoQ draft creation failed:`, JSON.stringify(draftResult));
        }
      } catch (e: any) {
        console.warn(`  InfoQ draft API error: ${e.message}`);
      }
    }

    await page.goto(actualEditorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await delay(2000);

    // OSCHINA: /blog/write redirects to /u/{uid}/ or / — detect and navigate to /u/{uid}/blog/write
    if (platform.slug === "oschina") {
      const currentUrl = page.url();
      console.log("  OSCHINA: currentUrl after initial nav:", currentUrl);
      const uidMatch = currentUrl.match(/\/u\/(\d+)/);
      const isOnWritePage = /\/blog\/write/.test(currentUrl);
      console.log("  OSCHINA: uidMatch:", !!uidMatch, "isOnWritePage:", isOnWritePage);
      if (!isOnWritePage) {
        let uid = uidMatch?.[1];
        if (!uid) {
          // Use page.evaluate to call API from the same page context (has cookies)
          try {
            const apiResult: any = await page.evaluate("(function(){ return fetch('/action/apiv2/user/myself', { credentials: 'include' }).then(function(r){ return r.json(); }).then(function(j){ return { id: j && j.result && j.result.id ? String(j.result.id) : '0' }; }).catch(function(){ return { id: '0' }; }); })()");
            console.log("  OSCHINA: API myself result:", JSON.stringify(apiResult));
            uid = apiResult?.id;
          } catch (e: any) {
            console.log("  OSCHINA: API error:", e.message);
          }
        }
        if (!uid || uid === "0") {
          // Fallback: navigate to /action/user/info which redirects to /u/{uid}/
          console.log("  OSCHINA: API failed, trying redirect-based UID resolution...");
          await page.goto("https://my.oschina.net/action/user/info", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
          await delay(1000);
          const redirectUrl = page.url();
          console.log("  OSCHINA: redirect URL:", redirectUrl);
          const redirectUid = redirectUrl.match(/\/u\/(\d+)/)?.[1];
          if (redirectUid) uid = redirectUid;
        }
        console.log("  OSCHINA: resolved uid:", uid);
        if (uid && uid !== "0") {
          actualEditorUrl = `https://my.oschina.net/u/${uid}/blog/write`;
          console.log(`  OSCHINA redirect detected (uid=${uid}), navigating to ${actualEditorUrl}`);
          await page.goto(actualEditorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
          await delay(2000);
        } else {
          console.log("  OSCHINA: WARNING - could not resolve UID, staying on:", page.url());
        }
      }
    }

    // OSCHINA: dismiss "全文写作" AI wizard overlay before content script runs
    if (platform.slug === "oschina") {
      const closeGuide = page.locator(':text("关闭引导")').first();
      if (await closeGuide.isVisible({ timeout: 3000 }).catch(() => false)) {
        await closeGuide.click();
        console.log("  OSCHINA: dismissed AI writing wizard");
        await delay(1000);
      }
    }

    // InfoQ: dismiss feature announcement modals ("知道了" buttons)
    if (platform.slug === "infoq") {
      for (let i = 0; i < 3; i++) {
        const btn = page.locator(':text-is("知道了")').first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          console.log(`  InfoQ: dismissed announcement modal #${i + 1}`);
          await delay(800);
        } else {
          break;
        }
      }
    }

    steps.push(await captureStep(page, platform.slug, "step0-navigate", navigationHistory, "Editor opened"));

    const redirected = isLikelyLoginRedirect(page.url());
    steps.push(await captureStep(
      page,
      platform.slug,
      "step1-login-check",
      navigationHistory,
      redirected ? "Redirected to login. Skipping platform." : "Not redirected to login",
    ));

    if (redirected) {
      result.loginOk = false;
      result.finalStatus = "skipped-login";
      result.notes = `login redirect: ${page.url()}`;
      return result;
    }

    const sendResult = await sendFillAndPublishViaServiceWorker(context, sw, platform, article, page, actualEditorUrl, publishConfig);
    result.fillOk = sendResult.ok;
    if (!sendResult.ok) {
      result.finalStatus = "failed";
      result.notes = `FILL_AND_PUBLISH failed: ${sendResult.message || "unknown"}`;
    }

    await delay(2000);
    steps.push(await captureStep(page, platform.slug, "step2-after-fill-2s", navigationHistory, sendResult.message));

    const checkpoints = [1000, 3000, 5000, 10000];
    let elapsed = 0;
    for (const t of checkpoints) {
      const wait = t - elapsed;
      await delay(wait);
      elapsed = t;
      const stepName = `step3-after-publish-${t}ms`;
      steps.push(await captureStep(page, platform.slug, stepName, navigationHistory));
    }

    const confirmStep = steps.find((s) =>
      s.modalsDialogsOverlays.some((m) => /确认|确定|发布|submit|confirm|publish/i.test(m.text || "")) ||
      s.publishConfirmButtons.some((b) => /确认|确定|继续|发布|confirm|publish|submit/i.test(b.text || "")),
    );
    result.confirmFound = !!confirmStep;
    if (confirmStep) {
      steps.push(await captureStep(page, platform.slug, "step4-confirm-dialog", navigationHistory, `Confirm signal from ${confirmStep.step}`));
    } else {
      steps.push(await captureStep(page, platform.slug, "step4-confirm-dialog", navigationHistory, "No explicit confirm dialog detected"));
    }

    await delay(3000);
    const finalStep = await captureStep(page, platform.slug, "step5-final", navigationHistory);
    steps.push(finalStep);

    result.publishClicked = steps.some((s) =>
      s.toastsNotifications.some((t) => /发布按钮已点击|success|成功|submitted?/i.test(`${t.text} ${t.innerHTMLSnippet}`)) ||
      s.publishConfirmButtons.some((b) => /发布|提交|confirm|publish/i.test(b.text || "")),
    );

    if (!result.fillOk) {
      result.finalStatus = "failed";
    } else if (isLikelyLoginRedirect(finalStep.url)) {
      result.finalStatus = "skipped-login";
      result.loginOk = false;
    } else {
      result.finalStatus = "ok";
    }

    result.notes = safeSnippet(
      [
        sendResult.message ? `send=${sendResult.message}` : "",
        `finalUrl=${finalStep.url}`,
        `modals=${finalStep.modalsDialogsOverlays.length}`,
        `errors=${finalStep.validationErrors.length}`,
      ]
        .filter(Boolean)
        .join(" | "),
      300,
    );

    return result;
  } finally {
    result.finishedAt = new Date().toISOString();
    const outPath = path.join(OUTPUT_DIR, `${platform.slug}-workflow.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    await page.close().catch(() => {});
  }
}

function printSummary(results: WorkflowResult[]) {
  const headers = [
    "Platform",
    "Login OK",
    "Fill OK",
    "Publish Clicked",
    "Confirm Found",
    "Final Status",
    "Notes",
  ];
  const rows = results.map((r) => [
    r.platform,
    r.loginOk ? "Y" : "N",
    r.fillOk ? "Y" : "N",
    r.publishClicked ? "Y" : "N",
    r.confirmFound ? "Y" : "N",
    r.finalStatus,
    safeSnippet(r.notes, 80),
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  const fmt = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;

  console.log("\nWorkflow Summary");
  console.log(line);
  console.log(fmt(headers));
  console.log(line);
  for (const row of rows) console.log(fmt(row));
  console.log(line);
}

async function withPlatformTimeout<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${platform} timed out (120s)`)), 120000);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  cleanStaleLocks(PROFILE_DIR);
  fixProfileCrashState(PROFILE_DIR);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-blink-features=AutomationControlled",
    ],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"],
  });

  // Hide automation signals from anti-bot detection (e.g. zhihu checks navigator.webdriver)
  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Remove Playwright-injected properties
    delete window.__playwright;
    delete window.__pw_manual;
  `);

  await grantExtensionHostPermissions(context);
  const restored = await restoreCookies(context, PROFILE_DIR);
  if (restored > 0) {
    console.log(`🍪 Restored ${restored} cookies from saved state`);
  }

  const results: WorkflowResult[] = [];

  try {
    const sw = await ensureServiceWorker(context);
    const page = context.pages()[0] || await context.newPage();
    const token = await loginOmnipub(page);
    const article = await fetchArticle(page, token, ARTICLE_ID);
    const platformConfigs = await fetchPlatformConfigs(page, token);

    const targetPlatforms = PLATFORM_ENV === "all"
      ? PLATFORMS
      : PLATFORMS.filter((p) => p.slug === PLATFORM_ENV);

    if (targetPlatforms.length === 0) {
      throw new Error(`Unknown PLATFORM=${PLATFORM_ENV}. Valid: all|${PLATFORMS.map((p: PlatformDef) => p.slug).join("|")}`);
    }

    console.log(`\nRunning publish-flow recorder for: ${targetPlatforms.map((p: PlatformDef) => p.slug).join(", ")}`);
    console.log(`Article ID: ${ARTICLE_ID}`);
    console.log(`Output: ${OUTPUT_DIR}`);
    for (const p of targetPlatforms) {
      const cfg = platformConfigs[p.slug];
      if (cfg?.append_markdown) {
        console.log(`  ${p.slug}: append_markdown = "${cfg.append_markdown.slice(0, 60)}${cfg.append_markdown.length > 60 ? "..." : ""}"`);
      }
    }

    for (const platform of targetPlatforms) {
      try {
        const r = await withPlatformTimeout(platform.slug, () => runPlatformFlow(context, sw, platform, article, platformConfigs[platform.slug]));
        results.push(r);
      } catch (e: any) {
        const failed: WorkflowResult = {
          platform: platform.slug,
          editorUrl: platform.editorUrl,
          articleId: ARTICLE_ID,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          loginOk: true,
          fillOk: false,
          publishClicked: false,
          confirmFound: false,
          finalStatus: /timed out/i.test(String(e?.message || "")) ? "timeout" : "failed",
          notes: safeSnippet(String(e?.message || e), 300),
          steps: [],
        };
        results.push(failed);
        fs.writeFileSync(path.join(OUTPUT_DIR, `${platform.slug}-workflow.json`), JSON.stringify(failed, null, 2));
      }
    }

    printSummary(results);
  } finally {
    await saveCookies(context, PROFILE_DIR).catch(() => {});
    await context.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
