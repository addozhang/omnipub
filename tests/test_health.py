import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    """Health endpoint returns healthy status without auth."""
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["status"] == "healthy"
    assert data["message"] == "ok"


@pytest.mark.asyncio
async def test_extension_version_endpoint(client: AsyncClient):
    """Extension version endpoint returns version without auth."""
    resp = await client.get("/api/extension/version")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "version" in data["data"]
    assert isinstance(data["data"]["version"], str)
    assert data["message"] == "ok"


@pytest.mark.asyncio
async def test_extension_version_format(client: AsyncClient):
    """Extension version follows semver format."""
    resp = await client.get("/api/extension/version")
    version = resp.json()["data"]["version"]
    parts = version.split(".")
    assert len(parts) == 3, f"Expected semver format, got {version}"
    for part in parts:
        assert part.isdigit(), f"Expected numeric version parts, got {version}"
