import datetime

from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list[str]
    is_active: bool
    last_used_at: datetime.datetime | None
    expires_at: datetime.datetime | None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ApiKeyCreatedResponse(ApiKeyResponse):
    """Returned only on create/regenerate — contains the full plaintext key."""
    key: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)
