"""
E2E Integration Tests — 完整业务流程

模拟真实用户从注册到发布的完整链路，验证各模块协同工作。
"""

import pytest
from httpx import AsyncClient


# ── 流程一：完整发布链路 ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_publish_flow(client: AsyncClient, seed_platforms):
    """
    完整流程：注册 → 登录 → 写文章 → 发布到多平台 → 插件上报结果 → 查看发布记录 → 统计数据
    """

    # 1. 注册
    resp = await client.post(
        "/api/auth/register",
        json={"email": "writer@example.com", "username": "writer", "password": "password123"},
    )
    assert resp.status_code == 200
    token = resp.json()["data"]["token"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. 验证登录态
    resp = await client.get("/api/ext/auth/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["email"] == "writer@example.com"

    # 3. 写文章（草稿）
    resp = await client.post(
        "/api/articles",
        json={
            "title": "深入理解 Python asyncio",
            "markdown_content": "# 深入理解 Python asyncio\n\nasyncio 是 Python 的异步框架...",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    article = resp.json()["data"]
    article_id = article["id"]
    assert article["status"] == "draft"
    assert "<h1>" in article["html_content"]  # markdown 已渲染

    # 4. 更新文章内容
    resp = await client.put(
        f"/api/articles/{article_id}",
        json={"markdown_content": "# 深入理解 Python asyncio\n\n更新后的内容，更加详细..."},
        headers=headers,
    )
    assert resp.status_code == 200
    assert "更新后的内容" in resp.json()["data"]["markdown_content"]

    # 5. 获取可用平台
    resp = await client.get("/api/platforms", headers=headers)
    assert resp.status_code == 200
    platforms = resp.json()["data"]
    assert len(platforms) == 3
    platform_ids = [p["id"] for p in platforms]

    # 6. 发布到所有平台
    resp = await client.post(
        f"/api/articles/{article_id}/publish",
        json={"platform_ids": platform_ids},
        headers=headers,
    )
    assert resp.status_code == 200
    publications = resp.json()["data"]
    assert len(publications) == 3
    pub_ids = [p["id"] for p in publications]
    for pub in publications:
        assert pub["status"] == "pending"

    # 7. 插件上报发布结果（模拟 Chrome 插件自动化填写后回调）
    pub_results = [
        {"id": pub_ids[0], "status": "published", "url": "https://juejin.cn/post/001", "platform_article_id": "juejin-001"},
        {"id": pub_ids[1], "status": "published", "url": "https://blog.csdn.net/001", "platform_article_id": "csdn-001"},
        {"id": pub_ids[2], "status": "failed", "url": None, "platform_article_id": None},
    ]
    for r in pub_results:
        resp = await client.post(
            "/api/articles/report-publish-result",
            json={
                "publication_id": r["id"],
                "status": r["status"],
                "article_url": r["url"],
                "platform_article_id": r["platform_article_id"],
            },
            headers=headers,
        )
        assert resp.status_code == 200

    # 8. 查看发布记录，验证状态已更新
    resp = await client.get(f"/api/articles/{article_id}/publications", headers=headers)
    assert resp.status_code == 200
    pubs = resp.json()["data"]
    statuses = {p["article_url"]: p["status"] for p in pubs}
    assert statuses.get("https://juejin.cn/post/001") == "published"
    assert statuses.get("https://blog.csdn.net/001") == "published"

    # 失败的那条
    failed = [p for p in pubs if p["status"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["published_at"] is None

    # 成功的有 published_at
    published = [p for p in pubs if p["status"] == "published"]
    for p in published:
        assert p["published_at"] is not None

    # 9. 插件上报统计数据
    for pub_id in pub_ids[:2]:  # 只有成功的才有统计
        resp = await client.put(
            f"/api/ext/publications/{pub_id}/stats",
            json={"view_count": 1000, "like_count": 88, "comment_count": 20, "collect_count": 15},
            headers=headers,
        )
        assert resp.status_code == 200

    # 10. 查看带统计的发布记录
    resp = await client.get(f"/api/articles/{article_id}/publications", headers=headers)
    pubs_with_stats = [p for p in resp.json()["data"] if p["latest_stats"] is not None]
    assert len(pubs_with_stats) == 2
    for p in pubs_with_stats:
        assert p["latest_stats"]["view_count"] == 1000


# ── 流程二：多用户隔离 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_multi_user_isolation(client: AsyncClient, seed_platforms):
    """
    用户 A 和用户 B 的数据完全隔离，互相不可见、不可操作。
    """

    async def register_and_login(email, username):
        await client.post(
            "/api/auth/register",
            json={"email": email, "username": username, "password": "password123"},
        )
        resp = await client.post("/api/auth/login", json={"email": email, "password": "password123"})
        token = resp.json()["data"]["token"]["access_token"]
        return {"Authorization": f"Bearer {token}"}

    headers_a = await register_and_login("alice@example.com", "alice")
    headers_b = await register_and_login("bob@example.com", "bob")

    # A 创建文章
    resp = await client.post(
        "/api/articles",
        json={"title": "Alice 的文章", "markdown_content": "Alice 写的内容"},
        headers=headers_a,
    )
    article_id_a = resp.json()["data"]["id"]

    # B 无法访问 A 的文章
    resp = await client.get(f"/api/articles/{article_id_a}", headers=headers_b)
    assert resp.status_code == 404

    # B 无法修改 A 的文章
    resp = await client.put(
        f"/api/articles/{article_id_a}",
        json={"title": "被 Bob 篡改"},
        headers=headers_b,
    )
    assert resp.status_code == 404

    # B 无法删除 A 的文章
    resp = await client.delete(f"/api/articles/{article_id_a}", headers=headers_b)
    assert resp.status_code == 404

    # B 无法发布 A 的文章
    platform_resp = await client.get("/api/platforms", headers=headers_b)
    platform_ids = [p["id"] for p in platform_resp.json()["data"]]
    resp = await client.post(
        f"/api/articles/{article_id_a}/publish",
        json={"platform_ids": platform_ids[:1]},
        headers=headers_b,
    )
    assert resp.status_code == 404

    # B 的文章列表里看不到 A 的文章
    resp = await client.get("/api/articles", headers=headers_b)
    articles_b = resp.json()["data"]
    ids_b = [a["id"] for a in articles_b]
    assert article_id_a not in ids_b


# ── 流程三：文章生命周期 ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_article_lifecycle(client: AsyncClient, auth_headers: dict):
    """
    文章 CRUD 完整生命周期：创建 → 列表 → 详情 → 更新 → 删除
    """

    # 创建多篇文章
    article_ids = []
    for i in range(3):
        resp = await client.post(
            "/api/articles",
            json={"title": f"文章 {i+1}", "markdown_content": f"内容 {i+1}"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        article_ids.append(resp.json()["data"]["id"])

    # 列表能看到所有文章
    resp = await client.get("/api/articles", headers=auth_headers)
    assert resp.status_code == 200
    listed_ids = [a["id"] for a in resp.json()["data"]]
    for aid in article_ids:
        assert aid in listed_ids

    # 详情正确
    resp = await client.get(f"/api/articles/{article_ids[0]}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "文章 1"

    # 更新标题
    resp = await client.put(
        f"/api/articles/{article_ids[0]}",
        json={"title": "文章 1（已修改）"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["title"] == "文章 1（已修改）"

    # 删除
    resp = await client.delete(f"/api/articles/{article_ids[0]}", headers=auth_headers)
    assert resp.status_code == 200

    # 删除后不可访问
    resp = await client.get(f"/api/articles/{article_ids[0]}", headers=auth_headers)
    assert resp.status_code == 404

    # 列表中已消失
    resp = await client.get("/api/articles", headers=auth_headers)
    listed_ids = [a["id"] for a in resp.json()["data"]]
    assert article_ids[0] not in listed_ids
    assert article_ids[1] in listed_ids  # 其他文章仍在


# ── 流程五：鉴权边界 ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_auth_boundaries(client: AsyncClient):
    """
    所有需要登录的接口，未认证时应返回 401。
    """
    endpoints = [
        ("GET", "/api/articles"),
        ("POST", "/api/articles"),
        ("GET", "/api/articles/1"),
        ("PUT", "/api/articles/1"),
        ("DELETE", "/api/articles/1"),
        ("GET", "/api/platforms"),
        ("GET", "/api/articles/1/publications"),
        ("POST", "/api/articles/1/publish"),
        ("POST", "/api/articles/report-publish-result"),
        ("GET", "/api/ext/auth/me"),
        ("PUT", "/api/ext/publications/1/stats"),
    ]
    for method, path in endpoints:
        resp = await client.request(method, path, json={})
        assert resp.status_code == 401, f"{method} {path} 应该返回 401，实际返回 {resp.status_code}"


@pytest.mark.asyncio
async def test_duplicate_register(client: AsyncClient):
    """重复注册同一邮箱应失败。"""
    payload = {"email": "dup@example.com", "username": "dup", "password": "password123"}
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 200

    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_wrong_password(client: AsyncClient):
    """密码错误时登录应失败。"""
    await client.post(
        "/api/auth/register",
        json={"email": "secure@example.com", "username": "secure", "password": "correct-password"},
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "secure@example.com", "password": "wrong-password"},
    )
    assert resp.status_code == 401
