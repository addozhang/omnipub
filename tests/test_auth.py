import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "new@example.com",
            "username": "newuser",
            "password": "password123",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["user"]["email"] == "new@example.com"
    assert "access_token" in data["data"]["token"]


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={
            "email": "dup@example.com",
            "username": "user1",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "dup@example.com",
            "username": "user2",
            "password": "password123",
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={
            "email": "login@example.com",
            "username": "loginuser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "password123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "access_token" in data["data"]["token"]


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={
            "email": "wrong@example.com",
            "username": "wronguser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "wrong@example.com", "password": "wrongpassword"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_endpoint(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/ext/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["data"]["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_me_no_auth(client: AsyncClient):
    resp = await client.get("/api/ext/auth/me")
    assert resp.status_code == 401


# ── P1: Duplicate username registration ──────────────────────────────────────


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient):
    """Username uniqueness is enforced independently of email."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "first@example.com",
            "username": "taken_name",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "second@example.com",
            "username": "taken_name",
            "password": "password123",
        },
    )
    assert resp.status_code == 400
    assert "Username already taken" in resp.json().get("detail", resp.json().get("message", ""))


# ── P1: Registration validation ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_invalid_email(client: AsyncClient):
    """Invalid email format is rejected by Pydantic schema."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "not-an-email",
            "username": "validuser",
            "password": "password123",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_short_username(client: AsyncClient):
    """Username shorter than 2 chars is rejected."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "short@example.com",
            "username": "a",
            "password": "password123",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_short_password(client: AsyncClient):
    """Password shorter than 6 chars is rejected."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "shortpw@example.com",
            "username": "validuser",
            "password": "12345",
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_missing_fields(client: AsyncClient):
    """Missing required fields are rejected."""
    resp = await client.post(
        "/api/auth/register",
        json={"email": "missing@example.com"},
    )
    assert resp.status_code == 422


# ── P1: Login validation ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_login_nonexistent_email(client: AsyncClient):
    """Login with non-registered email returns 401."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "password123"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_invalid_email_format(client: AsyncClient):
    """Login with invalid email format is rejected by schema."""
    resp = await client.post(
        "/api/auth/login",
        json={"email": "bad-email", "password": "password123"},
    )
    assert resp.status_code == 422


# ── P1: Chrome session endpoint ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_chrome_session(client: AsyncClient):
    """Chrome session endpoint creates a long-lived token."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "chrome@example.com",
            "username": "chromeuser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/create-chrome-session",
        json={"email": "chrome@example.com", "password": "password123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "access_token" in data["data"]["token"]
    assert data["data"]["token"]["token_type"] == "bearer"
    # Chrome session should have longer expiry (30 days by default)
    assert data["data"]["token"]["expires_in_days"] == 30


@pytest.mark.asyncio
async def test_create_chrome_session_wrong_password(client: AsyncClient):
    """Chrome session with wrong credentials returns 401."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "chromefail@example.com",
            "username": "chromefailuser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/create-chrome-session",
        json={"email": "chromefail@example.com", "password": "wrongpass"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_chrome_session_token_is_valid(client: AsyncClient):
    """Token from chrome session can be used to access authenticated endpoints."""
    await client.post(
        "/api/auth/register",
        json={
            "email": "chromevalid@example.com",
            "username": "chromevaliduser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/create-chrome-session",
        json={"email": "chromevalid@example.com", "password": "password123"},
    )
    token = resp.json()["data"]["token"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_resp = await client.get("/api/ext/auth/me", headers=headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["data"]["email"] == "chromevalid@example.com"


# ── P1: Invalid/expired token ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invalid_bearer_token(client: AsyncClient):
    """Garbage bearer token returns 401."""
    headers = {"Authorization": "Bearer invalid.jwt.token"}
    resp = await client.get("/api/articles", headers=headers)
    assert resp.status_code == 401



# ── P2: Token edge cases (deps.py coverage) ──────────────────────────



@pytest.mark.asyncio
async def test_token_without_sub_claim(client: AsyncClient):
    """Token that decodes but has no 'sub' claim returns 401."""
    from app.utils.security import create_access_token
    # Create token without 'sub' key
    token = create_access_token(data={"role": "admin"})  # no 'sub'
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.get("/api/articles", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_token_for_nonexistent_user(client: AsyncClient):
    """Valid token referencing non-existent user_id returns 401."""
    from app.utils.security import create_access_token
    token = create_access_token(data={"sub": "99999"})
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.get("/api/articles", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_token_for_inactive_user(client: AsyncClient):
    """Token for inactive user returns 401."""
    from app.utils.security import create_access_token
    from tests.conftest import test_session
    from app.models.user import User
    from app.utils.security import hash_password

    # Create user directly in DB, then deactivate
    async with test_session() as session:
        user = User(
            email="inactive@example.com",
            username="inactiveuser",
            password_hash=hash_password("password123"),
            is_active=False,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = user.id

    token = create_access_token(data={"sub": str(user_id)})
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.get("/api/articles", headers=headers)
    assert resp.status_code == 401
