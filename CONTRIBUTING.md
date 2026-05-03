# Contributing to Omnipub

感谢你对 Omnipub 的兴趣！欢迎各种形式的贡献：bug 报告、新平台支持、文档改进、代码优化。

## 快速开始

1. Fork 本仓库
2. Clone 你的 fork：`git clone https://github.com/<your-username>/omnipub.git`
3. 创建分支：`git checkout -b feat/your-feature`
4. 启动开发环境（见 [README.md](./README.md#其他启动方式)）

## 开发流程

### 后端

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

### 扩展

在 `chrome://extensions/` 加载 `extension/` 目录。

## 测试要求

提交 PR 前请确保所有测试通过：

```bash
# 后端
pytest tests/ -v

# 前端
cd frontend && npx vitest run

# 扩展
cd extension && npx vitest run

# E2E（可选，需 Docker Compose）
cd frontend && npx playwright test
```

## 提交规范

- 使用清晰的提交消息，遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  - `feat:` 新功能
  - `fix:` Bug 修复
  - `docs:` 文档更新
  - `refactor:` 重构（不改变功能）
  - `test:` 测试相关
  - `chore:` 构建/工具相关
- 一个 PR 聚焦一件事，避免大杂烩
- PR 描述里说明：**做了什么**、**为什么这样做**、**如何测试**

## 添加新平台支持

参考现有 publisher（推荐看 `extension/content-scripts/publishers/csdn.js`）：

1. 在 `app/main.py` 的 `SEED_PLATFORMS` 添加平台元数据
2. 在 `extension/config/platforms.js` 添加配置（slug 必须与后端一致）
3. 在 `extension/content-scripts/publishers/` 新建 `<slug>.js`，继承 `BasePublisher`
4. 在 `extension/manifest.json` 添加 `host_permissions` 和 `content_scripts`
5. 写单元测试 + 工作流验证（见 `frontend/e2e/inspect-publish-dom.ts`）

详细架构见 [AGENTS.md](./AGENTS.md)。

## 报告 Bug

请在 [Issues](https://github.com/addozhang/omnipub/issues/new) 提交，包含：

- Omnipub 版本（前端、后端、扩展三个版本号）
- 浏览器版本 + 操作系统
- 复现步骤
- 期望行为 vs 实际行为
- 相关日志（后端日志 / 浏览器 Console / 扩展 Service Worker 日志）

## 行为准则

请保持友善、尊重、专业。我们不接受任何形式的歧视或骚扰。

## License

提交贡献即表示你同意按 [MIT License](./LICENSE) 发布你的代码。
