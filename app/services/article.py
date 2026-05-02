from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article, ArticleStatus
from app.schemas.article import ArticleCreate, ArticleUpdate
from app.utils.markdown import markdown_to_html


async def create_article(db: AsyncSession, user_id: int, data: ArticleCreate) -> Article:
    html_content = markdown_to_html(data.markdown_content)
    article = Article(
        user_id=user_id,
        title=data.title,
        markdown_content=data.markdown_content,
        html_content=html_content,
        category=data.category,
        tags=data.tags,
        summary=data.summary,
    )
    db.add(article)
    await db.flush()
    await db.refresh(article)
    return article


async def get_articles(
    db: AsyncSession, user_id: int, skip: int = 0, limit: int = 20
) -> list[Article]:
    result = await db.execute(
        select(Article)
        .where(Article.user_id == user_id)
        .order_by(Article.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_article(db: AsyncSession, article_id: int, user_id: int) -> Article:
    result = await db.execute(
        select(Article).where(Article.id == article_id, Article.user_id == user_id)
    )
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


async def update_article(
    db: AsyncSession, article_id: int, user_id: int, data: ArticleUpdate
) -> Article:
    article = await get_article(db, article_id, user_id)

    if data.title is not None:
        article.title = data.title
    if data.markdown_content is not None and data.markdown_content != article.markdown_content:
        article.markdown_content = data.markdown_content
        article.html_content = markdown_to_html(data.markdown_content)
    if data.status is not None:
        article.status = ArticleStatus(data.status)
    if data.category is not None:
        article.category = data.category or None
    if data.tags is not None:
        article.tags = data.tags or None
    if data.summary is not None:
        article.summary = data.summary or None

    await db.flush()
    await db.refresh(article)
    return article


async def delete_article(db: AsyncSession, article_id: int, user_id: int) -> None:
    article = await get_article(db, article_id, user_id)
    await db.delete(article)
    await db.flush()
