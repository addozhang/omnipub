"""Integration tests for API Key CRUD endpoints."""

import pytest
from httpx import AsyncClient


# ── Create API Key ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_api_key(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/api-keys", json={"name": "My Test Key"}, headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["name"] == "My Test Key"
    assert data["data"]["key"].startswith("omnk_")
    assert len(data["data"]["key"]) == 53  # "omnk_" + 48 hex chars
    assert data["data"]["scopes"] == ["articles:create"]
    assert data["data"]["is_active"] is True
    assert data["data"]["key_prefix"] == data["data"]["key"][:12]


@pytest.mark.asyncio
async def test_create_api_key_empty_name(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/api-keys", json={"name": ""}, headers=auth_headers
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_api_key_long_name(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/api-keys", json={"name": "a" * 101}, headers=auth_headers
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_api_key_no_auth(client: AsyncClient):
    resp = await client.post("/api/api-keys", json={"name": "No Auth Key"})
    assert resp.status_code == 401  # No credentials → 401


@pytest.mark.asyncio
async def test_create_multiple_keys(client: AsyncClient, auth_headers: dict):
    """User can create multiple API keys."""
    resp1 = await client.post(
        "/api/api-keys", json={"name": "Key 1"}, headers=auth_headers
    )
    resp2 = await client.post(
        "/api/api-keys", json={"name": "Key 2"}, headers=auth_headers
    )
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    # Keys should be different
    assert resp1.json()["data"]["key"] != resp2.json()["data"]["key"]
    assert resp1.json()["data"]["id"] != resp2.json()["data"]["id"]


# ── List API Keys ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_api_keys_empty(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/api-keys", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["data"] == []


@pytest.mark.asyncio
async def test_list_api_keys_with_keys(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/api-keys", json={"name": "Key A"}, headers=auth_headers
    )
    await client.post(
        "/api/api-keys", json={"name": "Key B"}, headers=auth_headers
    )

    resp = await client.get("/api/api-keys", headers=auth_headers)
    assert resp.status_code == 200
    keys = resp.json()["data"]
    assert len(keys) == 2
    # Should NOT contain plaintext key
    for k in keys:
        assert "key" not in k
    names = {k["name"] for k in keys}
    assert names == {"Key A", "Key B"}


@pytest.mark.asyncio
async def test_list_api_keys_only_own(
    client: AsyncClient, auth_headers: dict, non_admin_headers: dict
):
    """Users can only see their own keys."""
    await client.post(
        "/api/api-keys", json={"name": "Admin Key"}, headers=auth_headers
    )
    await client.post(
        "/api/api-keys", json={"name": "Non-Admin Key"}, headers=non_admin_headers
    )

    admin_keys = (await client.get("/api/api-keys", headers=auth_headers)).json()["data"]
    non_admin_keys = (await client.get("/api/api-keys", headers=non_admin_headers)).json()["data"]

    assert len(admin_keys) == 1
    assert admin_keys[0]["name"] == "Admin Key"
    assert len(non_admin_keys) == 1
    assert non_admin_keys[0]["name"] == "Non-Admin Key"


# ── Regenerate API Key ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_regenerate_api_key(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/api-keys", json={"name": "Regen Key"}, headers=auth_headers
    )
    key_id = create_resp.json()["data"]["id"]
    old_key = create_resp.json()["data"]["key"]

    regen_resp = await client.post(
        f"/api/api-keys/{key_id}/regenerate", headers=auth_headers
    )
    assert regen_resp.status_code == 200
    regen_data = regen_resp.json()["data"]
    assert regen_data["key"].startswith("omnk_")
    assert regen_data["key"] != old_key
    assert regen_data["id"] == key_id  # same row
    assert regen_data["name"] == "Regen Key"  # name preserved


@pytest.mark.asyncio
async def test_regenerate_api_key_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/api-keys/99999/regenerate", headers=auth_headers
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_regenerate_other_users_key(
    client: AsyncClient, auth_headers: dict, non_admin_headers: dict
):
    """Cannot regenerate another user's key."""
    create_resp = await client.post(
        "/api/api-keys", json={"name": "Admin Key"}, headers=auth_headers
    )
    key_id = create_resp.json()["data"]["id"]

    resp = await client.post(
        f"/api/api-keys/{key_id}/regenerate", headers=non_admin_headers
    )
    assert resp.status_code == 404


# ── Delete API Key ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_api_key(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/api-keys", json={"name": "Delete Me"}, headers=auth_headers
    )
    key_id = create_resp.json()["data"]["id"]

    del_resp = await client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["message"] == "API key deleted"

    # Verify it's gone from list
    list_resp = await client.get("/api/api-keys", headers=auth_headers)
    assert len(list_resp.json()["data"]) == 0


@pytest.mark.asyncio
async def test_delete_api_key_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.delete("/api/api-keys/99999", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_other_users_key(
    client: AsyncClient, auth_headers: dict, non_admin_headers: dict
):
    """Cannot delete another user's key."""
    create_resp = await client.post(
        "/api/api-keys", json={"name": "Admin Key"}, headers=auth_headers
    )
    key_id = create_resp.json()["data"]["id"]

    resp = await client.delete(f"/api/api-keys/{key_id}", headers=non_admin_headers)
    assert resp.status_code == 404

    # Verify key still exists
    list_resp = await client.get("/api/api-keys", headers=auth_headers)
    assert len(list_resp.json()["data"]) == 1


@pytest.mark.asyncio
async def test_delete_already_deleted_key(client: AsyncClient, auth_headers: dict):
    """Deleting the same key twice returns 404."""
    create_resp = await client.post(
        "/api/api-keys", json={"name": "Double Delete"}, headers=auth_headers
    )
    key_id = create_resp.json()["data"]["id"]

    await client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)
    resp = await client.delete(f"/api/api-keys/{key_id}", headers=auth_headers)
    assert resp.status_code == 404
