# Omnipub

[![CI](https://github.com/addozhang/omnipub/actions/workflows/ci.yml/badge.svg)](https://github.com/addozhang/omnipub/actions/workflows/ci.yml)

一键将 Markdown 文章发布到 11 个技术博客平台的工具。

**三个子系统：**
- 🖥️ **Web 管理端** — 写文章、管理发布记录、配置渠道
- ⚙️ **后端 API** — FastAPI，负责数据存储和业务逻辑
- 🔌 **Chrome 扩展** — 在各平台编辑器里自动填充内容并发布

## 支持平台

掘金 · CSDN · 知乎 · 博客园 · 今日头条 · 腾讯云 · 51CTO · 思否 · 开源中国 · InfoQ · 哔哩哔哩

## 快速启动

Omnipub 由三部分组成，**必须按顺序安装**：先启动服务端，再安装扩展。

### 第一步：启动服务（后端 + 前端）

推荐使用预构建 Docker 镜像：

```bash
# 1. 下载配置文件
curl -O https://raw.githubusercontent.com/addozhang/omnipub/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/addozhang/omnipub/main/.env.example
cp .env.example .env

# 2. 修改 SECRET_KEY（必须）
# vim .env

# 3. 启动
docker compose up -d

# 4. 确认服务正常运行
curl -s http://localhost:3000/api/health
# 应返回 {"success":true,...}
```

服务启动后访问 `http://localhost:3000`（或你的服务器 IP:3000），注册账号并登录。

镜像地址：
- `ghcr.io/addozhang/omnipub/backend:latest`
- `ghcr.io/addozhang/omnipub/frontend:latest`

### 第二步：安装 Chrome 扩展

> **先确认服务已正常运行。** 扩展启动后会通过后端校验登录态，如果服务未启动会报 "Failed to fetch" 错误。

1. 从 [Releases](https://github.com/addozhang/omnipub/releases) 下载最新的 `omnipub-extension-*.zip`
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 将 `.zip` 拖入页面安装（或解压后「加载已解压的扩展程序」）

### 第三步：配置扩展并登录

1. 点击浏览器工具栏的 Omnipub 扩展图标
2. **如果服务不在 localhost:3000**（如远程服务器 `http://150.109.196.70:3000`）：在底部「后端地址」填入实际地址并保存
3. 在前端页面进入「设置」→「API 密钥」，创建 Chrome Session Token
4. 将 Token 粘贴到扩展弹窗中，点击「登录」
5. **如果修改过后端地址，刷新前端页面**确保扩展桥接生效

### 第四步：发布文章

1. 在前端页面创建/编辑一篇 Markdown 文章
2. 进入文章的「发布」页面，选择目标平台
3. 确保已在各平台（掘金、CSDN 等）的浏览器中登录
4. 点击「一键发布」，扩展会自动在后台打开各平台编辑器并填充发布

> 可在「设置」页面检查各平台的登录状态。

### 其他启动方式

<details>
<summary>从源码构建（Docker）</summary>

```bash
git clone https://github.com/addozhang/omnipub.git
cd omnipub
cp .env.example .env

# docker-compose.override.yml 会自动覆盖为本地 build 模式
docker compose up -d --build

# 访问
open http://localhost:3000          # 前端
open http://localhost:8000/docs     # API 文档（开发模式下可直接访问后端）
```

</details>

<details>
<summary>不用 Docker（纯本地开发）</summary>

**后端：**
```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload
# http://localhost:8000
```

**前端：**
```bash
cd frontend
npm install
npm run dev
# http://localhost:5173（自动代理 /api/ 到 localhost:8000）
```

纯本地开发时扩展默认连接 `localhost:3000`，需要在扩展弹窗中将后端地址改为 `http://localhost:5173`。

</details>

### 扩展打包（开发者）

```bash
bash pack-extension.sh
# 输出: dist/omnipub-extension-v1.3.3.zip
```

## 运行测试

```bash
# 后端测试（230 个）
pytest tests/ -v

# 前端单元测试
cd frontend && npx vitest run

# 前端 Playwright E2E（需先启动 Docker Compose）
docker compose up -d
cd frontend && npx playwright test

# 扩展单元测试
cd extension && npx vitest run
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLAlchemy 2.0 (async) · JWT · Pydantic v2 |
| 前端 | Vue 3 · Vite · Tailwind CSS · Pinia · Axios |
| 扩展 | Chrome MV3 · Service Worker · Content Scripts |
| 数据库 | SQLite（开发）· PostgreSQL（生产推荐） |
| 测试 | pytest · httpx · Playwright |
| CI/CD | GitHub Actions · ghcr.io |

## API 概览

| 模块 | 端点 | 说明 |
|---|---|---|
| Auth | `POST /api/auth/register` | 用户注册 |
| Auth | `POST /api/auth/login` | 登录（返回 JWT） |
| Articles | `GET /api/articles` | 文章列表 |
| Articles | `POST /api/articles` | 创建文章（支持 API Key） |
| Articles | `GET/PUT/DELETE /api/articles/{id}` | 文章 CRUD |
| Platforms | `GET /api/platforms` | 平台列表 |
| Platforms | `GET /api/platforms` | 平台列表（id/name/slug/URL/状态） |
| Publications | `POST /api/articles/{id}/publish` | 创建发布记录 |
| Publications | `POST /api/articles/report-publish-result` | 上报发布结果 |
| Publications | `GET /api/articles/{id}/publications` | 查看发布记录 |
| API Keys | `POST /api/api-keys` | 创建 API Key |
| API Keys | `GET /api/api-keys` | 列出 API Keys |
| User | `PUT /api/user/password` | 修改密码 |

完整文档：启动后访问 `http://localhost:8000/docs`

## 部署

见 [DEPLOY.md](./DEPLOY.md)

## License

MIT
