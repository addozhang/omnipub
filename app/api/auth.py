from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.response import ok
from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.schemas.user import UserLogin, UserRegister
from app.services.auth import authenticate_user, create_token_response, register_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
@limiter.limit("5/minute")
async def register(request: Request, data: UserRegister, db: AsyncSession = Depends(get_db)):
    user = await register_user(db, data)
    token_resp = create_token_response(user.id)
    return ok(
        data={
            "user": {
                "id": user.id,
                "email": user.email,
                "username": user.username,
            },
            "token": token_resp.model_dump(),
        },
        message="Registration successful",
    )


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, data: UserLogin, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, data.email, data.password)
    token_resp = create_token_response(user.id)
    return ok(
        data={
            "user": {
                "id": user.id,
                "email": user.email,
                "username": user.username,
            },
            "token": token_resp.model_dump(),
        },
        message="Login successful",
    )


@router.post("/create-chrome-session")
@limiter.limit("5/minute")
async def create_chrome_session(request: Request, data: UserLogin, db: AsyncSession = Depends(get_db)):
    """Create a long-lived session for Chrome extension."""
    user = await authenticate_user(db, data.email, data.password)
    token_resp = create_token_response(user.id, expires_days=settings.CHROME_SESSION_EXPIRE_DAYS)
    return ok(
        data={"token": token_resp.model_dump()},
        message="Chrome session created",
    )
