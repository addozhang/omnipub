from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.article import Article
from app.models.publication import Publication
from app.models.publication_stats import PublicationStats
from app.models.user import User
from app.schemas.publication import StatsUpdate
from app.schemas.user import UserResponse

router = APIRouter(prefix="/api/ext", tags=["chrome-extension"])


@router.get("/auth/me")
async def get_me(user: User = Depends(get_current_user)):
    """Verify Chrome extension session and return current user."""
    return ok(data=UserResponse.model_validate(user).model_dump())


@router.put("/publications/{publication_id}/stats")
async def update_publication_stats(
    publication_id: int,
    data: StatsUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Chrome extension reports publication stats."""
    result = await db.execute(
        select(Publication)
        .join(Publication.article)
        .where(
            Publication.id == publication_id,
            Article.user_id == _user.id,
        )
    )
    pub = result.scalar_one_or_none()
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")

    stats = PublicationStats(
        publication_id=publication_id,
        view_count=data.view_count,
        like_count=data.like_count,
        comment_count=data.comment_count,
        collect_count=data.collect_count,
    )
    db.add(stats)
    await db.flush()
    return ok(message="Stats recorded")
