# AGENTS.md — Omnipub

## 项目简介

**Omnipub** — 一键将 Markdown 文章发布到 12 个技术博客平台的工具。

三个子系统：
- `app/` — FastAPI 后端（Python）
- `frontend/` — Vue 3 前端
- `extension/` — Chrome 扩展（MV3）

---

## 架构概览

```
omnipub/
├── app/                    # FastAPI 后端
│   ├── api/                # 路由层
│   │   ├── articles.py     # 文章 CRUD（POST 支持 API Key 认证）
│   │   ├── auth.py         # 注册/登录/Chrome session
│   │   ├── platforms.py    # 平台列表/配置更新
│   │   ├── publications.py # 发布记录/结果上报
│   │   ├── ext.py          # 扩展专用接口（auth/me, stats）
│   │   ├── api_keys.py     # API Key CRUD（创建/列表/重新生成/删除）
│   │   ├── user_account.py # 用户账户（修改密码）
│   │   ├── user_platform_configs.py  # 用户per-platform发布预设
│   │   ├── deps.py         # 认证依赖（JWT + API Key 双轨认证、require_scope()、require_jwt()）
│   │   └── response.py     # 统一响应格式 ok()/fail()
│   ├── models/             # SQLAlchemy ORM 模型
│   │   ├── user.py         # User
│   │   ├── article.py      # Article（含 ArticleStatus 枚举）
│   │   ├── platform.py     # Platform（含 PlatformStatus 枚举）
│   │   ├── publication.py  # Publication（含 PublicationStatus 枚举 + CaseInsensitiveEnum TypeDecorator）
│   │   ├── publication_stats.py  # PublicationStats（快照表）
│   │   ├── api_key.py      # ApiKey（HMAC-SHA256 哈希存储、scope 权限、过期时间）
│   │   └── user_platform_config.py  # UserPlatformConfig（用户发布预设）
│   ├── schemas/            # Pydantic 请求/响应 schema（含 api_key.py、ChangePasswordRequest）
│   ├── services/           # 业务逻辑层
│   ├── utils/              # 工具函数（security/markdown）
│   ├── config.py           # 环境变量配置（pydantic-settings）
│   ├── database.py         # 数据库引擎 & session
│   └── main.py             # FastAPI app 入口 + lifespan（自动 seed 12 个平台）
│
├── frontend/               # Vue 3 + Vite + Tailwind + Pinia
│   ├── src/
│   │   ├── views/          # 页面组件（8 个，含 UserSettings）
│   │   ├── components/     # 公共组件（12 个，含 ChangePassword/ApiKeyManager/ApiKeyModal/UserSettingsTabs）
│   │   ├── stores/         # Pinia stores（4 个）
│   │   ├── composables/    # 组合式函数
│   │   │   ├── usePublish.js    # 发布事件桥接（Vue ↔ 扩展）
│   │   │   └── useExtension.js  # 扩展安装检测（单例）
│   │   ├── api/            # axios 封装（/api 前缀，自动注入 Bearer token）+ apiKeys.js + user.js
│   │   └── router/         # Vue Router（需登录的路由有 meta.requiresAuth）
│   ├── e2e/                # Playwright E2E 测试 + 工作流录制器
│   ├── tests/              # Vitest 单元测试（25 个）
│   └── playwright.config.ts
│
├── extension/              # Chrome Extension MV3
│   ├── manifest.json       # MV3 清单（host_permissions: <all_urls>，支持动态 content script 注册）
│   ├── background/
│   │   └── service-worker.js  # 配置缓存、JWT 管理、发布编排、消息路由、动态 content script 注册
│   ├── content-scripts/
│   │   ├── main-world-bridge.js  # MAIN world：CustomEvent → postMessage 桥接
│   │   ├── page-bridge.js        # Isolated world：cookie 登录检测、进度转发
│   │   ├── success-detector.js   # URL 模式匹配 + DOM 变更检测发布成功
│   │   ├── common/
│   │   │   ├── base-publisher.js  # BasePublisher 基类 + FILL_AND_PUBLISH handler
│   │   │   ├── bridge.js          # MessageBridge 工具类（CS ↔ SW 通信）
│   │   │   ├── editor-adapters.js # 编辑器适配器工厂（markdown/richtext/etc）
│   │   │   └── overlay.js         # 发布进度覆盖层 UI
│   │   └── publishers/     # 12 个平台 publisher（继承 BasePublisher）
│   ├── config/platforms.js  # 平台配置（slug/name/URL 规则）
│   └── popup/              # 扩展弹窗 UI
│
├── tests/                  # 后端 pytest 测试（12 个测试文件 + 6 个 unit 测试）
├── alembic/                # 数据库迁移
├── docker-compose.yml      # 生产配置（拉 ghcr.io 镜像）
├── docker-compose.override.yml  # 本地开发覆盖（本地 build）
├── Dockerfile              # 后端镜像
├── frontend/Dockerfile     # 前端 nginx 镜像
├── pack-extension.sh       # 打包扩展为 .zip
└── DEPLOY.md               # 部署指南
```

---

## 开发环境

### 快速启动（推荐）

```bash
docker compose up -d
# 前端: http://localhost:3000
# 后端: http://localhost:8000
# API 文档: http://localhost:8000/docs
```

`docker-compose.override.yml` 自动覆盖为本地 build 模式，无需 `-f` 参数。

### 后端单独运行

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### 前端单独运行

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

前端 dev server 会把 `/api/` 代理到 `http://localhost:8000`（见 `vite.config.js`）。

---

## 测试

### 后端测试

```bash
pytest tests/ -v
pytest tests/ --cov=app --cov-report=term-missing
```

- 测试用 SQLite 内存数据库，无需启动后端服务
- `asyncio_mode = "auto"`，所有 async test 自动支持
- 12 个测试文件：`test_auth`, `test_articles`, `test_platforms`, `test_publications`, `test_ext`, `test_e2e`, `test_api_keys`, `test_api_key_auth`, `test_user_account`, `test_user_platform_configs`, `test_auth_race`, `test_health`
- 6 个 unit 测试：`unit/test_api_key_schema`, `unit/test_case_insensitive_enum`, `unit/test_markdown`, `unit/test_response`, `unit/test_schemas`, `unit/test_security`

### 前端 Vitest 单元测试

```bash
cd frontend
npx vitest run
```

- 25 个测试文件，覆盖 views / components / stores / composables / api 层
- 使用 `@vue/test-utils` + `vitest`，mock axios 和 router

### 扩展 Vitest 单元测试

```bash
cd extension
npx vitest run
```

- 69 个测试，覆盖 service-worker（配置缓存、JWT 管理、发布编排、动态 content script 注册）、content scripts、平台 publishers
- 使用 `extension/tests/setup.js` 中的 Chrome API mock（`chrome.runtime`, `chrome.tabs`, `chrome.cookies`, `chrome.scripting`, `chrome.storage`）

### 前端 Playwright E2E

```bash
# 需要 Docker Compose 服务在跑
docker compose up -d

cd frontend
npx playwright test           # 跑全部
npx playwright test --ui      # 交互模式
```

9 个 spec 文件：

| 文件 | 内容 | 要求 |
|---|---|---|
| `auth.spec.ts` | 注册、登录、登出、错误处理（6 个 test） | 标准 Playwright |
| `articles.spec.ts` | 文章创建、列表、删除（4 个 test） | 标准 Playwright |
| `publish.spec.ts` | Dashboard/发布页/设置页布局（5 个 test） | 标准 Playwright |
| `settings.spec.ts` | 平台启用切换（4 个 test） | 标准 Playwright |
| `user-settings.spec.ts` | 用户设置：修改密码/API 密钥管理（11 个 test） | 标准 Playwright |
| `extension-login.spec.ts` | 扩展加载、page-bridge、登录检测（6 个 test） | 真实 Chromium + 扩展 |
| `extension-full-e2e.spec.ts` | 完整登录检测 + 发布链路（3 个 serial test） | 持久化 Chromium profile |
| `real-world-publish.spec.ts` | 真实发布全链路（1 个 test，120s 超时） | 持久化 Chromium profile |
| `test-profile.spec.ts` | 持久化 profile 基础验证（1 个 test） | 持久化 Chromium profile |

**测试约定：**
- 每个测试用独立 browser context（localStorage 隔离）
- 用户名/邮箱必须用 `uniqueUsername()` / `uniqueEmail()` 生成，避免跨次运行冲突
- Dialog（confirm）用 `page.on("dialog")` 拦截，不用 `once()`
- 扩展测试需要 `extension-fixtures.ts` 提供的 `context`、`extensionId`、`persistentTest` fixtures

### 工作流录制器（Workflow Recorder）

`frontend/e2e/inspect-publish-dom.ts` — 对 11 个平台（除 itpub）的发布流程进行端到端录制和验证。

```bash
# 需要 Docker Compose 服务在跑 + 持久化 Chrome profile 已登录各平台
cd frontend

# 运行所有平台
ARTICLE_ID=70 npx tsx e2e/inspect-publish-dom.ts

# 运行单个平台
PLATFORM=oschina ARTICLE_ID=70 npx tsx e2e/inspect-publish-dom.ts
```

**测试 Profile**：`~/.omnipub-test-profile/`
- 使用 `channel: "chromium"`（Playwright 的 Chrome for Testing）
- 扩展从 `extension/` 目录加载
- 运行前需清除锁文件：`rm -f ~/.omnipub-test-profile/Singleton*`
- 输出到 `/tmp/omnipub-workflow/`：截图 + JSON workflow 记录

**辅助脚本**：
- `frontend/e2e/launch-chromium.ts` — 启动持久化 profile 浏览器（用于手动登录各平台）
- `frontend/e2e/session-health.ts` — 检查各平台 cookie 登录状态

### 浏览器测试方案（Architecture B — AI Agent 推荐）

Omnipub 使用 **browser-testing skill 的 Architecture B**（手动启动 Chrome + Dual CDP）进行扩展测试和调试。

**为什么选 Architecture B**：
- 固定 CDP 端口 `9222`，Playwright 和 Chrome DevTools MCP 可同时连接
- 持久化 Profile 保留各平台登录状态，无需每次手动登录
- 扩展从 `extension/` 目录热加载，修改后刷新即生效
- 浏览器独立运行，MCP 服务器可随时热插拔

#### Step 1：启动 Chrome for Testing

```bash
# 1. 清除锁文件（如果上次异常退出）
rm -f ~/.omnipub-test-profile/Singleton*

# 2. 启动 Chrome for Testing，带远程调试端口 + 扩展 + 持久化 profile
"/Users/addo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.omnipub-test-profile" \
  --disable-extensions-except="/Users/addo/Workspaces/private_w/omnipub/extension" \
  --load-extension="/Users/addo/Workspaces/private_w/omnipub/extension" \
  --no-first-run \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  "http://localhost:3000" &

# 3. 验证调试端口可用
curl -s http://localhost:9222/json/version | python3 -m json.tool
```

#### Step 2：连接 MCP 服务器（Dual CDP）

两个 MCP 服务器连接同一个浏览器实例，提供互补能力：

| MCP 服务器 | 用途 | 连接方式 |
|---|---|---|
| **Playwright MCP** | 页面导航、元素交互、表单填充、截图 | `--cdp-endpoint http://127.0.0.1:9222` |
| **Chrome DevTools MCP** | 控制台日志、网络请求监控、DOM 快照、性能分析 | `CDP_ENDPOINT=http://127.0.0.1:9222` |

MCP 服务器配置：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-playwright@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:9222"]
    }
  }
}
```

#### Step 3：编程式连接（E2E 测试脚本）

E2E 测试脚本通过 `connectOverCDP` 连接已运行的浏览器：

```typescript
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0]; // 获取默认上下文（含扩展、cookie）
const page = await context.newPage();

// ... 执行测试 ...

await page.close();
await browser.close(); // 仅断开连接，不关闭浏览器
```

**关键点**：
- `browser.contexts()[0]` 获取持久化 profile 的默认上下文，cookie 和扩展都在里面
- `browser.close()` 只断开 Playwright 连接，**不会关闭 Chrome**
- 不要用 `context.close()`，否则会清空 cookie 数据库

#### 关键注意事项

- **远程调试端口 `9222`** 允许 Playwright 和 DevTools MCP 同时连接
- **Chrome for Testing 路径**来自 Playwright 安装：`~/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/`
- **持久化 Profile** `~/.omnipub-test-profile/` 与 `launch-chromium.ts` 共用，登录状态互通
- **Playwright chromium 版本升级**后需更新路径中的版本号（`chromium-1208`）
- **修改扩展 service-worker.js 后**必须清除缓存：`rm -rf ~/.omnipub-test-profile/"Service Worker"/ ~/.omnipub-test-profile/"Local Extension Settings"/`
- **两个 MCP 服务器共享浏览器状态**，同一时间只能有一个在操作页面，避免互相干扰
- **Headless 模式不加载扩展** — 必须 `headless: false`（Architecture B 默认满足）

### 作者平台主页

用于查看已发布文章、验证发布结果、抓取统计数据等。

| 平台 | slug | 主页 URL | 访问方式 |
|---|---|---|---|
| 掘金 | juejin | https://juejin.cn/user/3685218709146583 | 直接访问，无需登录即可查看文章列表 |
| CSDN | csdn | https://blog.csdn.net/hanfengzxh | 直接访问 |
| 知乎 | zhihu | https://www.zhihu.com/people/addo-zhang | 浏览器直接访问；程序化访问会被 403 拦截，需通过搜索引擎 `site:zhihu.com addo-zhang` 或使用带 cookie 的浏览器（如持久化 Chrome Profile）访问 |
| 博客园 | cnblogs | https://www.cnblogs.com/addozhang | 直接访问 |
| 51CTO | 51cto | https://blog.51cto.com/addozhang | 直接访问 |
| 思否 | segmentfault | https://segmentfault.com/blog/addozhang | 直接访问 |
| InfoQ | infoq | https://www.infoq.cn/profile/E0ABE2A304C998/publish | 直接访问 |
| 今日头条 | toutiao | — | 头条号后台，需登录 |
| 哔哩哔哩 | bilibili | — | B站专栏后台，需登录 |
| 开源中国 | oschina | — | 需登录 |
| 腾讯云 | tencent-cloud | — | 需登录 |

### 平台 Publisher 验证状态（2026-03）

| 平台 | slug | Publisher | 编辑器类型 | 验证状态 | 特殊处理 |
|---|---|---|---|---|---|
| 掘金 | juejin | ✅ | ByteMD (CodeMirror) | 已验证 | 两步发布：点击"发布"→ 设置面板选分类/标签 → 点击"确定并发布"；图片自动转存到掘金 CDN；分类和标签必填 |
| CSDN | csdn | ✅ | CKEditor 4 iframe | 已验证 | `CKEDITOR.instances[].setData()`；一步发布（设置项在编辑器下方滚动区域）；标签必填 |
| 知乎 | zhihu | ✅ | contenteditable | 已验证 | — |
| 博客园 | cnblogs | ✅ | TinyMCE | 已验证 | — |
| 今日头条 | toutiao | ✅ | ProseMirror | 已验证 | 两步 API 发布 + 弹窗关闭 |
| 51CTO | 51cto | ✅ | markdown textarea | 已验证 | — |
| 思否 | segmentfault | ✅ | markdown textarea | 已验证 | — |
| 哔哩哔哩 | bilibili | ✅ | TipTap/ProseMirror (iframe) | 已验证 | 编辑器在 iframe (`york/read-editor`) 内；`all_frames: true`；剥离外部 `<img>` 标签；一步发布 |
| 开源中国 | oschina | ✅ | Markdown textarea（Ant Tabs 切换） | 已验证 | 重定向 + 向导关闭 + Markdown 模式 API 发布 |
| InfoQ | infoq | ✅ | ProseMirror | 已验证 | 需创建草稿 + 弹窗关闭 |
| 腾讯云 | tencent-cloud | ✅ | markdown textarea | 未验证 | Session 容易过期 |
| ITPUB | itpub | ✅ | Layui 富文本 | 跳过 | 网站无法访问；Publisher 已实现（UEditor bridge + Layui form） |

### 跑完所有测试

```bash
# 后端
pytest tests/ -q

# 前端 Vitest 单元测试
cd frontend && npx vitest run

# 扩展 Vitest 单元测试
cd extension && npx vitest run

# 前端 E2E（确保 docker compose up -d 已跑）
cd frontend && npx playwright test --reporter=line
```

---

## API 完整端点列表

### Auth（`/api/auth`）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/auth/register` | 注册，返回 JWT + user | 无 |
| POST | `/api/auth/login` | 登录，返回 JWT + user | 无 |
| POST | `/api/auth/create-chrome-session` | 创建扩展长期 JWT | 需登录 |

### Articles（`/api/articles`）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/articles` | 文章列表（skip/limit 分页） | 需登录 |
| POST | `/api/articles` | 创建文章 | 需登录 |
| GET | `/api/articles/{id}` | 获取文章详情 | 需登录 |
| PUT | `/api/articles/{id}` | 更新文章 | 需登录 |
| DELETE | `/api/articles/{id}` | 删除文章 | 需登录 |

### Platforms
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/platforms` | 平台列表（5 字段：id/name/slug/icon_url/new_article_url/article_url_pattern/status） | 需登录 |

### Publications
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/articles/{id}/publish` | 创建发布记录（pending） | 需登录 |
| POST | `/api/articles/report-publish-result` | 扩展上报发布结果 | 需登录 |
| GET | `/api/articles/{id}/publications` | 查看发布记录（含统计、platform_slug、platform_icon_url） | 需登录 |

### Extension（`/api/ext`）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/ext/auth/me` | 验证扩展 JWT session | 需登录 |
| PUT | `/api/ext/publications/{id}/stats` | 上报阅读/点赞/评论数 | 需登录 |

### User Platform Configs
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/user/platform-configs` | 获取所有平台发布预设 | 需登录 |
| GET | `/api/user/platform-configs/{slug}` | 获取单个平台发布预设 | 需登录 |
| PUT | `/api/user/platform-configs/{slug}` | 创建/更新发布预设 | 需登录 |

### API Keys（`/api/api-keys`）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/api-keys` | 创建 API Key（返回明文，仅此一次） | 需登录（JWT） |
| GET | `/api/api-keys` | 列出当前用户的 API Keys | 需登录（JWT） |
| PUT | `/api/api-keys/{id}/regenerate` | 重新生成 API Key | 需登录（JWT） |
| DELETE | `/api/api-keys/{id}` | 删除 API Key | 需登录（JWT） |

### User Account（`/api/user`）
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| PUT | `/api/user/password` | 修改密码 | 需登录（JWT） |

### 通用
| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | 无 |
| GET | `/api/extension/version` | 扩展期望版本号 | 无 |

---

## 关键约定

### API 响应格式

所有接口统一返回：
```json
{ "success": true, "data": {...}, "message": "ok" }
```

错误时：
```json
{ "success": false, "data": null, "message": "错误原因" }
```

前端 axios interceptor（`frontend/src/api/index.js`）自动 unwrap `res.data`，因此 API 调用直接返回 `{ success, data, message }` 对象。

### 字段名

- 文章内容字段：`markdown_content`（不是 `content`）
- 文章列表：`resp.data` 直接是数组（不是 `{"items": [...]}` ）
- 发布状态枚举（`PublicationStatus`）：`pending` / `published` / `failed`
- 扩展上报时用 `"success"` → 后端映射为 `"published"`

### 认证

- JWT Bearer token，存在 `localStorage("token")`
- API Key 双轨认证：`deps.py` 中 `get_current_user()` 同时支持 JWT Bearer 和 `X-API-Key` header
- `require_scope("articles:create")` 限制 API Key 可访问的端点范围
- `require_jwt()` 强制仅 JWT 认证（API Key 管理等敏感端点）
- 401 interceptor 在 `frontend/src/api/index.js`，**登录页不触发重定向**（避免清除错误状态）
- 登录时自动通过 `omnipub:set-token` CustomEvent 同步 token 到扩展 service worker
- 扩展长期 session 通过 `/api/auth/create-chrome-session` 获取（独立过期时间）

### 平台数据

- 12 个平台在 `app/main.py` 的 `SEED_PLATFORMS` 里维护
- 每次 `docker compose up` 自动 seed（幂等：只在表空时插入）
- **修改 SEED_PLATFORMS 后**需要手动更新已有数据库（seed 不会覆盖现有数据）
- `extension/config/platforms.js` 里的 slug 必须与后端 `Platform.slug` 保持一致

### Chrome 扩展

- MV3 架构，所有平台配置（editor/loginCheck/stats）硬编码在 `extension/config/platforms.js`，service worker 通过 `importScripts` 加载并暴露为 `globalThis.PLATFORM_CONFIGS`
- 打包：`bash pack-extension.sh` → `dist/omnipub-extension-v*.zip`
- 本地调试：`chrome://extensions/` → 加载已解压 → 选 `extension/` 目录

---

## Chrome 扩展架构

### Content Script 加载规则

| 脚本 | 匹配页面 | World | run_at | 注册方式 |
|---|---|---|---|---|
| `main-world-bridge.js` | `localhost:*`（默认）+ 自定义部署地址 | MAIN | document_start | manifest 静态注册 + `registerBridgeScripts()` 动态注册 |
| `page-bridge.js` | `localhost:*`（默认）+ 自定义部署地址 | isolated | document_start | manifest 静态注册 + `registerBridgeScripts()` 动态注册 |
| `base-publisher.js` + 平台 publisher | 各平台编辑器 URL（12 个） | isolated | document_idle | manifest 静态注册 |

**动态注册**：`service-worker.js` 中的 `registerBridgeScripts(apiBase)` 在 `setApiBase()`、`onInstalled`、`onStartup` 时调用。根据 API_BASE URL 提取 origin，如果不在 `STATIC_BRIDGE_ORIGINS`（localhost 系列）中，则通过 `chrome.scripting.registerContentScripts` 动态注册 bridge scripts 到该 origin。已打开的页面需手动刷新才能生效。

每个平台编辑器页面加载的脚本栈：`editor-adapters.js` → `overlay.js` → `bridge.js` → `base-publisher.js` → `success-detector.js` → `publishers/<slug>.js`

### Service Worker 消息处理

#### `chrome.runtime.onMessage` handlers

| action | 方向 | 说明 |
|---|---|---|
| `getConfig` | CS → SW | 获取单个平台的缓存配置 |
| `getAllConfigs` | — | 已废弃；扩展直接读 `globalThis.PLATFORM_CONFIGS` |
| `refreshConfig` | CS → SW | 强制从后端拉取配置 |
| `getSession` / `saveSession` / `clearSession` | CS → SW | JWT token 管理 |
| `verifySession` | CS → SW | 调用 `GET /api/ext/auth/me` 验证 |
| `reportPublishResult` | CS → SW | 上报发布结果到后端 |
| `reportStats` | CS → SW | 上报统计数据到后端 |
| `getApiBase` | CS → SW | 返回 API 基础 URL |
| `setApiBase` | popup → SW | 保存后端地址 + 触发 `registerBridgeScripts()` 动态注册 |
| `startBackgroundPublish` | page-bridge → SW | 启动后台发布编排 |
| `publishProgress` | CS → SW | 内容脚本进度上报 → 转发到前端 tab |

#### `chrome.runtime.onMessageExternal` handlers

| type | 说明 |
|---|---|
| `OMNIPUB_PING` | 扩展存在性检测，返回 `{ installed, version }` |

### 发布流程（Background Publish）

```
Vue 前端 (ArticlePublish.vue)
  │  usePublish.startPublish() → dispatchEvent("omnipub:start-publish")
  ▼
main-world-bridge.js (MAIN world)
  │  CustomEvent → window.postMessage({ type: "__omnipub_bridge__" })
  ▼
page-bridge.js (isolated world)
  │  handleStartPublish() → chrome.runtime.sendMessage({ action: "startBackgroundPublish" })
  ▼
service-worker.js
  │  startBackgroundPublish(article, platforms, frontendTabId)
  │  ├─ 强制刷新配置缓存
  │  └─ 批量执行（MAX_CONCURRENT = 3）:
  │       openPublishTab() → chrome.tabs.create({ url: new_article_url, active: false })
  │
  │  tabs.onUpdated(status="complete"):
  │  ├─ 等待 500ms
  │  └─ 重试 3 次（间隔 1500ms）:
  │       chrome.tabs.sendMessage(tabId, { action: "FILL_AND_PUBLISH" })
  ▼
base-publisher.js (平台编辑器页面)
  │  FILL_AND_PUBLISH handler:
  │  ├─ waitForPageReady()（轮询编辑器元素，15s 超时）
  │  ├─ beforeFill()     ← 子类可覆盖
  │  ├─ fillTitle()      ← 支持 input/textarea/contenteditable + React 兼容
  │  ├─ fillBody()       ← EditorAdapterFactory 适配不同编辑器
  │  ├─ fillPublishConfig() ← 子类可覆盖（设置标签、分类等）
  │  ├─ afterFill()      ← 子类覆盖，通常点击发布按钮
  │  └─ 立即报告 "success"（在页面跳转前）
  ▼
service-worker.js (forwardProgressToFrontend)
  │  ├─ POST /api/articles/report-publish-result → 后端更新状态
  │  ├─ chrome.tabs.remove(发布 tab)
  │  └─ chrome.tabs.sendMessage(frontendTabId, { action: "PUBLISH_PROGRESS" })
  ▼
page-bridge.js → dispatchEvent("omnipub:publish-progress")
  ▼
Vue 前端 (usePublish.js 监听进度更新 UI)
```

**关键设计决策：**
- afterFill() 后立即报告成功，因为平台发布后常会跳转页面，content script 上下文会被销毁
- 没有覆盖 afterFill() 的 publisher 会自动查找发布按钮（默认选择器列表 + 文本匹配"发布"/"提交"/"Publish"）
- 有自定义 `fill()` 方法的 publisher（如 bilibili）走独立逻辑，不经过标准 fill stages

### 平台特殊发布流程

#### OSCHINA（开源中国）
- **URL 重定向**：`/blog/write` 会重定向到 `/u/{uid}/` 或 `/`，service worker 的 `tabs.onUpdated` 拦截重定向，提取 UID 后导航到 `/u/{uid}/blog/write`
- **UID 提取策略**：(1) 从重定向 URL `/u/{uid}/` 直接提取；(2) 回退到 API `GET /action/apiv2/user/myself`
- **全文写作向导**：编辑器打开后显示 AI 写作向导覆盖层，`beforeFill()` 点击"关闭引导"按钮关闭
- **Markdown 编辑器切换**：编辑器页面有 Ant Tabs（`HTML编辑器` / `Markdown`），`beforeFill()` 点击 `.ant-tabs-tab-btn` 中文本为 "Markdown" 的 tab 切换到 Markdown 模式，ProseMirror 消失、textarea 出现
- **Markdown 模式填充**：切换后直接填充 `textarea`（raw markdown），不经过 ProseMirror 粘贴流程。如果 Markdown tab 未找到则降级回 ProseMirror HTML 模式
- **API 发布**：`POST https://apiv1.oschina.net/oschinapi/blog/web/add`，`contentType: 1`（Markdown）或 `contentType: 0`（HTML 降级），`privacy: true`=公开，`disableComment: false`=允许评论
- **为什么不用 HTML 模式**：ProseMirror HTML 模式发布后，代码块渲染为空/折叠（只显示 hljs 工具栏按钮），且语言识别错误（如 Python → `language-routeros`）。Markdown 模式代码块渲染完全正确

#### InfoQ（极客时间写作平台）
- **草稿创建**：必须先通过 `POST /api/v1/draft/create`（需 cookie 认证）创建草稿，获取 draftId，再导航到 `/draft/{draftId}` 编辑器
- **功能弹窗**：编辑器可能显示"文件导入新功能上线了"等公告弹窗，`beforeFill()` 点击"知道了"按钮关闭（最多 3 次）
- **UI 组件**：使用 GeekBang 自研组件库（`[gk-button]`, `[gkmodal-color]` 属性选择器），非 Ant Design
- **两步发布**：点击发布按钮 → 等待 `.dialog-setting` 确认弹窗（注意：页面上有 16+ 个空 `.modal-container`，必须通过 `.dialog-setting` 类精确定位）→ 点击 `.dialog-footer-buttons [gkbtn-color="green"]` 确认

#### Toutiao（今日头条）
- **两步 API 发布**：(1) 通过 API `POST /api/post/article/save_draft` 保存草稿获取 pgc_id；(2) 通过 API `POST /api/post/article/publish` 发布
- **ProseMirror 粘贴**：使用 clipboard paste 适配器填充内容
- **发布后弹窗**：发布成功后显示推广弹窗，`afterFill()` 自动关闭
- **AI 写作助手抽屉**：编辑器右侧可能弹出 AI 写作助手抽屉遮挡编辑器，CDP fallback 可绕过

#### Bilibili（哔哩哔哩）
- **编辑器重构（2026-03）**：旧 URL `read/editor/#/web` 已废弃，新 URL `platform/upload/text/edit`（重定向到 `new-edit`）
- **iframe 编辑器**：编辑器在 iframe (`member.bilibili.com/york/read-editor?`) 内，manifest.json 需 `all_frames: true`
- **TipTap/ProseMirror**：标题 `textarea.title-input__inner`（maxlength=50），正文 `.tiptap.ProseMirror.eva3-editor`
- **UI 组件库**：从 `bre-*` 改为 `vui_*` 组件（B站自研）
- **一步发布**：点击 `.vui_button.vui_button--blue`（"发布"）直接提交，成功后显示 `.publish-success-dialog` 弹窗
- **发布 API 迁移（2026-04）**：旧 API `POST /x/article/creative/article/submit` → `{ data: { aid } }`；新 API `POST /x/dynamic/feed/create/opus` → `{ data: { dyn_rid } }`。URL 格式不变：`https://www.bilibili.com/read/cv${dyn_rid}`。草稿保存也从 `/x/article/creative/draft/addupdate` 迁移到 `/x/dynamic/feed/article/draft/add`
- **frame check**：content script 注入主页面和 iframe，bilibili.js 通过 URL 检查只在 iframe 中初始化
- **外部图片剥离**：HTML 内容中的外部 `<img>` 标签会静默阻止提交（无报错），`fillBody()` 中自动剥离所有 `<img>` 标签

#### Juejin（掘金）
- **ByteMD 编辑器**：底层 CodeMirror，通过 markdown 适配器填充内容
- **两步发布**：(1) 点击 `.publish-popup .xitu-btn`（"发布"按钮）→ 打开发布设置面板；(2) 选择分类（`.category-list .item`）+ 标签（`.byte-select-option`）→ 点击 `.ui-btn.primary`（"确定并发布"）
- **分类和标签必填**：未选择分类时"确定并发布"按钮不可点击；未添加标签时显示"至少添加一个标签"校验错误
- **图片自动转存**：`beforeFill()` 检测外部图片 URL，批量上传到掘金 CDN（`api.juejin.cn/upload_api/v1/upload`），替换 HTML/Markdown 中的 URL
- **自动兜底**：未配置分类时自动选择第一个可用分类；未配置标签时自动选择第一个可用标签

#### CSDN
- **CKEditor 4 iframe**：内容通过 `CKEDITOR.instances[keys[0]].setData(html)` 填充
- **一步发布**：设置项（标签、分类等）在编辑器下方滚动区域，点击 `button.btn-outline-danger`（"发布博客"）直接提交，成功后重定向到 `/mp_blog/creation/success/{articleId}`
- **标签必填**：`.mark_selection` 区域有预设标签云（`.mark_selection .el_mcm-tag`），点击选择；未选标签时表单项显示 `.is-error`，发布 API 不会被调用

#### ITPUB
- **网站状态**：截至 2026-03，网站无法访问，跳过验证
- **Publisher 已实现**：基于 UEditor bridge + Layui form 的完整 publisher 代码已编写
- **编辑器适配**：Layui 富文本编辑器，通过 UEditor `setContent()` API 填充内容

### 登录检测流程

```
Settings.vue → dispatchEvent("omnipub:check-login", { platforms })
  ▼
main-world-bridge.js → postMessage
  ▼
page-bridge.js handleCheckLogin():
  遍历每个平台:
    chrome.cookies.getAll({ url: login_check_config.check_url })
    ├─ 有 login_cookie 字段 → 检查是否存在该名称的 cookie
    └─ 无 login_cookie → 只要有任意 cookie 就认为已登录
  ▼
  dispatchEvent("omnipub:check-login-result", { results: [{ slug, name, loggedIn }] })
  ▼
Settings.vue 接收结果，逐平台显示登录状态横幅
```

**关键约束：**
- `check_url` 的域名必须与 `manifest.json` 的 `host_permissions` 匹配，否则 `chrome.cookies.getAll` 返回空数组
- Cookie domain 设置为 `.example.com` 的 cookie 可从 `sub.example.com` 读取
- 所有检测通过 cookie API 完成，不发起 HTTP 请求

---

## 前端组件清单

### Views（页面组件）

| 文件 | 路由 | 说明 |
|---|---|---|
| `Login.vue` | `/login` | 登录 + 注册 tab 切换表单 |
| `Dashboard.vue` | `/` | 统计概览 |
| `ArticleList.vue` | `/articles` | 文章列表，支持删除 |
| `ArticleEditor.vue` | `/articles/new`, `/articles/:id/edit` | 创建/编辑文章（Vditor markdown 编辑器） |
| `ArticlePublish.vue` | `/articles/:id/publish` | 平台选择 + 一键发布 + 进度跟踪 |
| `Publications.vue` | `/publications` | 发布历史 |
| `Settings.vue` | `/settings` | 渠道设置 + 登录状态检查 + 每平台发布预设 |
| `UserSettings.vue` | `/user/settings` | 用户设置（Tab 容器：修改密码/API 密钥管理） |

### Components（公共组件）

| 文件 | 说明 |
|---|---|
| `AppLayout.vue` | 根布局（sidebar + 主区域），包裹所有需登录路由 |
| `Sidebar.vue` | 导航侧边栏 |
| `ArticleCard.vue` | 文章列表卡片（含已发布平台图标行，点击跳转对应平台文章） |
| `PlatformCard.vue` | 平台选择磁贴（checkbox、状态徽章） |
| `PlatformConfigModal.vue` | 每平台发布配置弹窗（标签、分类等） |
| `ExtensionBanner.vue` | 扩展未安装/需更新提示横幅 |
| `StatsCard.vue` | Dashboard 统计卡片 |
| `Toast.vue` | 全局 toast 通知 |
| `ChangePassword.vue` | 修改密码表单（旧密码 + 新密码 + 确认密码） |
| `ApiKeyManager.vue` | API 密钥管理列表（创建/重新生成/删除） |
| `ApiKeyModal.vue` | 新建/重新生成 API Key 后的密钥展示弹窗（一次性显示） |
| `UserSettingsTabs.vue` | 用户设置页 Tab 容器（修改密码/API 密钥管理） |

### Pinia Stores

| 文件 | Store | 关键 state / actions |
|---|---|---|
| `auth.js` | `useAuthStore` | `token`, `user`, `login()`, `register()`, `logout()`；登录时同步 token 到扩展 |
| `articles.js` | `useArticlesStore` | `articles[]`, `currentArticle`, CRUD actions |
| `platforms.js` | `usePlatformsStore` | `platforms[]`, `selectedPlatforms` computed（基于 `userPlatformConfigs.isEnabled()`），`togglePlatform()` |
| `userPlatformConfigs.js` | `useUserPlatformConfigsStore` | `configs` dict（slug → publish_config），`loadAll()`, `save()` |

### Composables

| 文件 | 说明 |
|---|---|
| `usePublish.js` | Vue ↔ 扩展发布事件桥接：`startPublish()` 派发 CustomEvent，监听进度更新 `platformStatuses` |
| `useExtension.js` | 扩展安装检测（单例）：ping 检测 + 版本比对，状态值 `checking` → `not-installed` / `installed` / `outdated` |

---

## 修改某块代码前先看

| 要改的 | 先看这里 |
|---|---|
| 新增 API 端点 | `app/api/response.py`（统一响应格式）、`app/api/deps.py`（认证依赖） |
| 新增平台 | `app/main.py` SEED_PLATFORMS + `extension/config/platforms.js` + 新建 `extension/content-scripts/publishers/<slug>.js`（继承 BasePublisher，覆盖 `afterFill()`） + `manifest.json` 添加 host_permissions 和 content_scripts |
| 前端路由 | `frontend/src/router/index.js`（注意 `meta.requiresAuth` 和 `meta.guest`） |
| 修改数据模型 | 同步更新 `app/models/`、`app/schemas/`，并写 alembic migration |
| 修改发布流程 | `extension/content-scripts/common/base-publisher.js`（FILL_AND_PUBLISH handler）+ `extension/background/service-worker.js`（startBackgroundPublish 编排） |
| 修改登录检测 | `extension/content-scripts/page-bridge.js`（handleCheckLogin）+ `app/main.py`（SEED_PLATFORMS 的 login_check_config.check_url 必须与 manifest host_permissions 匹配） |
| 修改扩展通信 | `extension/content-scripts/main-world-bridge.js`（MAIN world 桥接的事件列表）+ `extension/content-scripts/page-bridge.js`（isolated world handler） |
| 环境变量 | `app/config.py`（pydantic-settings，`extra="ignore"` 避免多余字段报错） |
| 用户发布预设 | `app/api/user_platform_configs.py` + `frontend/src/stores/userPlatformConfigs.js` + `frontend/src/components/PlatformConfigModal.vue` |
| 调试发布流程 | `frontend/e2e/inspect-publish-dom.ts`（工作流录制器）+ `frontend/e2e/launch-chromium.ts`（手动登录） |
| OSCHINA 重定向 | `extension/background/service-worker.js`（tabs.onUpdated 里的 OSCHINA 重定向处理） |
| InfoQ 草稿创建 | `extension/background/service-worker.js`（createInfoqDraft 函数）|
| 文章卡片平台图标 | `frontend/src/components/ArticleCard.vue`（publications prop + 图标渲染）+ `frontend/src/views/ArticleList.vue`（并行加载所有文章的发布记录） |
| API Key 管理 | `app/api/api_keys.py`（CRUD）+ `app/api/deps.py`（`require_jwt()`）+ `frontend/src/components/ApiKeyManager.vue` |
| 扩展后端地址配置 | `extension/background/service-worker.js`（`setApiBase` + `registerBridgeScripts`）+ `extension/popup/popup.js` |

---

## CI

GitHub Actions（`.github/workflows/ci.yml`）：
1. `backend-tests` — pytest + coverage（每次 push）
2. `frontend-build` — `npm run build`（每次 push）
3. `frontend-unit-tests` — Vitest 单元测试（每次 push）
4. `e2e-tests` — Docker Compose + Playwright（依赖前三个通过）
5. `extension-build` — ESLint + manifest 校验 + 打包上传 artifact
6. `docker-build` — Docker 镜像构建 + 推送到 `ghcr.io`（仅 push 到 main/master 时推送）

失败时 Playwright report 会上传为 artifact（保留 7 天），扩展包保留 30 天。

---

## 已知陷阱

- **SEED_PLATFORMS 只在表空时插入**：修改 seed 数据后，必须手动 SQL 更新已有数据库或清空 `platforms` 表重启
- **check_url 域名必须匹配 host_permissions**：`chrome.cookies.getAll({ url })` 域名不匹配时静默返回空数组，不报错
- **afterFill() 后立即报告成功**：不能在 afterFill() 后等待页面跳转，因为 content script 上下文会被销毁
- **扩展 service worker 缓存**：修改扩展代码后调试需要清除 `Service Worker/` 和 `Local Extension Settings/` 缓存目录
- **axios interceptor 自动 unwrap**：`frontend/src/api/index.js` 的响应拦截器做了 `res => res.data`，API 调用返回值直接是 `{ success, data, message }` 而非 axios Response 对象
- **OSCHINA /blog/write 重定向**：直接打开 `/blog/write` 会重定向到首页或用户主页，必须通过 service worker 拦截重定向并提取 UID 后导航到 `/u/{uid}/blog/write`
- **OSCHINA 全文写作向导**：2026 年后默认显示 AI 写作向导覆盖层，必须先点击"关闭引导"才能操作编辑器
- **InfoQ 需要先创建草稿**：`/draft/write` 页面的编辑器区域高度为 0（不可用），必须先调用 API 创建草稿获取 draftId
- **InfoQ 功能公告弹窗**：不定期出现新功能公告弹窗，会遮挡编辑器，需要在 `beforeFill()` 中关闭
- **Toutiao 两步 API 发布**：不能直接点击页面上的发布按钮（UI 复杂），通过 API 先保存草稿再发布
- **持久化 Chrome Profile 锁文件**：Playwright 意外退出后会留下 `Singleton*` 锁文件，阻止下次启动，运行前需 `rm -f ~/.omnipub-test-profile/Singleton*`
- **Juejin 分类和标签必填**：掘金发布面板中分类和标签都是必填项。未选择分类时"确定并发布"按钮不可点击（`disabled`）。未添加标签时显示"至少添加一个标签"校验错误。Publisher 已内置自动兜底选择
- **CSDN 一步发布**：设置项在编辑器下方滚动区域（非抽屉/弹窗），`button.btn-outline-danger`（"发布博客"）一次点击直接提交；标签（`.mark_selection .el_mcm-tag`）必填，否则表单校验失败静默阻止提交
- **CSDN API 错误无 DOM 反馈**：`saveArticle` API 返回 400（如"每日发文 5 篇上限"）时页面不显示任何错误提示，`csdn.js` 通过 MAIN world XHR 拦截器 + `postMessage` 回传检测 API 级别错误（`csdn_installSaveInterceptor`）
- **CSDN 每日发文限制**：CSDN 限制每天最多发 5 篇文章，超限后 `saveArticle` 返回 400 但页面无任何提示
- **Bilibili 外部图片静默阻止提交**：HTML 内容中包含外部 `<img>` 标签时，B 站专栏 API 会静默阻止提交（不返回错误），publisher 中已自动剥离所有 `<img>` 标签
- **InfoQ 页面有 16+ 个空 modal 容器**：发布确认弹窗必须通过 `.dialog-setting` 类精确定位，不能用通用的 `.modal-container` 选择器
- **Toutiao AI 写作助手抽屉**：编辑器右侧可能弹出 AI 写作助手抽屉遮挡编辑器和发布按钮，使用 CDP fallback 可绕过
- **Publication status 大小写不一致**：数据库中同时存在 `"PUBLISHED"` 和 `"published"`（扩展上报大写，工作流录制器写小写），前端过滤时需做大小写不敏感比较
- **OSCHINA ProseMirror innerHTML 清空破坏编辑器**：不能用 `editor.innerHTML = ""` 清空后再粘贴——这会破坏 ProseMirror 内部 EditorState，导致后续 paste 事件被静默忽略（content 为空但不报错）。正确做法是 `selectAll` 选中现有内容后再粘贴覆盖（注意：当前 publisher 已切换到 Markdown 模式，此陷阱仅在降级到 ProseMirror 时相关）
- **OSCHINA "是否公开"**：publisher 已改用直接 API 发布（`POST /oschinapi/blog/web/add`），通过 `privacy: true` 参数控制公开（`true`=公开，`false`=私密）。`disableComment: false` 表示允许评论。**注意：API 要求布尔值，不是字符串**。字段名 `privacy` 对应 UI 上的"是否公开"复选框，语义为"是否公开"而非"是否私密"
- **OSCHINA HTML 模式代码块渲染异常**：通过 ProseMirror HTML 模式（`contentType: 0`）发布后，代码块渲染为空/折叠（只显示 hljs 工具栏按钮"自动注释"/"代码解释"/"python"，但无代码内容），且 hljs 语言识别错误（如 Python → `language-routeros`）。已切换到 Markdown 模式（`contentType: 1`）解决
- **动态 content script 注册后必须刷新页面**：通过 `registerBridgeScripts()` 动态注册的 content script 只对后续页面导航生效，已打开的前端页面需要手动刷新才能加载 bridge scripts
- **manifest externally_connectable 不支持 IP 地址**：`externally_connectable.matches` 只支持域名模式（`*.example.com`），不支持 IP 地址和 `<all_urls>`。对 IP 访问场景只能通过 content script 桥接通信
- **host_permissions `<all_urls>` 是动态注册的前提**：`chrome.scripting.registerContentScripts` 需要对目标 URL 有 host_permissions，所以 manifest 必须声明 `<all_urls>`
