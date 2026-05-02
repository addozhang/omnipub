import json

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

if settings.is_sqlite:
    from sqlalchemy.dialects.sqlite import insert as db_insert

    _toggle_enabled_expr = text("1 - user_platform_configs.enabled")
else:
    from sqlalchemy.dialects.postgresql import insert as db_insert

    _toggle_enabled_expr = text("NOT user_platform_configs.enabled")

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.user import User
from app.models.user_platform_config import UserPlatformConfig
from app.schemas.user_platform_config import UserPlatformConfigUpsert

router = APIRouter(tags=["user-platform-config"])


def _to_response(cfg: UserPlatformConfig) -> dict:
    return {
        "platform_slug": cfg.platform_slug,
        "publish_config": cfg.publish_config_parsed,
        "enabled": cfg.enabled,
        "updated_at": cfg.updated_at,
    }


@router.get("/api/user/platform-configs")
async def list_user_platform_configs(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all platform publish configs for current user."""
    result = await db.execute(
        select(UserPlatformConfig).where(UserPlatformConfig.user_id == user.id)
    )
    configs = result.scalars().all()
    return ok(data={cfg.platform_slug: _to_response(cfg) for cfg in configs})


@router.get("/api/user/platform-configs/{slug}")
async def get_user_platform_config(
    slug: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get publish config for a specific platform."""
    result = await db.execute(
        select(UserPlatformConfig).where(
            UserPlatformConfig.user_id == user.id,
            UserPlatformConfig.platform_slug == slug,
        )
    )
    cfg = result.scalar_one_or_none()
    if cfg is None:
        return ok(data={"platform_slug": slug, "publish_config": {}, "enabled": False})
    return ok(data=_to_response(cfg))


@router.put("/api/user/platform-configs/{slug}")
async def upsert_user_platform_config(
    slug: str,
    data: UserPlatformConfigUpsert,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update publish config for a specific platform.

    B-3: Uses INSERT … ON CONFLICT DO UPDATE to atomically upsert the row,
    eliminating the SELECT-then-INSERT TOCTOU window.
    """
    enabled_val = data.enabled if data.enabled is not None else False
    publish_config_json = json.dumps(data.publish_config)

    stmt = (
        db_insert(UserPlatformConfig)
        .values(
            user_id=user.id,
            platform_slug=slug,
            publish_config=publish_config_json,
            enabled=enabled_val,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "platform_slug"],
            set_={
                "publish_config": publish_config_json,
                "enabled": enabled_val if data.enabled is not None else UserPlatformConfig.enabled,
                "updated_at": text("CURRENT_TIMESTAMP"),
            },
        )
    )
    await db.execute(stmt)
    await db.flush()

    # Re-fetch the upserted row so we can return it
    result = await db.execute(
        select(UserPlatformConfig).where(
            UserPlatformConfig.user_id == user.id,
            UserPlatformConfig.platform_slug == slug,
        )
    )
    cfg = result.scalar_one()
    return ok(data=_to_response(cfg), message="Config saved")


@router.patch("/api/user/platform-configs/{slug}/toggle")
async def toggle_user_platform_config(
    slug: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Toggle the enabled state for a platform config.

    B-3: Uses INSERT … ON CONFLICT DO UPDATE to atomically create-or-flip.
    The flip is expressed as a single SQL expression (1 - enabled) so it
    reads and writes in one statement — no lost-update window.
    """
    # INSERT new row with enabled=True; if it already exists, flip the flag atomically.
    stmt = (
        db_insert(UserPlatformConfig)
        .values(
            user_id=user.id,
            platform_slug=slug,
            publish_config="{}",
            enabled=True,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "platform_slug"],
            set_={
                "enabled": _toggle_enabled_expr,
                "updated_at": text("CURRENT_TIMESTAMP"),
            },
        )
    )
    await db.execute(stmt)
    await db.flush()

    result = await db.execute(
        select(UserPlatformConfig).where(
            UserPlatformConfig.user_id == user.id,
            UserPlatformConfig.platform_slug == slug,
        )
    )
    cfg = result.scalar_one()
    return ok(data=_to_response(cfg), message="Toggled")
