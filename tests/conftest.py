import asyncio
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.limiter import limiter
from app.main import app

limiter.enabled = False

TEST_DATABASE_URL = "sqlite+aiosqlite://"

engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
test_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with test_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def auth_headers(client: AsyncClient) -> dict:
    """Register a test user (first user = admin) and return auth headers."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "test@example.com",
            "username": "testuser",
            "password": "testpassword123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "testpassword123"},
    )
    token = resp.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def non_admin_headers(client: AsyncClient, auth_headers: dict) -> dict:
    """Register a second user (non-admin) and return auth headers."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "nonadmin@example.com",
            "username": "nonadmin",
            "password": "testpassword123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nonadmin@example.com", "password": "testpassword123"},
    )
    token = resp.json()["data"]["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def seed_platforms(client: AsyncClient, auth_headers: dict):
    """Seed test platforms via direct DB insert."""
    async with test_session() as session:
        from app.models.platform import Platform

        for slug, name, url in [
            ("juejin", "掘金", "https://juejin.cn/editor/drafts/new"),
            ("csdn", "CSDN", "https://editor.csdn.net/md"),
            ("zhihu", "知乎", "https://zhuanlan.zhihu.com/write"),
        ]:
            p = Platform(
                name=name,
                slug=slug,
                new_article_url=url,
            )
            session.add(p)
        await session.commit()
