import datetime

from typing import Literal

from pydantic import BaseModel, Field


class PublishRequest(BaseModel):
    platform_ids: list[int] = Field(min_length=1, max_length=50)


class PublishResultReport(BaseModel):
    publication_id: int
    platform_article_id: str | None = None
    article_url: str | None = Field(default=None, max_length=2048)
    status: Literal["published", "failed"]


class StatsUpdate(BaseModel):
    view_count: int = Field(default=0, ge=0)
    like_count: int = Field(default=0, ge=0)
    comment_count: int = Field(default=0, ge=0)
    collect_count: int = Field(default=0, ge=0)


class PublicationResponse(BaseModel):
    id: int
    article_id: int
    platform_id: int
    platform_article_id: str | None
    article_url: str | None
    status: str
    published_at: datetime.datetime | None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class PublicationWithStatsResponse(PublicationResponse):
    platform_name: str | None = None
    platform_slug: str | None = None
    platform_icon_url: str | None = None
    latest_stats: StatsUpdate | None = None
