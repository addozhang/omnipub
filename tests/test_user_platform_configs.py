import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_user_platform_configs_require_auth(client: AsyncClient):
    resp = await client.get("/api/user/platform-configs")
    assert resp.status_code == 401

    resp = await client.get("/api/user/platform-configs/juejin")
    assert resp.status_code == 401

    resp = await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {"tags": ["python"]}},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_user_platform_configs_flow(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/user/platform-configs", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"] == {}

    create_resp = await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {"tags": ["python"], "category": "backend"}},
        headers=auth_headers,
    )
    assert create_resp.status_code == 200
    created = create_resp.json()["data"]
    assert created["platform_slug"] == "juejin"
    assert created["publish_config"]["tags"] == ["python"]
    assert created["enabled"] is False

    update_resp = await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {"tags": ["fastapi"], "category": "backend"}},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()["data"]
    assert updated["platform_slug"] == "juejin"
    assert updated["publish_config"]["tags"] == ["fastapi"]
    assert updated["enabled"] is False

    slug_resp = await client.get(
        "/api/user/platform-configs/juejin",
        headers=auth_headers,
    )
    assert slug_resp.status_code == 200
    slug_data = slug_resp.json()["data"]
    assert slug_data["platform_slug"] == "juejin"
    assert slug_data["publish_config"]["tags"] == ["fastapi"]
    assert slug_data["enabled"] is False

    missing_resp = await client.get(
        "/api/user/platform-configs/unknown",
        headers=auth_headers,
    )
    assert missing_resp.status_code == 200
    missing_data = missing_resp.json()["data"]
    assert missing_data["platform_slug"] == "unknown"
    assert missing_data["enabled"] is False


@pytest.mark.asyncio
async def test_toggle_enabled_requires_auth(client: AsyncClient):
    resp = await client.patch("/api/user/platform-configs/juejin/toggle")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_toggle_enabled_creates_config(client: AsyncClient, auth_headers: dict):
    """Toggle on a slug with no existing config should create one with enabled=True."""
    resp = await client.patch(
        "/api/user/platform-configs/juejin/toggle",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["platform_slug"] == "juejin"
    assert data["enabled"] is True
    assert data["publish_config"] == {}


@pytest.mark.asyncio
async def test_toggle_enabled_flips_state(client: AsyncClient, auth_headers: dict):
    """Toggle should flip enabled from True to False and back."""
    # First toggle: creates with enabled=True
    resp1 = await client.patch("/api/user/platform-configs/juejin/toggle", headers=auth_headers)
    assert resp1.json()["data"]["enabled"] is True

    # Second toggle: flips to False
    resp2 = await client.patch("/api/user/platform-configs/juejin/toggle", headers=auth_headers)
    assert resp2.json()["data"]["enabled"] is False

    # Third toggle: flips back to True
    resp3 = await client.patch("/api/user/platform-configs/juejin/toggle", headers=auth_headers)
    assert resp3.json()["data"]["enabled"] is True


@pytest.mark.asyncio
async def test_put_with_enabled(client: AsyncClient, auth_headers: dict):
    """PUT should accept enabled field and persist it."""
    resp = await client.put(
        "/api/user/platform-configs/csdn",
        json={"publish_config": {"tags": ["test"]}, "enabled": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["enabled"] is True

    # Update without enabled should not change it
    resp2 = await client.put(
        "/api/user/platform-configs/csdn",
        json={"publish_config": {"tags": ["updated"]}},
        headers=auth_headers,
    )
    assert resp2.json()["data"]["enabled"] is True
    assert resp2.json()["data"]["publish_config"]["tags"] == ["updated"]


@pytest.mark.asyncio
async def test_list_returns_enabled(client: AsyncClient, auth_headers: dict):
    """List endpoint should return enabled field for each config."""
    # Create a config with enabled=True
    await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {}, "enabled": True},
        headers=auth_headers,
    )
    # Create another with default enabled=False
    await client.put(
        "/api/user/platform-configs/csdn",
        json={"publish_config": {}},
        headers=auth_headers,
    )

    resp = await client.get("/api/user/platform-configs", headers=auth_headers)
    data = resp.json()["data"]
    assert data["juejin"]["enabled"] is True
    assert data["csdn"]["enabled"] is False


@pytest.mark.asyncio
async def test_update_existing_config_with_enabled(client: AsyncClient, auth_headers: dict):
    """PUT with explicit enabled on an existing config should update the enabled field."""
    # Create initial config with enabled=False (default)
    await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {"tags": ["python"]}},
        headers=auth_headers,
    )

    # Update the existing config WITH explicit enabled=True
    resp = await client.put(
        "/api/user/platform-configs/juejin",
        json={"publish_config": {"tags": ["updated"]}, "enabled": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["enabled"] is True
    assert data["publish_config"]["tags"] == ["updated"]
