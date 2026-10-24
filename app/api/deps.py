import datetime
import json

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.utils.security import decode_access_token, verify_password

security = HTTPBearer(auto_error=False)

API_KEY_PREFIX = "omnk_"

AUTH_TYPE_JWT = "jwt"
AUTH_TYPE_API_KEY = "api_key"


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
) -> User:
    # API Key 双通道：X-API-Key header（优先）或 Authorization: Bearer omnk_...
    if x_api_key:
        if x_api_key.startswith(API_KEY_PREFIX):
            return await _authenticate_api_key(request, x_api_key, db)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    token = credentials.credentials

    if token.startswith(API_KEY_PREFIX):
        return await _authenticate_api_key(request, token, db)

    return await _authenticate_jwt(request, token, db)


async def _authenticate_jwt(request: Request, token: str, db: AsyncSession) -> User:
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    request.state.auth_type = AUTH_TYPE_JWT
    return user


async def _authenticate_api_key(request: Request, token: str, db: AsyncSession) -> User:
    prefix = token[:12]
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_prefix == prefix,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    candidates = result.scalars().all()

    matched_key: ApiKey | None = None
    for candidate in candidates:
        if verify_password(token, candidate.key_hash):
            matched_key = candidate
            break

    if not matched_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )

    if matched_key.expires_at and matched_key.expires_at.replace(tzinfo=datetime.UTC) < datetime.datetime.now(datetime.UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key expired",
        )

    matched_key.last_used_at = datetime.datetime.now(datetime.UTC)

    result = await db.execute(select(User).where(User.id == matched_key.user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    request.state.auth_type = AUTH_TYPE_API_KEY
    request.state.api_key_scopes = json.loads(matched_key.scopes) if isinstance(matched_key.scopes, str) else matched_key.scopes
    return user


def require_scope(scope: str):
    async def dependency(
        request: Request,
        _user: User = Depends(get_current_user),
    ):
        auth_type = getattr(request.state, "auth_type", AUTH_TYPE_JWT)
        if auth_type == AUTH_TYPE_JWT:
            return
        scopes = getattr(request.state, "api_key_scopes", [])
        if scope not in scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key missing required scope: {scope}",
            )
    return dependency


def require_jwt(request: Request, _user: User = Depends(get_current_user)):
    """强制 JWT 认证（禁止 API Key 访问）。

    必须依赖 get_current_user：装饰器 dependencies 里的独立依赖会先于
    端点参数依赖执行，若不在此处触发认证，request.state.auth_type
    尚未设置，检查会被默认值绕过。FastAPI 依赖缓存确保同一请求
    get_current_user 只执行一次。
    """
    auth_type = getattr(request.state, "auth_type", AUTH_TYPE_JWT)
    if auth_type != AUTH_TYPE_JWT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires JWT authentication, API keys are not allowed",
        )


async def get_admin_user(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return user
