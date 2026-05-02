import datetime

from pydantic import BaseModel


class PlatformResponse(BaseModel):
    id: int
    name: str
    slug: str
    icon_url: str | None
    new_article_url: str
    article_url_pattern: str | None
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}
