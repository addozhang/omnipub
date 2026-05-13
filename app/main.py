import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from app.api import articles, auth, api_keys, ext, platforms, publications, user_account, user_platform_configs
from app.config import settings
from app.database import async_session, Base, engine
from app.limiter import limiter
from app.models.platform import Platform
import app.models.api_key as api_key_module
import app.models.user_platform_config as user_platform_config_module


SEED_PLATFORMS = [
    {
        "name": "掘金",
        "slug": "juejin",
        "icon_url": "https://lf3-cdn-tos.bytescm.com/obj/static/xitu_juejin_web/img/juejin.7hVrV.png",
        "new_article_url": "https://juejin.cn/editor/drafts/new",
        "article_url_pattern": "https://juejin.cn/post/{article_id}",
    },
    {
        "name": "CSDN",
        "slug": "csdn",
        "icon_url": "https://g.csdnimg.cn/static/logo/favicon32.ico",
        "new_article_url": "https://mp.csdn.net/mp_blog/creation/editor",
        "article_url_pattern": "https://blog.csdn.net/{username}/article/details/{article_id}",
    },
    {
        "name": "知乎",
        "slug": "zhihu",
        "icon_url": "https://static.zhihu.com/heifetz/favicon.ico",
        "new_article_url": "https://zhuanlan.zhihu.com/write",
        "article_url_pattern": "https://zhuanlan.zhihu.com/p/{article_id}",
    },
    {
        "name": "博客园",
        "slug": "cnblogs",
        "icon_url": "https://www.cnblogs.com/favicon.ico",
        "new_article_url": "https://i.cnblogs.com/posts/edit",
        "article_url_pattern": "https://www.cnblogs.com/{username}/p/{article_id}.html",
    },
    {
        "name": "今日头条",
        "slug": "toutiao",
        "icon_url": "https://sf-static.toutiao.com/obj/ttfe/pgcfe/sz/toutiao_logo.png",
        "new_article_url": "https://mp.toutiao.com/profile_v4/graphic/publish",
        "article_url_pattern": "https://www.toutiao.com/article/{article_id}/",
    },
    {
        "name": "腾讯云",
        "slug": "tencent-cloud",
        "icon_url": "https://cloud.tencent.com/favicon.ico",
        "new_article_url": "https://cloud.tencent.com/developer/article/write-new",
        "article_url_pattern": "https://cloud.tencent.com/developer/article/{article_id}",
    },
    {
        "name": "51CTO",
        "slug": "51cto",
        "icon_url": "https://blog.51cto.com/favicon.ico",
        "new_article_url": "https://blog.51cto.com/blogger/publish?old=1&newBloger=2",
        "article_url_pattern": "https://blog.51cto.com/{username}/{article_id}",
    },
    {
        "name": "思否",
        "slug": "segmentfault",
        "icon_url": "https://static.segmentfault.com/main_site_next/0dc4bace/favicon.ico",
        "new_article_url": "https://segmentfault.com/write",
        "article_url_pattern": "https://segmentfault.com/a/{article_id}",
    },
    {
        "name": "开源中国",
        "slug": "oschina",
        "icon_url": "https://www.oschina.net/favicon.ico",
        "new_article_url": "https://my.oschina.net/blog/write",
        "article_url_pattern": "https://my.oschina.net/{username}/blog/{article_id}",
    },
    {
        "name": "InfoQ",
        "slug": "infoq",
        "icon_url": "https://xie.infoq.cn/favicon.ico",
        "new_article_url": "https://xie.infoq.cn/draft/write",
        "article_url_pattern": "https://xie.infoq.cn/article/{article_id}",
    },
    {
        "name": "哔哩哔哩",
        "slug": "bilibili",
        "icon_url": "https://www.bilibili.com/favicon.ico",
        "new_article_url": "https://member.bilibili.com/platform/upload/text/edit",
        "article_url_pattern": "https://www.bilibili.com/read/cv{article_id}",
    },
]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Create tables on startup (dev convenience — use alembic in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        result = await session.execute(select(Platform))
        existing_by_slug = {p.slug: p for p in result.scalars().all()}
        for data in SEED_PLATFORMS:
            existing = existing_by_slug.get(data["slug"])
            if existing:
                for key, value in data.items():
                    if key != "slug":
                        setattr(existing, key, value)
            else:
                session.add(Platform(**data))
        await session.commit()

    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="多平台文章一键发布工具 API",
    version="0.1.0",
    lifespan=lifespan,
)

if not settings.RATE_LIMIT_ENABLED:
    limiter.enabled = False

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(_request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"success": False, "data": None, "message": f"请求过于频繁，请稍后再试 ({exc.detail})"},
    )

_cors_origins = (
    ["*"]
    if settings.CORS_ORIGINS == "*"
    else [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
)
if _cors_origins == ["*"]:
    logger.warning(
        "CORS_ORIGINS is set to '*' (allow all). "
        "Set CORS_ORIGINS to specific origins in production."
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(articles.router)
app.include_router(platforms.router)
app.include_router(publications.router)
app.include_router(ext.router)
app.include_router(user_platform_configs.router)
app.include_router(api_keys.router)
app.include_router(user_account.router)


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    message = str(exc) if settings.DEBUG else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"success": False, "data": None, "message": message},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "data": None, "message": exc.detail},
    )


@app.get("/api/health")
async def health():
    return {"success": True, "data": {"status": "healthy"}, "message": "ok"}


# 扩展期望版本——与 extension/manifest.json 中的 version 字段保持同步
EXTENSION_VERSION = "1.4.2"

_ = api_key_module
_ = user_platform_config_module


@app.get("/api/extension/version")
async def extension_version():
    """返回当前后端期望的 Chrome 扩展版本，前端用于判断是否需要更新。"""
    return {"success": True, "data": {"version": EXTENSION_VERSION}, "message": "ok"}
