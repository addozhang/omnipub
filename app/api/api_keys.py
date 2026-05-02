import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.response import ok
from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreatedResponse, ApiKeyResponse
from app.utils.security import hash_password, verify_password

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])

API_KEY_PREFIX = "omnk_"
DEFAULT_SCOPES = ["articles:create"]


def _generate_key() -> tuple[str, str, str]:
    random_part = secrets.token_hex(24)
    raw_key = f"{API_KEY_PREFIX}{random_part}"
    prefix = raw_key[:12]
    key_hash = hash_password(raw_key)
    return raw_key, prefix, key_hash


def _to_response(key: ApiKey) -> dict:
    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=json.loads(key.scopes) if isinstance(key.scopes, str) else key.scopes,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        expires_at=key.expires_at,
        created_at=key.created_at,
    ).model_dump()


def _to_created_response(key: ApiKey, raw_key: str) -> dict:
    return ApiKeyCreatedResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=json.loads(key.scopes) if isinstance(key.scopes, str) else key.scopes,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        expires_at=key.expires_at,
        created_at=key.created_at,
        key=raw_key,
    ).model_dump()


@router.post("")
async def create_api_key(
    data: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    raw_key, prefix, key_hash = _generate_key()
    api_key = ApiKey(
        user_id=user.id,
        name=data.name,
        key_prefix=prefix,
        key_hash=key_hash,
        scopes=json.dumps(DEFAULT_SCOPES),
    )
    db.add(api_key)
    await db.flush()
    await db.refresh(api_key)
    return ok(data=_to_created_response(api_key, raw_key), message="API key created")


@router.get("")
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user.id, ApiKey.is_active == True)  # noqa: E712
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return ok(data=[_to_response(k) for k in keys])


@router.post("/{key_id}/regenerate")
async def regenerate_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == user.id,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    raw_key, prefix, key_hash = _generate_key()
    api_key.key_prefix = prefix
    api_key.key_hash = key_hash
    await db.flush()
    await db.refresh(api_key)
    return ok(data=_to_created_response(api_key, raw_key), message="API key regenerated")


@router.delete("/{key_id}")
async def delete_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == user.id,
        )
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    await db.delete(api_key)
    await db.flush()
    return ok(message="API key deleted")
