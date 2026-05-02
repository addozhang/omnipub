import datetime

from pydantic import BaseModel, Field

from app.models.article import ArticleStatus


class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    markdown_content: str = Field(min_length=1, max_length=500_000)
    category: str | None = Field(default=None, max_length=100)
    tags: str | None = Field(default=None, max_length=500)
    summary: str | None = Field(default=None, max_length=50)


class ArticleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    markdown_content: str | None = Field(default=None, min_length=1, max_length=500_000)
    status: ArticleStatus | None = None
    category: str | None = None
    tags: str | None = None
    summary: str | None = Field(default=None, max_length=50)


class ArticleListResponse(BaseModel):
    id: int
    user_id: int
    title: str
    category: str | None = None
    tags: str | None = None
    summary: str | None = None
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}


class ArticleResponse(BaseModel):
    id: int
    user_id: int
    title: str
    markdown_content: str
    html_content: str
    category: str | None = None
    tags: str | None = None
    summary: str | None = None
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}

