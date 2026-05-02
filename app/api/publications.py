import datetime

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

if settings.is_sqlite:
    from sqlalchemy.dialects.sqlite import insert as db_insert
else:
    from sqlalchemy.dialects.postgresql import insert as db_insert

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.article import Article
from app.models.platform import Platform
from app.models.publication import Publication, PublicationStatus
from app.models.publication_stats import PublicationStats
from app.models.user import User
from app.schemas.publication import (
    PublicationResponse,
    PublicationWithStatsResponse,
    PublishRequest,
    PublishResultReport,
    StatsUpdate,
)

router = APIRouter(tags=["publications"])


@router.post("/api/articles/{article_id}/publish")
async def publish_article(
    article_id: int,
    data: PublishRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify article ownership
    result = await db.execute(
        select(Article).where(Article.id == article_id, Article.user_id == user.id)
    )
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    # Verify platforms exist
    result = await db.execute(select(Platform).where(Platform.id.in_(data.platform_ids)))
    platforms = list(result.scalars().all())
    if len(platforms) != len(data.platform_ids):
        raise HTTPException(status_code=400, detail="Some platform IDs are invalid")

    # B-1: Use INSERT OR IGNORE (SQLite) so that concurrent clicks on the same
    # article+platform pair don't create duplicate Publication rows.
    # The unique constraint uq_publication_article_platform enforces this at DB level.
    for platform_id in data.platform_ids:
        stmt = (
            db_insert(Publication)
            .values(
                article_id=article_id,
                platform_id=platform_id,
                status=PublicationStatus.PENDING.name,
            )
            .on_conflict_do_nothing(
                index_elements=["article_id", "platform_id"]
            )
        )
        await db.execute(stmt)

    await db.flush()

    # Fetch the actual rows (existing or just-inserted)
    result = await db.execute(
        select(Publication).where(
            Publication.article_id == article_id,
            Publication.platform_id.in_(data.platform_ids),
        )
    )
    publications = list(result.scalars().all())

    return ok(
        data=[PublicationResponse.model_validate(p).model_dump() for p in publications],
        message="Publication records created",
    )


@router.post("/api/articles/report-publish-result")
async def report_publish_result(
    data: PublishResultReport,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Publication)
        .join(Article)
        .where(
            Publication.id == data.publication_id,
            Article.user_id == _user.id,
        )
    )
    pub = result.scalar_one_or_none()
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")

    # B-4: Prevent status regression — never move PUBLISHED back to failed/pending.
    # Allow: pending → published, pending → failed, failed → published (retry success)
    # Block: published → failed (timeout fires after success), published → pending
    try:
        incoming = PublicationStatus(data.status)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid status: {data.status}")
    if pub.status == PublicationStatus.PUBLISHED and incoming != PublicationStatus.PUBLISHED:
        # Already published, silently ignore any non-published update (e.g., stale timeout)
        return ok(data=PublicationResponse.model_validate(pub).model_dump(), message="Result already recorded")

    pub.status = incoming
    if data.platform_article_id:
        pub.platform_article_id = data.platform_article_id
    if data.article_url:
        pub.article_url = data.article_url
    if incoming == PublicationStatus.PUBLISHED:
        pub.published_at = datetime.datetime.now(datetime.UTC)

    await db.flush()
    await db.refresh(pub)
    return ok(data=PublicationResponse.model_validate(pub).model_dump(), message="Result reported")


@router.get("/api/articles/{article_id}/publications")
async def get_article_publications(
    article_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify article ownership
    result = await db.execute(
        select(Article).where(Article.id == article_id, Article.user_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Article not found")

    items = await _build_publication_responses(db, [article_id])
    return ok(data=items)


@router.get("/api/publications/batch")
async def get_publications_batch(
    article_ids: str = Query(..., description="Comma-separated article IDs"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batch-fetch publications for multiple articles (eliminates N+1 from article list)."""
    try:
        ids = [int(x.strip()) for x in article_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail="article_ids must be comma-separated integers")
    if not ids or len(ids) > 100:
        raise HTTPException(status_code=422, detail="Provide 1–100 article IDs")

    # Verify ownership of all requested articles in one query
    result = await db.execute(
        select(Article.id).where(Article.id.in_(ids), Article.user_id == user.id)
    )
    owned_ids = set(result.scalars().all())
    # Silently ignore IDs that don't belong to this user
    valid_ids = [i for i in ids if i in owned_ids]

    items = await _build_publication_responses(db, valid_ids)
    # Group by article_id for easy frontend consumption
    grouped: dict[int, list[Any]] = {}
    for item in items:
        grouped.setdefault(item["article_id"], []).append(item)
    return ok(data=grouped)


async def _build_publication_responses(
    db: AsyncSession, article_ids: list[int],
) -> list[Any]:
    """Shared helper: build PublicationWithStatsResponse dicts for given article IDs."""
    from sqlalchemy import func as sa_func

    result = await db.execute(
        select(Publication, Platform)
        .join(Platform, Platform.id == Publication.platform_id)
        .where(Publication.article_id.in_(article_ids))
    )
    publication_rows = result.all()
    publication_ids = [pub.id for pub, _platform in publication_rows]

    latest_stats_by_pub: dict[int, PublicationStats] = {}
    if publication_ids:
        latest_ids_subq = (
            select(
                sa_func.max(PublicationStats.id).label("max_id")
            )
            .where(PublicationStats.publication_id.in_(publication_ids))
            .group_by(PublicationStats.publication_id)
            .subquery()
        )
        stats_result = await db.execute(
            select(PublicationStats).where(
                PublicationStats.id == latest_ids_subq.c.max_id
            )
        )
        for stats in stats_result.scalars():
            latest_stats_by_pub[stats.publication_id] = stats

    response_items = []
    for pub, platform in publication_rows:
        latest_stats = latest_stats_by_pub.get(pub.id)
        item = PublicationWithStatsResponse(
            **PublicationResponse.model_validate(pub).model_dump(),
            platform_name=platform.name if platform else None,
            platform_slug=platform.slug if platform else None,
            platform_icon_url=platform.icon_url if platform else None,
            latest_stats=StatsUpdate(
                view_count=latest_stats.view_count,
                like_count=latest_stats.like_count,
                comment_count=latest_stats.comment_count,
                collect_count=latest_stats.collect_count,
            )
            if latest_stats
            else None,
        )
        response_items.append(item.model_dump())

    return response_items
