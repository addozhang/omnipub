from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import Platform, PlatformStatus


async def get_all_platforms(db: AsyncSession) -> list[Platform]:
    result = await db.execute(
        select(Platform)
        .where(Platform.status != PlatformStatus.HIDDEN)
        .order_by(Platform.name)
    )
    return list(result.scalars().all())


async def get_platform(db: AsyncSession, platform_id: int) -> Platform:
    result = await db.execute(select(Platform).where(Platform.id == platform_id))
    platform = result.scalar_one_or_none()
    if not platform:
        raise HTTPException(status_code=404, detail="Platform not found")
    return platform
