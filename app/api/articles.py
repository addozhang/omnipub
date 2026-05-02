from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_scope
from app.api.response import ok
from app.database import get_db
from app.models.user import User
from app.schemas.article import ArticleCreate, ArticleListResponse, ArticleResponse, ArticleUpdate
from app.services.article import (
    create_article,
    delete_article,
    get_article,
    get_articles,
    update_article,
)

router = APIRouter(prefix="/api/articles", tags=["articles"])


@router.get("")
async def list_articles(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    articles = await get_articles(db, user.id, skip=skip, limit=limit)
    return ok(data=[ArticleListResponse.model_validate(a).model_dump() for a in articles])


@router.post("", dependencies=[Depends(require_scope("articles:create"))])
async def create(
    data: ArticleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await create_article(db, user.id, data)
    return ok(data=ArticleResponse.model_validate(article).model_dump(), message="Article created")


@router.get("/{article_id}")
async def get_one(
    article_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await get_article(db, article_id, user.id)
    return ok(data=ArticleResponse.model_validate(article).model_dump())


@router.put("/{article_id}")
async def update(
    article_id: int,
    data: ArticleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    article = await update_article(db, article_id, user.id, data)
    return ok(data=ArticleResponse.model_validate(article).model_dump(), message="Article updated")


@router.delete("/{article_id}")
async def delete(
    article_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await delete_article(db, article_id, user.id)
    return ok(message="Article deleted")
