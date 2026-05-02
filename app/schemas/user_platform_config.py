import datetime
from typing import Any

from pydantic import BaseModel


class UserPlatformConfigResponse(BaseModel):
    platform_slug: str
    publish_config: dict[str, Any]
    enabled: bool
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}


class UserPlatformConfigUpsert(BaseModel):
    publish_config: dict[str, Any]
    enabled: bool | None = None
