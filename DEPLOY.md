# 部署指南

> **安装顺序很重要**：先启动后端 + 前端服务，再安装 Chrome 扩展。扩展启动后会通过后端验证登录态，如果服务未运行会报错。

## 本地开发（Docker Compose）

```bash
# 克隆项目
git clone <repo-url>
cd omnipub

# 复制环境变量
cp .env.example .env
# 编辑 .env，至少修改 SECRET_KEY

# 启动（首次会自动 build）
docker compose up -d

# 访问
open http://localhost:3000

# 查看日志
docker compose logs -f

# 停止（保留数据）
docker compose down

# 停止并清除数据库
docker compose down -v
```

## 生产部署

### 前置条件

- Docker & Docker Compose v2
- 域名（用于 HTTPS）
- PostgreSQL（推荐）或保留 SQLite（小流量可用）

### 1. 环境变量配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 必须修改
SECRET_KEY=<随机 64 位字符串>
# openssl rand -hex 32

# 生产用 PostgreSQL
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/omnipub

# 可选
DEBUG=false
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

### 2. 生产 Docker Compose

创建 `docker-compose.prod.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: omnipub
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: omnipub
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    build: .
    environment:
      DATABASE_URL: postgresql+asyncpg://omnipub:${DB_PASSWORD}@postgres:5432/omnipub
      SECRET_KEY: ${SECRET_KEY}
      DEBUG: "false"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-prod.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - backend
    restart: unless-stopped

volumes:
  postgres_data:
```

### 3. HTTPS（Let's Encrypt）

```bash
# 安装 certbot
apt install certbot

# 申请证书
certbot certonly --standalone -d your-domain.com

# nginx-prod.conf 参考
cat > nginx-prod.conf << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

### 4. 启动生产服务

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 5. 数据库迁移（生产）

```bash
# 进入 backend 容器跑 alembic
docker compose exec backend alembic upgrade head
```

---

## Chrome 扩展部署

> **前置条件**：后端和前端服务必须已经启动并可访问。扩展启动时会向后端验证登录态，服务未运行会导致 "Failed to fetch" 错误。

### 打包

```bash
bash pack-extension.sh
# 输出: dist/omnipub-extension-v1.3.3.zip
```

### 安装

1. 从 [Releases](https://github.com/addozhang/omnipub/releases) 下载最新的 `omnipub-extension-*.zip`
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 将 `.zip` 拖入页面安装；或解压后点击「加载已解压的扩展程序」选择 `extension/` 目录

### 配置后端地址

扩展默认连接 `http://localhost:3000`。如果部署在其他地址（如远程服务器 IP、自定义域名或非默认端口），需要配置：

1. 点击浏览器工具栏的 Omnipub 扩展图标，打开弹窗
2. 在底部「后端地址」处填入实际地址，例如 `http://150.109.196.70:3000`
3. 点击「保存」
4. **刷新前端页面**（保存后端地址后必须刷新，content script 才会注入新页面）
5. 在前端页面获取 Session Token，粘贴到扩展弹窗中登录

> **注意**：后端地址指的是前端页面的访问地址（前端 nginx 会代理 `/api/` 到后端），不是后端 8000 端口的直接地址。例如使用 Docker Compose 默认配置时，填 `http://your-server:3000` 而非 `http://your-server:8000`。

### 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 扩展弹窗报 "Failed to fetch" | 服务未启动，或后端地址配置错误 | 先确认服务正常运行（`curl http://地址/api/health`），再检查扩展中的后端地址 |
| 前端页面显示「扩展未安装」 | 后端地址改后没有刷新页面 | 保存后端地址后刷新前端页面 |
| 登录成功但「设置」页检测不到平台登录状态 | content script 未注入（后端地址未配置或页面未刷新） | 确认扩展后端地址正确，刷新前端页面 |
| 发布时扩展无反应 | 同上，content script 桥接未生效 | 同上 |
| 纯本地开发用 `npm run dev`（端口 5173） | 扩展默认连 3000 | 在扩展中将后端地址改为 `http://localhost:5173` |

---

## 监控与维护

```bash
# 查看服务状态
docker compose ps

# 查看后端日志
docker compose logs backend --tail=100 -f

# 备份 SQLite 数据库
docker compose exec backend cp /app/data/omnipub.db /app/data/backup_$(date +%Y%m%d).db

# 备份 PostgreSQL
docker compose exec postgres pg_dump -U omnipub omnipub > backup_$(date +%Y%m%d).sql
```
