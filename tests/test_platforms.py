import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_platforms(client: AsyncClient, auth_headers: dict, seed_platforms):
    resp = await client.get("/api/platforms", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    platforms = data["data"]
    assert len(platforms) == 3
    slugs = {p["slug"] for p in platforms}
    assert slugs == {"juejin", "csdn", "zhihu"}


@pytest.mark.asyncio
async def test_platforms_require_auth(client: AsyncClient):
    resp = await client.get("/api/platforms")
    assert resp.status_code == 401
