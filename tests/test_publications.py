# pyright: reportMissingTypeArgument=false

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from tests.conftest import test_session
from app.models.publication import Publication, PublicationStatus
from app.models.publication_stats import PublicationStats


# ── helpers ──────────────────────────────────────────────────────────────────

async def create_article(client: AsyncClient, auth_headers: dict, title: str = "Test Article") -> int:
    resp = await client.post(
        "/api/articles",
        json={"title": title, "markdown_content": "# Hello\nTest content"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    return resp.json()["data"]["id"]


async def get_platform_ids(client: AsyncClient, auth_headers: dict) -> list[int]:
    resp = await client.get("/api/platforms", headers=auth_headers)
    return [p["id"] for p in resp.json()["data"]]


# ── publish ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_publish_article(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:2]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    pubs = data["data"]
    assert len(pubs) == 2
    for pub in pubs:
        assert pub["status"] == PublicationStatus.PENDING.value
        assert pub["article_id"] == article_id


@pytest.mark.asyncio
async def test_publish_article_not_found(client: AsyncClient, auth_headers: dict, seed_platforms):
    platform_ids = await get_platform_ids(client, auth_headers)
    resp = await client.post(
        "/api/articles/99999/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_publish_invalid_platform(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": [99999]},
        headers=auth_headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_publish_requires_auth(client: AsyncClient, seed_platforms):
    resp = await client.post(
        "/api/articles/1/publish",
        json={"platform_ids": [1]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_publish_other_users_article(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Cannot publish an article that belongs to another user."""
    # Register second user
    await client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "username": "otheruser", "password": "password123"},
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "other@example.com", "password": "password123"},
    )
    other_token = resp.json()["data"]["token"]["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    # Create article as other user
    article_id = await create_article(client, other_headers, "Other's Article")

    # Try to publish as first user
    platform_ids = await get_platform_ids(client, auth_headers)
    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── report publish result ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_report_publish_result_success(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    resp = await client.post(
        "/api/articles/report-publish-result",
        json={
            "publication_id": pub_id,
            "status": "published",
            "platform_article_id": "abc123",
            "article_url": "https://juejin.cn/post/abc123",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == PublicationStatus.PUBLISHED.value
    assert data["platform_article_id"] == "abc123"
    assert data["article_url"] == "https://juejin.cn/post/abc123"
    assert data["published_at"] is not None


@pytest.mark.asyncio
async def test_report_publish_result_failed(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "failed"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == PublicationStatus.FAILED.value


@pytest.mark.asyncio
async def test_report_publish_result_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": 99999, "status": "published"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_report_publish_result_ignore_terminal_regression_published_to_failed(
    client: AsyncClient, auth_headers, seed_platforms
):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    first_resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "published"},
        headers=auth_headers,
    )
    assert first_resp.status_code == 200
    assert first_resp.json()["data"]["status"] == PublicationStatus.PUBLISHED.value

    second_resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "failed"},
        headers=auth_headers,
    )
    assert second_resp.status_code == 200
    assert second_resp.json()["message"] == "Result already recorded"
    assert second_resp.json()["data"]["status"] == PublicationStatus.PUBLISHED.value


@pytest.mark.asyncio
async def test_report_publish_result_allow_failed_to_published(
    client: AsyncClient, auth_headers, seed_platforms
):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    first_resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "failed"},
        headers=auth_headers,
    )
    assert first_resp.status_code == 200
    assert first_resp.json()["data"]["status"] == PublicationStatus.FAILED.value

    second_resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "published"},
        headers=auth_headers,
    )
    assert second_resp.status_code == 200
    assert second_resp.json()["message"] == "Result reported"
    assert second_resp.json()["data"]["status"] == PublicationStatus.PUBLISHED.value


# ── get publications ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_article_publications(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids},
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/articles/{article_id}/publications",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == len(platform_ids)
    for item in data:
        assert "platform_name" in item
        assert item["platform_name"] is not None
        assert item["latest_stats"] is None  # no stats yet


@pytest.mark.asyncio
async def test_get_publications_with_stats(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    # Inject stats directly into DB
    async with test_session() as session:
        stats = PublicationStats(
            publication_id=pub_id,
            view_count=100,
            like_count=10,
            comment_count=5,
            collect_count=3,
        )
        session.add(stats)
        await session.commit()

    resp = await client.get(
        f"/api/articles/{article_id}/publications",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    item = resp.json()["data"][0]
    assert item["latest_stats"]["view_count"] == 100
    assert item["latest_stats"]["like_count"] == 10


@pytest.mark.asyncio
async def test_get_publications_article_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/articles/99999/publications", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_publications_empty(client: AsyncClient, auth_headers: dict, seed_platforms):
    article_id = await create_article(client, auth_headers)
    resp = await client.get(
        f"/api/articles/{article_id}/publications",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == []


# ── P1: Empty platform_ids ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_publish_empty_platform_ids(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Publishing with empty platform_ids list is rejected by validation (min_length=1)."""
    article_id = await create_article(client, auth_headers)
    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": []},
        headers=auth_headers,
    )
    assert resp.status_code == 422


# ── P1: Duplicate publish to same platform ───────────────────────────────────


@pytest.mark.asyncio
async def test_publish_duplicate_platform(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Publishing same article to same platform twice is idempotent — returns the existing record."""
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)
    first_id = platform_ids[0]

    # First publish
    resp1 = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": [first_id]},
        headers=auth_headers,
    )
    assert resp1.status_code == 200
    assert len(resp1.json()["data"]) == 1

    # Second publish to same platform
    resp2 = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": [first_id]},
        headers=auth_headers,
    )
    assert resp2.status_code == 200
    assert len(resp2.json()["data"]) == 1
    # B-1 fix: should return the SAME existing record, not create a duplicate
    assert resp2.json()["data"][0]["id"] == resp1.json()["data"][0]["id"]


# ── P1: Report result validation ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_report_publish_result_invalid_status(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Report with invalid status value is rejected by schema (Literal['published', 'failed'])."""
    article_id = await create_article(client, auth_headers)
    platform_ids = await get_platform_ids(client, auth_headers)

    pub_resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )
    pub_id = pub_resp.json()["data"][0]["id"]

    resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": pub_id, "status": "pending"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_report_publish_result_requires_auth(client: AsyncClient, seed_platforms):
    """Report endpoint requires authentication."""
    resp = await client.post(
        "/api/articles/report-publish-result",
        json={"publication_id": 1, "status": "published"},
    )
    assert resp.status_code == 401


# ── P1: Get publications requires auth ───────────────────────────────────────


@pytest.mark.asyncio
async def test_get_publications_requires_auth(client: AsyncClient):
    """Get publications endpoint requires authentication."""
    resp = await client.get("/api/articles/1/publications")
    assert resp.status_code == 401


# ── batch publications ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_publications_batch(client: AsyncClient, auth_headers: dict, seed_platforms):
    a1 = await create_article(client, auth_headers, "Article 1")
    a2 = await create_article(client, auth_headers, "Article 2")
    platform_ids = await get_platform_ids(client, auth_headers)

    await client.post(
        f"/api/articles/{a1}/publish",
        json={"platform_ids": platform_ids[:2]},
        headers=auth_headers,
    )
    await client.post(
        f"/api/articles/{a2}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/publications/batch?article_ids={a1},{a2}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data[str(a1)]) == 2
    assert len(data[str(a2)]) == 1


@pytest.mark.asyncio
async def test_get_publications_batch_empty(client: AsyncClient, auth_headers: dict, seed_platforms):
    a1 = await create_article(client, auth_headers, "No pubs")
    resp = await client.get(
        f"/api/publications/batch?article_ids={a1}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == {}


@pytest.mark.asyncio
async def test_get_publications_batch_invalid_ids(client: AsyncClient, auth_headers: dict):
    resp = await client.get(
        "/api/publications/batch?article_ids=abc,def",
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_publications_batch_requires_auth(client: AsyncClient):
    resp = await client.get("/api/publications/batch?article_ids=1,2")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_publications_batch_too_many_ids(client: AsyncClient, auth_headers):
    ids = ",".join(str(i) for i in range(1, 102))
    resp = await client.get(
        f"/api/publications/batch?article_ids={ids}",
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_publications_batch_empty_article_ids(client: AsyncClient, auth_headers):
    resp = await client.get(
        "/api/publications/batch?article_ids=",
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_publications_batch_ignores_other_user(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Batch endpoint silently excludes articles not owned by the requester."""
    a1 = await create_article(client, auth_headers, "My Article")
    platform_ids = await get_platform_ids(client, auth_headers)
    await client.post(
        f"/api/articles/{a1}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=auth_headers,
    )

    await client.post(
        "/api/auth/register",
        json={"email": "batch_other@example.com", "username": "batchother", "password": "password123"},
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "batch_other@example.com", "password": "password123"},
    )
    other_token = resp.json()["data"]["token"]["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    resp = await client.get(
        f"/api/publications/batch?article_ids={a1}",
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == {}
