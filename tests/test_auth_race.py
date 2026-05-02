import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession as SAAsyncSession


@pytest.mark.asyncio
async def test_register_integrity_error_race_condition(client: AsyncClient, monkeypatch):
    original_flush = SAAsyncSession.flush
    state = {"raised": False}

    async def flush_once_raise_integrity_error(self, *args, **kwargs):
        if not state["raised"]:
            state["raised"] = True
            raise IntegrityError("INSERT INTO users ...", {}, Exception("race"))
        return await original_flush(self, *args, **kwargs)

    monkeypatch.setattr(SAAsyncSession, "flush", flush_once_raise_integrity_error)

    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "race@example.com",
            "username": "raceuser",
            "password": "password123",
        },
    )

    assert resp.status_code == 400
    assert resp.json()["message"] == "Email or username already taken"
