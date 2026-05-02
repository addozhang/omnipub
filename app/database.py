from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

connect_args: dict[str, Any] = {}
engine_kwargs: dict[str, Any] = {}
if settings.is_sqlite:
    connect_args["check_same_thread"] = False
else:
    engine_kwargs.update(
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=connect_args,
    **engine_kwargs,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
