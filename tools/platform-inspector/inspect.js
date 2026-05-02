/**
 * platform-inspector/inspect.js
 *
 * 交互式平台调查工具
 * 用法：node inspect.js [platform-slug]
 *
 * 功能：
 * 1. 打开平台登录页，等待用户手动登录（支持验证码）
 * 2. 登录后保存 cookies 到 cookies/<slug>.json
 * 3. 打开编辑器页面，自动扫描 DOM：
 *    - 发布按钮候选
 *    - 标题输入框
 *    - 正文编辑器
 *    - 分类/标签选择器
 *    - 封面图上传区域
 * 4. 输出调查结果到 results/<slug>.json
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── 平台配置 ────────────────────────────────────────────────
// editor_url 与后端 SEED_PLATFORMS 的 new_article_url 保持一致
const PLATFORMS = {
  juejin: {
    name: "掘金",
    login_url: "https://juejin.cn/login",
    editor_url: "https://juejin.cn/editor/drafts/new",
    login_check_url: "https://juejin.cn",
    login_detect_selector: ".avatar, .user-avatar, .nav-user-info",
  },
  csdn: {
    name: "CSDN",
    login_url: "https://passport.csdn.net/login",
    editor_url: "https://mp.csdn.net/mp_blog/creation/editor",
    login_check_url: "https://mp.csdn.net",  // 直接用 mp 子域，登录后才能访问
    login_detect_selector: ".avatar, .user-info",
  },
  zhihu: {
    name: "知乎",
    login_url: "https://www.zhihu.com/signin",
    editor_url: "https://zhuanlan.zhihu.com/write",
    login_check_url: "https://www.zhihu.com",
    login_detect_selector: ".AppHeader-userInfo, .Avatar",
  },
  cnblogs: {
    name: "博客园",
    login_url: "https://account.cnblogs.com/signin",
    editor_url: "https://i.cnblogs.com/posts/edit",
    login_check_url: "https://i.cnblogs.com",  // 编辑后台，登录后才可访问
    login_detect_selector: "#navbar_name, .blog-nav-menu",
  },
  toutiao: {
    name: "今日头条",
    login_url: "https://mp.toutiao.com/auth/page/login",
    editor_url: "https://mp.toutiao.com/profile_v4/graphic/publish",
    login_check_url: "https://mp.toutiao.com",
    login_detect_selector: ".avatar-wrap, .user-avatar",
  },
  "tencent-cloud": {
    name: "腾讯云",
    login_url: "https://cloud.tencent.com/login",
    editor_url: "https://cloud.tencent.com/developer/article/write-new",
    login_check_url: "https://cloud.tencent.com/developer",
    login_detect_selector: ".j-userinfo, .user-nick, .gg-user-name",
  },
  "51cto": {
    name: "51CTO",
    login_url: "https://home.51cto.com/index",
    editor_url: "https://blog.51cto.com/blogger/publish",
    login_check_url: "https://blog.51cto.com",
    login_detect_selector: ".user-avatar, .uname",
  },
  segmentfault: {
    name: "思否",
    login_url: "https://segmentfault.com/user/login",
    editor_url: "https://segmentfault.com/write",
    login_check_url: "https://segmentfault.com",
    login_detect_selector: ".user-avatar, .nav__user",
  },
  oschina: {
    name: "开源中国",
    login_url: "https://www.oschina.net/home/login",
    // /blog/write 会 redirect 到 /u/<uid>/blog/write，直接跟随即可
    editor_url: "https://my.oschina.net/blog/write",
    login_check_url: "https://my.oschina.net",
    login_detect_selector: ".user-avatar, .header-avatar",
  },
  bilibili: {
    name: "哔哩哔哩",
    login_url: "https://passport.bilibili.com/login",
    editor_url: "https://member.bilibili.com/platform/upload/text/new-edit",
    login_check_url: "https://member.bilibili.com",
    login_detect_selector: ".bili-avatar, .user-face",
  },
  infoq: {
    name: "InfoQ",
    login_url: "https://account.geekbang.org/infoq/login/sms?redirect=https%3A%2F%2Fxie.infoq.cn%2F",
    // InfoQ 需要先创建草稿才有编辑器 URL（格式：/draft/<id>）
    // 打开文章列表页，手动点"写文章"按钮，等跳转后再按 Enter 扫描
    editor_url: "https://xie.infoq.cn/article/publish",
    login_check_url: "https://xie.infoq.cn",
    login_detect_selector: ".avatar, .user-avatar, .ant-avatar",
  },
};

const COOKIES_DIR = path.join(__dirname, "cookies");
const RESULTS_DIR = path.join(__dirname, "results");
fs.mkdirSync(COOKIES_DIR, { recursive: true });
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ─── 工具函数 ─────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function cookiePath(slug) {
  return path.join(COOKIES_DIR, `${slug}.json`);
}

async function saveCookies(context, slug) {
  const cookies = await context.cookies();
  fs.writeFileSync(cookiePath(slug), JSON.stringify(cookies, null, 2));
  console.log(`  ✅ Cookies 已保存到 cookies/${slug}.json（共 ${cookies.length} 个）`);
}

async function loadCookies(context, slug) {
  const file = cookiePath(slug);
  if (!fs.existsSync(file)) return false;
  const cookies = JSON.parse(fs.readFileSync(file, "utf-8"));
  await context.addCookies(cookies);
  console.log(`  📂 已加载已保存的 cookies（共 ${cookies.length} 个）`);
  return true;
}

// ─── DOM 扫描函数 ─────────────────────────────────────────────

async function scanEditorPage(page, slug) {
  console.log("\n  🔍 开始扫描编辑器 DOM...");

  const result = await page.evaluate(() => {
    const findings = {
      title_inputs: [],
      content_editors: [],
      publish_buttons: [],
      category_selectors: [],
      tag_inputs: [],
      cover_upload: [],
      login_cookies: [],
    };

    // ── 标题输入框 ──
    const titleCandidates = [
      ...document.querySelectorAll('input[placeholder*="标题"], input[placeholder*="title"], input[placeholder*="Title"]'),
      ...document.querySelectorAll('input[placeholder*="请输入"], textarea[placeholder*="请输入"]'),
      ...document.querySelectorAll('input.title, input#title, input[name="title"], input#article_title, input#titleInput'),
      ...document.querySelectorAll('div[contenteditable][class*="title"], textarea[class*="title"]'),
      ...document.querySelectorAll('input[class*="title"], input[class*="Title"]'),
    ];
    findings.title_inputs = titleCandidates.slice(0, 5).map(el => ({
      tag: el.tagName,
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      placeholder: el.getAttribute("placeholder") || "",
      selector: el.id ? `#${el.id}` : `.${el.className.trim().split(/\s+/)[0]}`,
    }));

    // ── 正文编辑器 ──
    const editorCandidates = [
      ...document.querySelectorAll(".CodeMirror, .bytemd, .w-e-text, .ql-editor"),
      ...document.querySelectorAll('[class*="editor"], [class*="Editor"]'),
      ...document.querySelectorAll("div[contenteditable=true]"),
      ...document.querySelectorAll("textarea.content, textarea#content"),
    ];
    findings.content_editors = [...new Set(editorCandidates)].slice(0, 5).map(el => ({
      tag: el.tagName,
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      contenteditable: el.getAttribute("contenteditable"),
    }));

    // ── 发布按钮 ──
    const publishKeywords = /^(发布|发表|提交|Publish|Submit|确认发布)$/;
    const allButtons = [...document.querySelectorAll('button, [role="button"], a.btn, input[type="submit"]')];
    const publishBtns = allButtons.filter(el => publishKeywords.test((el.textContent || el.value || "").trim()));
    // 也找包含"发布"的按钮
    const publishBtns2 = allButtons.filter(el => (el.textContent || "").includes("发布") && !publishKeywords.test((el.textContent || "").trim()));
    findings.publish_buttons = [...publishBtns, ...publishBtns2].slice(0, 8).map(el => ({
      tag: el.tagName,
      text: (el.textContent || el.value || "").trim().substring(0, 30),
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      disabled: el.disabled,
    }));

    // ── 分类选择 ──
    const categoryCandidates = [
      ...document.querySelectorAll('select[name*="category"], select[name*="type"]'),
      ...document.querySelectorAll('[class*="category"], [class*="Category"]'),
      ...document.querySelectorAll('[class*="classify"], [class*="Classify"]'),
    ];
    findings.category_selectors = categoryCandidates.slice(0, 5).map(el => ({
      tag: el.tagName,
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      text: el.textContent.trim().substring(0, 40),
    }));

    // ── 标签输入 ──
    const tagCandidates = [
      ...document.querySelectorAll('input[placeholder*="标签"], input[placeholder*="tag"]'),
      ...document.querySelectorAll('[class*="tag"], [class*="Tag"]'),
    ].filter(el => !["path", "svg", "circle", "rect", "line", "polyline", "polygon", "use"].includes(el.tagName.toLowerCase()));
    findings.tag_inputs = tagCandidates.slice(0, 5).map(el => ({
      tag: el.tagName,
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      placeholder: el.getAttribute("placeholder") || "",
    }));

    // ── 封面图 ──
    const coverCandidates = [
      ...document.querySelectorAll('[class*="cover"], [class*="Cover"], [class*="thumbnail"]'),
      ...document.querySelectorAll('input[type="file"]'),
    ];
    findings.cover_upload = coverCandidates.slice(0, 5).map(el => ({
      tag: el.tagName,
      id: el.id,
      class: String(el.className || '').substring(0, 80),
      accept: el.getAttribute("accept") || "",
    }));

    return findings;
  });

  // 当前 cookies（用于识别登录 cookie）
  const cookies = await page.context().cookies();
  result.all_cookies = cookies.map(c => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly }));

  return result;
}

// ─── 主流程 ───────────────────────────────────────────────────

async function inspectPlatform(slug) {
  const platform = PLATFORMS[slug];
  if (!platform) {
    console.error(`❌ 未知平台: ${slug}`);
    console.log("可用平台:", Object.keys(PLATFORMS).join(", "));
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔎 调查平台: ${platform.name} (${slug})`);
  console.log(`${"=".repeat(60)}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    // 隐藏 webdriver 特征
    extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  // 注入脚本隐藏 automation 标记
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const hasSavedCookies = await loadCookies(context, slug);
  const page = await context.newPage();

  // ── 检查登录状态 ──
  let isLoggedIn = false;
  if (hasSavedCookies) {
    await page.goto(platform.login_check_url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    isLoggedIn = await page.locator(platform.login_detect_selector).isVisible().catch(() => false);
    if (isLoggedIn) {
      console.log(`  ✅ 已通过保存的 cookies 登录`);
    } else {
      console.log(`  ⚠️  保存的 cookies 已失效，需要重新登录`);
    }
  }

  // ── 登录 ──
  if (!isLoggedIn) {
    console.log(`\n  📌 请在打开的浏览器窗口中完成登录：${platform.login_url}`);
    await page.goto(platform.login_url);
    await prompt(`  ⏳ 登录完成后按 Enter 继续...`);
    await saveCookies(context, slug);
  }

  // ── 打开编辑器页面 ──
  console.log(`\n  📝 正在打开编辑器: ${platform.editor_url}`);
  await page.goto(platform.editor_url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000); // 额外等待 SPA 渲染

  await prompt(`  ⏳ 确认编辑器已完整加载后按 Enter 开始扫描...`);

  // ── 扫描 DOM ──
  const scanResult = await scanEditorPage(page, slug);

  // ── 保存结果 ──
  const output = {
    slug,
    name: platform.name,
    scanned_at: new Date().toISOString(),
    login_url: platform.login_url,
    editor_url: platform.editor_url,
    ...scanResult,
  };

  const resultFile = path.join(RESULTS_DIR, `${slug}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(output, null, 2));
  console.log(`\n  💾 扫描结果已保存: results/${slug}.json`);

  // ── 打印摘要 ──
  console.log("\n  📊 扫描摘要:");
  console.log(`    标题输入框: ${scanResult.title_inputs.length} 个`);
  console.log(`    正文编辑器: ${scanResult.content_editors.length} 个`);
  console.log(`    发布按钮:   ${scanResult.publish_buttons.length} 个`);
  if (scanResult.publish_buttons.length > 0) {
    scanResult.publish_buttons.forEach(b => {
      console.log(`      → "${b.text}" class="${b.class.split(" ")[0]}"`);
    });
  }
  console.log(`    分类选择:   ${scanResult.category_selectors.length} 个`);
  console.log(`    标签输入:   ${scanResult.tag_inputs.length} 个`);
  console.log(`    封面上传:   ${scanResult.cover_upload.length} 个`);
  console.log(`    全部 Cookies: ${scanResult.all_cookies.length} 个`);

  await prompt("\n  按 Enter 关闭浏览器...");
  await browser.close();

  return output;
}

// ─── 入口 ─────────────────────────────────────────────────────
const slug = process.argv[2];
const clearCookies = process.argv.includes("--clear-cookies");

if (!slug) {
  console.log("用法: node inspect.js <platform-slug> [--clear-cookies]");
  console.log("  --clear-cookies  清除已保存的 cookies，强制重新登录");
  console.log("可用平台:", Object.keys(PLATFORMS).join(", "));
  process.exit(1);
}

if (clearCookies) {
  const cookiePath = path.join(__dirname, "cookies", `${slug}.json`);
  if (fs.existsSync(cookiePath)) {
    fs.unlinkSync(cookiePath);
    console.log(`🗑️  已清除 ${slug} 的 cookies，将重新登录`);
  } else {
    console.log(`ℹ️  ${slug} 没有已保存的 cookies`);
  }
}

inspectPlatform(slug).catch(console.error);
