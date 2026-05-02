# Platform Inspector

调查各平台编辑器 DOM 结构的内部工具，用于获取：
- 发布按钮选择器
- 标题/正文编辑器选择器  
- 分类/标签选择器
- 封面图上传选择器
- 登录 Cookie 名称

## 安装

```bash
cd tools/platform-inspector
npm install
npx playwright install chromium
```

## 用法

### 调查单个平台

```bash
node inspect.js juejin
```

脚本会：
1. 打开浏览器窗口
2. 如有已保存的 cookies 则自动加载，否则跳转到登录页等待你手动登录
3. 登录后打开编辑器页面
4. 扫描 DOM 并保存结果到 `results/<slug>.json`

### 支持的平台

```
juejin        掘金
csdn          CSDN
zhihu         知乎
cnblogs       博客园
toutiao       今日头条
tencent-cloud 腾讯云
51cto         51CTO
segmentfault  思否
oschina       开源中国
bilibili      哔哩哔哩
infoq         InfoQ
```

## 输出

- `cookies/<slug>.json` — 登录 cookies（下次可复用）
- `results/<slug>.json` — DOM 扫描结果

## 注意

- `cookies/` 目录已加入 `.gitignore`，不会提交到仓库
- 扫描结果 `results/` 会提交，用于更新平台配置
