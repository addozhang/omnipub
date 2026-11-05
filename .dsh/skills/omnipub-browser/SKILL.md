---
name: omnipub-browser
description: 统一管理 Omnipub 项目专用的 Chrome for Testing 测试浏览器：启动（带扩展）、profile 选择与版本约束、保持运行（防进程组回收）、状态检查、安全关闭与故障恢复。凡是涉及为 Omnipub 发布/登录检测/扩展调试启动或操作浏览器（哪怕只是"打开测试浏览器""浏览器怎么挂了""换个 profile"这类提及），必须先用本 skill；它能避免本周实测踩过的全部致命坑（profile 降级崩溃、Playwright 缓存被清、前台进程被回收、CDP 僵尸 target 误诊）。
---

# Omnipub 浏览器运维

为 Omnipub（Chrome 扩展发布工具）操作浏览器时，**不要手写启动命令**——用本 skill 的脚本。每条规则背后都是 2026-11 一周实战中真实付出过代价的坑，跳过任何一条都可能重复事故。

## 快速上手

```bash
SKILL=.dsh/skills/omnipub-browser/scripts

bash $SKILL/launch.sh            # 启动（幂等，已在跑则只报状态）
bash $SKILL/status.sh            # CDP/扩展/页面 状态一览
bash $SKILL/stop.sh              # 安全关闭（有编辑器 tab 时会拦截确认）
bash $SKILL/stop.sh 9222 --force # 跳过检查强制关
```

`launch.sh` 内部用「setsid（若可用）/ 子壳双 fork + nohup」守护化——这是它和手写命令的本质区别（见下"保持运行"）。

## 核心事实（先读这个再动手）

| 项 | 值 | 约束 |
|---|---|---|
| CDP 端口 | `9222` | Playwright MCP / DevTools MCP / 脚本共用 |
| 浏览器 | Playwright 缓存的 **chromium-1208**（CfT 145） | 路径 `~/Library/Caches/ms-playwright/chromium-1208/...` |
| Profile | `~/.omnipub-test-profile` | **与 CfT 版本硬耦合：只能用 ≥ 写入它的版本打开**，降级立刻 SIGTRAP 崩溃 |
| 扩展 | `<repo>/extension` 目录加载 | 改扩展代码后需重载扩展 + 刷新已开页面 |

**为什么必须是 Chrome for Testing**：品牌 Google Chrome 137+ 移除了 `--load-extension`，无法加载未打包扩展。
**为什么必须用 Playwright 缓存的构建**：官方 CfT zip（googlechromelabs 下载）在 macOS 26.6 上所有 http(s) 加载永久挂起（渲染正常、网络死），Playwright 重打包构建无此问题。
**为什么版本耦合是硬约束**：Playwright 缓存与 frontend 项目锁定的 playwright 版本绑定。**任何项目**跑不同版本的 `playwright install` 都会清掉不匹配的构建（实例：2026-11-04 03:48 缓存被重建，1243 消失，profile 从此打不开）。

## 启动

1. `bash $SKILL/launch.sh`（内部流程：幂等检查 → 二进制存在性 → 清 Singleton 锁 → setsid 启动 → 等端口 ≤60s → 验证扩展 target）
2. 首次或怀疑登录丢失时验证：打开的 Omnipub 页面上通过扩展桥接跑 `check-login`（10 平台 loggedIn+verified 为佳）

**保持运行（关键）**：
- launch.sh 以守护化方式启动（Linux 用 `setsid`；macOS 无此命令，用「`( nohup ... & )` 子壳双 fork」等效脱离进程组，已实测跨命令存活）。DSH 前台 bash 命令结束**可能杀掉整个进程组**——普通 `cmd &` 挂的浏览器随命令结束而死（2026-11-05 实测：07:06 浏览器无声消失）；要手写时至少用 `( nohup cmd & )`，稳妥起见直接用 launch.sh
- 不要把浏览器塞进带超时的前台命令；run_in_background 任务也可用但生命周期挂在会话上，launch.sh 的守护化更独立

## 运行中规则（CDP 卫生）

1. **每次操作前重新枚举 `/json/list`**。tab 跨源导航后旧 `webSocketDebuggerUrl` 指向已销毁上下文：症状是 `location.href` 永远 `about:blank`、`localStorage` 抛 SecurityError、`chrome.runtime` undefined——这是僵尸 target，不是页面挂了
2. **websocket 连接加 `suppress_origin=True`**（Python websocket-client），否则 Chrome 拒绝 403
3. **MV3 service worker 会休眠**：找不到 SW target 时先从页面向扩展发 OMNIPUB_PING 唤醒，再连
4. **Omnipub 登录 token**：新 profile/新页面需 `localStorage.setItem('token', ...)` 注入（token 可从 `/tmp/omnipub_token` 或既有页面取）
5. 调试 B 站编辑器时记得：它在同源 iframe 里，不出现在 `/json/list`，要用 `Runtime.executionContextCreated` 找 frame 上下文

## 关闭

`bash $SKILL/stop.sh`：默认先检查是否有发布编辑器 tab（`new-edit`/`article/write`/`graphic/publish`/`blogger/publish`/`/write`/`ai-write`）——有则拦截人工确认，避免掐断进行中的发布。确认无碍加 `--force`。

关闭前自问：**有没有后台任务在 sleep 中等着连这台浏览器？**（长间隔发布重试任务硬编码了端口，浏览器关了任务会静默扑空）

## 故障恢复（按症状索引）

**`launch.sh` 报二进制不存在** → Playwright 缓存被其他项目清了：
```bash
cd /Users/addo/Workspaces/private_w/omnipub/frontend && npx playwright install chromium
```
诊断方法：`stat` 缓存目录时间戳（`~/Library/Caches/ms-playwright/chromium-*`）看何时被重建。

**浏览器启动即退出（SIGTRAP / "Mach rendezvous failed, parent died"）** → profile 降级：现有 profile 由比当前构建更高的 CfT 写入。恢复流程（实测 10 平台登录态全存活）：
1. `mv ~/.omnipub-test-profile ~/.omnipub-test-profile.bak-<版本>`
2. 起一次浏览器（自动建新 profile 结构）→ stop
3. `cp .bak-*/Default/Cookies ~/.omnipub-test-profile/Default/Cookies`（SQLite cookie 库**跨版本兼容**）
4. 重新 launch，用 CDP 注入 token，跑 check-login 验证

**端口起了但页面全挂起/无网络** → 你用了官方 CfT zip。换回 Playwright 缓存构建。

**DevTools 端口永远不监听（进程活着）** → 坏构建（下载不完整）。`npx playwright install --force chromium` 重装。

**僵死 tab（navigate 无响应、evaluate 超时）** → 渲染器冻死。`/json/close/<id>` 关掉，`/json/new?<url>` 重开，**重新枚举 target 再连**。

## 与 AGENTS.md 的关系

AGENTS.md 的「浏览器测试方案（Architecture B）」描述 MCP 双连接的使用面；本 skill 管它的生命周期。两处改动需同步（尤其 chromium 版本号）。
