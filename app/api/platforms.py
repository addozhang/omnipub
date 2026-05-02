from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.user import User
from app.services.platform import get_all_platforms

router = APIRouter(tags=["platforms"])


def _platform_to_response(p) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "slug": p.slug,
        "icon_url": p.icon_url,
        "new_article_url": p.new_article_url,
        "article_url_pattern": p.article_url_pattern,
        "status": p.status.value if hasattr(p.status, "value") else p.status,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


@router.get("/api/platforms")
async def list_platforms(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    platforms = await get_all_platforms(db)
    return ok(data=[_platform_to_response(p) for p in platforms])
