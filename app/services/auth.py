import logging

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.config import settings
from app.models.user import User
from app.schemas.user import TokenResponse, UserRegister
from app.utils.security import create_access_token, hash_password, verify_password

logger = logging.getLogger(__name__)


async def register_user(db: AsyncSession, data: UserRegister) -> User:
    # Check email uniqueness
    result = await db.execute(select(User).where(User.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check username uniqueness
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    # First user gets admin privileges
    user_count = await db.scalar(select(func.count()).select_from(User))
    is_first_user = user_count == 0

    user = User(
        email=data.email,
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=is_first_user,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # B-2: race between the SELECT and INSERT — another request inserted
        # a user with the same email/username between our check and our write.
        await db.rollback()
        raise HTTPException(status_code=400, detail="Email or username already taken")
    await db.refresh(user)
    logger.info("New user registered: email=%s, username=%s", data.email, data.username)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        logger.warning("Failed login attempt for email=%s", email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    return user


def create_token_response(user_id: int, expires_days: int | None = None) -> TokenResponse:
    days = expires_days or settings.ACCESS_TOKEN_EXPIRE_DAYS
    token = create_access_token(data={"sub": str(user_id)}, expires_days=days)
    return TokenResponse(access_token=token, expires_in_days=days)
