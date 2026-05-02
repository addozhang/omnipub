# 真实发布测试（Real-World Testing）

使用专用 Chrome Profile 运行真实发布测试，不影响日常 Chrome 使用。

## 前置条件

1. **Docker Compose 服务运行中**：
   ```bash
   docker compose up -d
   # 确认 http://localhost:3000 可访问
   ```

2. **系统已安装 Google Chrome**（非 Chromium）

3. **扩展源码存在**：默认使用项目根目录下的 `extension/`

## 首次设置

运行设置脚本，打开 Chrome 并手动登录各平台：

```bash
cd frontend
npm run setup:test-profile
```

Chrome 会以专用 Profile 启动并加载 Omnipub 扩展。在打开的标签页中：
1. 登录各平台（掘金、CSDN、知乎等）
2. 确认 Omnipub 扩展已加载
3. 完成后关闭 Chrome 窗口

登录状态会保存在 Profile 目录中，后续测试直接复用。

## 运行测试

```bash
cd frontend

# 运行所有真实发布测试
npm run test:real

# 指定平台（只测试掘金和 CSDN）
ONLY_PLATFORMS=juejin,csdn npm run test:real

# 使用 Playwright 原生命令（更多选项）
npx playwright test --project=real-world --reporter=list
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OMNIPUB_TEST_PROFILE` | `~/.omnipub-test-profile` | Chrome 测试 Profile 目录 |
| `OMNIPUB_EXT_PATH` | `../../extension`（相对于脚本位置） | Omnipub 扩展源码路径 |
| `ONLY_PLATFORMS` | （空，测试所有平台） | 逗号分隔的平台 slug 列表 |
| `PLAYWRIGHT_TEST_BASE_URL` | `http://localhost:3000` | 前端服务地址 |

## 平台 slug 列表

```
juejin, csdn, zhihu, cnblogs, toutiao, tencent-cloud,
51cto, segmentfault, oschina, infoq, bilibili
```

## 工作原理

- 使用 `channel: "chrome"` 启动系统安装的 Google Chrome
- 通过 `chromium.launchPersistentContext` 加载专用 Profile 目录
- Profile 中保存了各平台的登录 cookie，测试时自动复用
- 每个测试可以通过 `requirePlatform("slug")` 检查平台登录状态，未登录则自动跳过
- `ONLY_PLATFORMS` 可以限定只跑指定平台的测试

## 常见问题

### Profile 目录在哪？

默认在 `~/.omnipub-test-profile`。可通过 `OMNIPUB_TEST_PROFILE` 环境变量自定义。

### 登录过期了怎么办？

重新运行 `npm run setup:test-profile`，在 Chrome 中重新登录过期的平台即可。

### 能和原有的 Chromium Profile 测试共存吗？

可以。原有的 `tmp-chromium-profile/`（使用 Playwright Chromium）和新的 `~/.omnipub-test-profile`（使用系统 Chrome）互不影响：
- `npm run test:real-world` — 使用原有 Playwright 设施
- `npm run test:real` — 使用系统 Chrome + 专用 Profile
