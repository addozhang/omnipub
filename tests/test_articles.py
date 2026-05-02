import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_article(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles",
        json={
            "title": "Test Article",
            "markdown_content": "# Hello\n\nThis is a **test**.",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    article = data["data"]
    assert article["title"] == "Test Article"
    assert "<h1>" in article["html_content"]
    assert "<strong>test</strong>" in article["html_content"]
    assert article["status"] == "draft"


@pytest.mark.asyncio
async def test_list_articles(client: AsyncClient, auth_headers: dict):
    # Create two articles
    for i in range(2):
        await client.post(
            "/api/articles",
            json={
                "title": f"Article {i}",
                "markdown_content": f"Content {i}",
            },
            headers=auth_headers,
        )

    resp = await client.get("/api/articles", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["data"]) >= 2
    for item in data["data"]:
        assert "markdown_content" not in item
        assert "html_content" not in item
        assert "title" in item
        assert "id" in item


@pytest.mark.asyncio
async def test_get_article(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Get Me", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.get(f"/api/articles/{article_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "Get Me"


@pytest.mark.asyncio
async def test_update_article(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Old Title", "markdown_content": "Old content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"title": "New Title", "markdown_content": "# New content"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["title"] == "New Title"
    assert "<h1>" in data["html_content"]


@pytest.mark.asyncio
async def test_delete_article(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Delete Me", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.delete(f"/api/articles/{article_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Verify deletion
    resp = await client.get(f"/api/articles/{article_id}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_article_not_found(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/articles/99999", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_articles_require_auth(client: AsyncClient):
    resp = await client.get("/api/articles")
    assert resp.status_code == 401


# ── P1: Input validation ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_article_empty_title(client: AsyncClient, auth_headers: dict):
    """Empty title is rejected by schema (min_length=1)."""
    resp = await client.post(
        "/api/articles",
        json={"title": "", "markdown_content": "Some content"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_article_title_too_long(client: AsyncClient, auth_headers: dict):
    """Title exceeding 500 chars is rejected by schema."""
    resp = await client.post(
        "/api/articles",
        json={"title": "x" * 501, "markdown_content": "Some content"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_article_empty_content(client: AsyncClient, auth_headers: dict):
    """Empty markdown_content is rejected by schema (min_length=1)."""
    resp = await client.post(
        "/api/articles",
        json={"title": "Valid Title", "markdown_content": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_article_missing_content(client: AsyncClient, auth_headers: dict):
    """Missing markdown_content field is rejected."""
    resp = await client.post(
        "/api/articles",
        json={"title": "No Content"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_article_title_at_boundary(client: AsyncClient, auth_headers: dict):
    """Title at exactly 500 chars is accepted."""
    resp = await client.post(
        "/api/articles",
        json={"title": "x" * 500, "markdown_content": "Content"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True


# ── P1: Partial update ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_article_title_only(client: AsyncClient, auth_headers: dict):
    """Updating only title preserves existing content."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Original", "markdown_content": "# Keep this"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"title": "Updated Title"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["title"] == "Updated Title"
    assert data["markdown_content"] == "# Keep this"


@pytest.mark.asyncio
async def test_update_article_content_only(client: AsyncClient, auth_headers: dict):
    """Updating only content preserves existing title."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Keep Title", "markdown_content": "old"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"markdown_content": "# New content"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["title"] == "Keep Title"
    assert "<h1>" in data["html_content"]


@pytest.mark.asyncio
async def test_update_article_html_regenerated(client: AsyncClient, auth_headers: dict):
    """html_content is regenerated when markdown_content is updated."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "HTML Test", "markdown_content": "plain text"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"markdown_content": "**bold text**"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "<strong>bold text</strong>" in resp.json()["data"]["html_content"]


# ── P1: Pagination ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_articles_pagination(client: AsyncClient, auth_headers: dict):
    """skip and limit parameters control pagination."""
    for i in range(5):
        await client.post(
            "/api/articles",
            json={"title": f"Page Article {i}", "markdown_content": f"Content {i}"},
            headers=auth_headers,
        )

    # Get first 2
    resp = await client.get("/api/articles?skip=0&limit=2", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 2

    # Get next 2
    resp = await client.get("/api/articles?skip=2&limit=2", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 2

    # Skip past all
    resp = await client.get("/api/articles?skip=100&limit=10", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 0


@pytest.mark.asyncio
async def test_list_articles_invalid_pagination(client: AsyncClient, auth_headers: dict):
    """Negative skip value is rejected by query validation."""
    resp = await client.get("/api/articles?skip=-1", headers=auth_headers)
    assert resp.status_code == 422


# ── P1: Cross-user isolation ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cannot_access_other_users_article(client: AsyncClient, auth_headers: dict):
    """Users cannot read articles belonging to other users."""
    # Create article as default test user
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Private", "markdown_content": "Secret"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    # Register and login as another user
    await client.post(
        "/api/auth/register",
        json={
            "email": "other_art@example.com",
            "username": "otherartuser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "other_art@example.com", "password": "password123"},
    )
    other_headers = {"Authorization": f"Bearer {resp.json()['data']['token']['access_token']}"}

    # Other user cannot access the article
    resp = await client.get(f"/api/articles/{article_id}", headers=other_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cannot_update_other_users_article(client: AsyncClient, auth_headers: dict):
    """Users cannot update articles belonging to other users."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Protected", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    await client.post(
        "/api/auth/register",
        json={
            "email": "attacker@example.com",
            "username": "attackeruser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "attacker@example.com", "password": "password123"},
    )
    attacker_headers = {"Authorization": f"Bearer {resp.json()['data']['token']['access_token']}"}

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"title": "Hacked"},
        headers=attacker_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cannot_delete_other_users_article(client: AsyncClient, auth_headers: dict):
    """Users cannot delete articles belonging to other users."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Protected", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    await client.post(
        "/api/auth/register",
        json={
            "email": "deleter@example.com",
            "username": "deleteruser",
            "password": "password123",
        },
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "deleter@example.com", "password": "password123"},
    )
    deleter_headers = {"Authorization": f"Bearer {resp.json()['data']['token']['access_token']}"}

    resp = await client.delete(f"/api/articles/{article_id}", headers=deleter_headers)
    assert resp.status_code == 404



# ── P2: Update article status ──────────────────────────────────────────────



@pytest.mark.asyncio
async def test_update_article_status(client: AsyncClient, auth_headers: dict):
    """Updating status field triggers ArticleStatus enum conversion."""
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Status Test", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"status": "published"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "published"


# ── Article metadata: category / tags / summary ─────────────────────────────


@pytest.mark.asyncio
async def test_create_article_with_metadata(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles",
        json={
            "title": "Meta Article",
            "markdown_content": "Content",
            "category": "后端",
            "tags": "Kubernetes,Service Mesh",
            "summary": "一篇关于云原生的文章",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    article = resp.json()["data"]
    assert article["category"] == "后端"
    assert article["tags"] == "Kubernetes,Service Mesh"
    assert article["summary"] == "一篇关于云原生的文章"


@pytest.mark.asyncio
async def test_create_article_without_metadata_defaults_null(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles",
        json={"title": "No Meta", "markdown_content": "Content"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    article = resp.json()["data"]
    assert article["category"] is None
    assert article["tags"] is None
    assert article["summary"] is None


@pytest.mark.asyncio
async def test_update_article_metadata(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={"title": "Update Meta", "markdown_content": "Content"},
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"category": "前端", "tags": "Vue,React", "summary": "前端框架对比"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["category"] == "前端"
    assert data["tags"] == "Vue,React"
    assert data["summary"] == "前端框架对比"
    assert data["title"] == "Update Meta"
    assert data["markdown_content"] == "Content"


@pytest.mark.asyncio
async def test_update_article_clear_metadata(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={
            "title": "Clear Meta",
            "markdown_content": "Content",
            "category": "后端",
            "tags": "Go",
            "summary": "摘要",
        },
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"category": "", "tags": "", "summary": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["category"] is None
    assert data["tags"] is None
    assert data["summary"] is None


@pytest.mark.asyncio
async def test_create_article_summary_too_long(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles",
        json={
            "title": "Long Summary",
            "markdown_content": "Content",
            "summary": "字" * 51,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_article_summary_at_boundary(client: AsyncClient, auth_headers: dict):
    resp = await client.post(
        "/api/articles",
        json={
            "title": "Boundary Summary",
            "markdown_content": "Content",
            "summary": "字" * 50,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["summary"] == "字" * 50


@pytest.mark.asyncio
async def test_list_articles_includes_metadata(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/articles",
        json={
            "title": "List Meta",
            "markdown_content": "Content",
            "category": "DevOps",
            "tags": "CI,CD",
            "summary": "持续集成",
        },
        headers=auth_headers,
    )

    resp = await client.get("/api/articles", headers=auth_headers)
    assert resp.status_code == 200
    articles = resp.json()["data"]
    matched = [a for a in articles if a["title"] == "List Meta"]
    assert len(matched) == 1
    assert matched[0]["category"] == "DevOps"
    assert matched[0]["tags"] == "CI,CD"
    assert matched[0]["summary"] == "持续集成"


@pytest.mark.asyncio
async def test_update_article_metadata_partial(client: AsyncClient, auth_headers: dict):
    create_resp = await client.post(
        "/api/articles",
        json={
            "title": "Partial Meta",
            "markdown_content": "Content",
            "category": "后端",
            "tags": "Go,Rust",
            "summary": "原始摘要",
        },
        headers=auth_headers,
    )
    article_id = create_resp.json()["data"]["id"]

    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"tags": "Python"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["tags"] == "Python"
    assert data["category"] == "后端"
    assert data["summary"] == "原始摘要"
