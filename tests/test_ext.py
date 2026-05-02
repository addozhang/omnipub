import pytest
from httpx import AsyncClient


async def _setup_publication(client: AsyncClient, auth_headers: dict, seed_platforms) -> int:
    """Helper: create article + publish, return publication_id."""
    resp = await client.post(
        "/api/articles",
        json={"title": "Ext Test", "markdown_content": "# Hello"},
        headers=auth_headers,
    )
    article_id = resp.json()["data"]["id"]

    resp = await client.get("/api/platforms", headers=auth_headers)
    platform_id = resp.json()["data"][0]["id"]

    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": [platform_id]},
        headers=auth_headers,
    )
    return resp.json()["data"][0]["id"]


@pytest.mark.asyncio
async def test_ext_update_stats(client: AsyncClient, auth_headers: dict, seed_platforms):
    pub_id = await _setup_publication(client, auth_headers, seed_platforms)

    resp = await client.put(
        f"/api/ext/publications/{pub_id}/stats",
        json={"view_count": 200, "like_count": 20, "comment_count": 8, "collect_count": 5},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_ext_update_stats_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.put(
        "/api/ext/publications/99999/stats",
        json={"view_count": 100, "like_count": 5, "comment_count": 2, "collect_count": 1},
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ext_update_stats_requires_auth(client: AsyncClient):
    resp = await client.put(
        "/api/ext/publications/1/stats",
        json={"view_count": 100, "like_count": 5, "comment_count": 2, "collect_count": 1},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_ext_stats_reflected_in_publications(client: AsyncClient, auth_headers: dict, seed_platforms):
    """Stats reported via ext endpoint should appear in get_article_publications."""
    pub_id = await _setup_publication(client, auth_headers, seed_platforms)

    # Report stats
    await client.put(
        f"/api/ext/publications/{pub_id}/stats",
        json={"view_count": 500, "like_count": 50, "comment_count": 15, "collect_count": 10},
        headers=auth_headers,
    )

    # Get article_id from publication (find via listing all articles)
    resp = await client.get("/api/articles", headers=auth_headers)
    article_id = resp.json()["data"][0]["id"]

    resp = await client.get(f"/api/articles/{article_id}/publications", headers=auth_headers)
    assert resp.status_code == 200
    item = resp.json()["data"][0]
    assert item["latest_stats"]["view_count"] == 500
    assert item["latest_stats"]["like_count"] == 50
