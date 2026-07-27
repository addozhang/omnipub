/**
 * 平台静态配置（硬编码到扩展，不再从后端 /api/platform-config 拉取）。
 *
 * 字段说明：
 * - slug / name：平台标识与中文名（与后端 Platform.slug 一致）
 * - matches：Chrome content_scripts 的 URL 匹配模式
 * - newArticleUrlPattern：新建文章页面 URL 正则（用于运行时识别）
 * - publisherScript：对应 publisher 脚本路径
 * - editor：编辑器选择器（base-publisher.js 用，schema 与原后端 editor_config 兼容）
 * - loginCheck：登录态检查配置（service-worker.js 的 checkLogin 用）
 *   - check_url：cookies.getAll 的 url
 *   - login_cookie：必须存在的 cookie 名
 *   - verify：服务端二次校验，用于击穿过期残留 cookie。两种模式：
 *     · API 模式    { url, method?, headers?, success_path?, success_value? }
 *     · 重定向模式  { url, login_url_pattern }  —— 请求需登录页面，看是否被 302 到登录页
 *
 * 为什么每个平台都必须配 verify：
 *   cookie 存在 ≠ 会话有效。后台登出、异地登录、服务端 token 撤销都会让会话失效，
 *   但 cookie 仍留在浏览器里直到其自身过期，此时纯 cookie 判断会误报「已登录」。
 */
// 双环境兼容：service worker 用 importScripts 加载（self 作用域），
// content script 通过 manifest 注入（window 作用域）。统一挂到 globalThis。
// eslint-disable-next-line no-unused-vars
const PLATFORM_CONFIGS = (globalThis.PLATFORM_CONFIGS = [
  {
    slug: "juejin",
    name: "掘金",
    matches: ["*://juejin.cn/*"],
    newArticleUrlPattern: /^https:\/\/juejin\.cn\/editor\/drafts\/new/,
    publisherScript: "content-scripts/publishers/juejin.js",
    editor: {
      editor_type: "bytemd",
      title_selector: ".title-input",
      content_selector: ".bytemd, .CodeMirror, .cm-editor",
    },
    loginCheck: {
      check_url: "https://juejin.cn",
      login_cookie: "sessionid",
      verify: {
        url: "https://api.juejin.cn/user_api/v1/user/get?aid=2608",
        success_path: "data.user_id",
      },
    },
  },
  {
    slug: "csdn",
    name: "CSDN",
    matches: ["*://editor.csdn.net/*", "*://mp.csdn.net/*"],
    newArticleUrlPattern: /^https:\/\/(editor|mp)\.csdn\.net\//,
    publisherScript: "content-scripts/publishers/csdn.js",
    editor: {
      editor_type: "iframe_richtext",
      title_selector: "#txtTitle, textarea[placeholder*='标题']",
      content_frame_selector: ".cke_wysiwyg_frame, iframe.cke_wysiwyg_frame",
      content_selector: ".cke_wysiwyg_frame, iframe.cke_wysiwyg_frame",
    },
    loginCheck: {
      check_url: "https://mp.csdn.net",
      login_cookie: "UserToken",
      // bizapi.csdn.net 需要 X-Ca-Key 签名头，扩展裸调用会 401，故改用 msg 服务。
      verify: {
        url: "https://msg.csdn.net/v1/web/message/view/unread",
        method: "POST",
        success_path: "data.avatarUrl",
      },
    },
  },
  {
    slug: "zhihu",
    name: "知乎",
    matches: ["*://zhuanlan.zhihu.com/*"],
    newArticleUrlPattern: /^https:\/\/zhuanlan\.zhihu\.com\/write/,
    publisherScript: "content-scripts/publishers/zhihu.js",
    editor: {
      editor_type: "prosemirror",
      title_selector: "textarea.Input",
      content_selector: ".DraftEditor-root, .ProseMirror, [contenteditable=true]",
    },
    loginCheck: {
      check_url: "https://zhuanlan.zhihu.com",
      login_cookie: "z_c0",
      verify: {
        url: "https://www.zhihu.com/api/v4/me",
        success_path: "id",
      },
    },
  },
  {
    slug: "cnblogs",
    name: "博客园",
    matches: ["*://i.cnblogs.com/*"],
    newArticleUrlPattern: /^https:\/\/i\.cnblogs\.com\/posts\/edit/,
    publisherScript: "content-scripts/publishers/cnblogs.js",
    editor: {
      editor_type: "markdown",
      title_selector: "#post-title",
      content_selector: "#TextEditor, .post-editor, .CodeMirror, textarea#Editor_Edit_EditorBody",
    },
    loginCheck: {
      check_url: "https://i.cnblogs.com",
      login_cookie: ".CNBlogsCookie",
      // 未登录返回 401 {"errors":["Unauthorized"]}，无 success_path 时只校验 HTTP 2xx。
      verify: {
        url: "https://i.cnblogs.com/api/user",
      },
    },
  },
  {
    slug: "toutiao",
    name: "今日头条",
    matches: ["*://mp.toutiao.com/*"],
    newArticleUrlPattern: /^https:\/\/mp\.toutiao\.com\/profile_v4\/graphic\/publish/,
    publisherScript: "content-scripts/publishers/toutiao.js",
    editor: {
      editor_type: "prosemirror",
      title_selector: ".publish-editor-title",
      content_selector: ".ProseMirror, [contenteditable=true]",
    },
    loginCheck: {
      check_url: "https://mp.toutiao.com",
      login_cookie: "sid_tt",
      // 未登录返回 err_no 100004 "user not login"。
      verify: {
        url: "https://mp.toutiao.com/mp/agw/media/get_media_info/",
        success_path: "err_no",
        success_value: 0,
      },
    },
  },
  {
    slug: "tencent-cloud",
    name: "腾讯云",
    matches: ["*://cloud.tencent.com/developer/*"],
    newArticleUrlPattern: /^https:\/\/cloud\.tencent\.com\/developer\/article\/write/,
    publisherScript: "content-scripts/publishers/tencent-cloud.js",
    editor: {
      editor_type: "markdown",
      title_selector: ".cdc-article-editor__title-input",
      content_selector: ".cdc-article-editor__content .CodeMirror, .cdc-article-editor .CodeMirror, .cm-editor, textarea",
    },
    loginCheck: {
      check_url: "https://cloud.tencent.com/developer",
      login_cookie: "qcommunity_session",
      // 无可裸调用的用户接口，改用重定向校验：未登录会 302 到 cloud.tencent.com/login。
      verify: {
        url: "https://cloud.tencent.com/developer/article/write",
        login_url_pattern: "cloud\\.tencent\\.com/login",
      },
    },
  },
  {
    slug: "51cto",
    name: "51CTO",
    matches: ["*://blog.51cto.com/*"],
    newArticleUrlPattern: /^https:\/\/blog\.51cto\.com\/blogger\/publish/,
    publisherScript: "content-scripts/publishers/51cto.js",
    editor: {
      editor_type: "richtext",
      title_selector: "input.ant-input.editor-title",
      content_selector: ".editor-container[contenteditable=true]",
    },
    loginCheck: {
      check_url: "https://blog.51cto.com",
      login_cookie: "pub_sauth1",
      // 未登录会 302 到 home.51cto.com/index。
      verify: {
        url: "https://blog.51cto.com/blogger/publish",
        login_url_pattern: "home\\.51cto\\.com",
      },
    },
  },
  {
    slug: "segmentfault",
    name: "思否",
    matches: ["*://segmentfault.com/*"],
    newArticleUrlPattern: /^https:\/\/segmentfault\.com\/write/,
    publisherScript: "content-scripts/publishers/segmentfault.js",
    editor: {
      editor_type: "markdown",
      title_selector: "#title",
      content_selector: ".CodeMirror, .cm-editor, textarea",
    },
    loginCheck: {
      check_url: "https://segmentfault.com",
      login_cookie: "PHPSESSID",
      // gateway 接口需额外校验头（裸调用返回 403「非法请求」），改用重定向校验。
      verify: {
        url: "https://segmentfault.com/write",
        login_url_pattern: "segmentfault\\.com/user/login",
      },
    },
  },
  {
    slug: "oschina",
    name: "开源中国",
    matches: ["*://my.oschina.net/*"],
    newArticleUrlPattern: /^https:\/\/my\.oschina\.net\/(u\/\d+\/)?blog\/(write|ai-write)/,
    publisherScript: "content-scripts/publishers/oschina.js",
    editor: {
      editor_type: "markdown",
      title_selector: "input[placeholder*=\"标题\"]",
      content_selector: "textarea",
    },
    loginCheck: {
      check_url: "https://my.oschina.net",
      login_cookie: "oscid",
      verify: {
        url: "https://apiv1.oschina.net/oschinapi/user/myDetails",
        headers: { Referer: "https://my.oschina.net/" },
        success_path: "success",
        success_value: true,
      },
    },
  },
  {
    slug: "infoq",
    name: "InfoQ",
    matches: ["*://xie.infoq.cn/*"],
    newArticleUrlPattern: /^https:\/\/xie\.infoq\.cn\/(article\/publish|draft\/)/,
    publisherScript: "content-scripts/publishers/infoq.js",
    editor: {
      editor_type: "richtext",
      title_selector: ".draft-title",
      content_selector: ".DraftEditor-root, .ProseMirror, [contenteditable=true]",
    },
    loginCheck: {
      check_url: "https://xie.infoq.cn",
      login_cookie: "GCID",
      // account.infoq.cn/serv/v1/user/auth 对扩展 origin 返回 451，改用写作社区自身接口。
      verify: {
        url: "https://xie.infoq.cn/public/v1/user/get_user",
        method: "POST",
        success_path: "data.uid",
      },
    },
  },
  {
    slug: "bilibili",
    name: "哔哩哔哩",
    matches: ["*://member.bilibili.com/*"],
    newArticleUrlPattern: /^https:\/\/member\.bilibili\.com\/(read\/editor|platform\/upload\/text\/(new-)?edit)/,
    publisherScript: "content-scripts/publishers/bilibili.js",
    editor: {
      editor_type: "prosemirror",
      title_selector: "textarea.title-input__inner",
      content_selector: ".tiptap.ProseMirror, .eva3-editor, [contenteditable=\"true\"]",
    },
    loginCheck: {
      check_url: "https://member.bilibili.com",
      login_cookie: "SESSDATA",
      verify: {
        url: "https://api.bilibili.com/x/web-interface/nav",
        success_path: "data.isLogin",
        success_value: true,
      },
    },
  },
]);
