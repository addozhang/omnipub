"""Integration tests for user account endpoints (change password)."""

import pytest
from httpx import AsyncClient


# ── Change Password ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_change_password_success(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/user/password",
        json={"current_password": "testpassword123", "new_password": "newpassword456"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "密码修改成功"


@pytest.mark.asyncio
async def test_change_password_wrong_current(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/user/password",
        json={"current_password": "wrongpassword", "new_password": "newpassword456"},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "当前密码不正确" in resp.json()["message"]


@pytest.mark.asyncio
async def test_change_password_same_as_current(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/user/password",
        json={
            "current_password": "testpassword123",
            "new_password": "testpassword123",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "新密码不能与当前密码相同" in resp.json()["message"]


@pytest.mark.asyncio
async def test_change_password_too_short(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/user/password",
        json={"current_password": "testpassword123", "new_password": "12345"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_change_password_too_long(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/user/password",
        json={
            "current_password": "testpassword123",
            "new_password": "a" * 129,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_change_password_empty_current(client: AsyncClient, auth_headers: dict):
    """current_password min_length=1, so empty string is rejected."""
    resp = await client.put(
        "/api/user/password",
        json={"current_password": "", "new_password": "newpassword456"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_change_password_no_auth(client: AsyncClient):
    resp = await client.put(
        "/api/user/password",
        json={"current_password": "testpassword123", "new_password": "newpassword456"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_with_new_password_after_change(client: AsyncClient, auth_headers: dict):
    """After changing password, can login with new one and not with old one."""
    # Change password
    await client.put(
        "/api/user/password",
        json={"current_password": "testpassword123", "new_password": "brandnew789"},
        headers=auth_headers,
    )

    # Old password should fail
    old_resp = await client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "testpassword123"},
    )
    assert old_resp.status_code == 401

    # New password should work
    new_resp = await client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "brandnew789"},
    )
    assert new_resp.status_code == 200
    assert new_resp.json()["success"] is True
