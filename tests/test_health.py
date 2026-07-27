import json
import tomllib
from pathlib import Path

import pytest
from httpx import AsyncClient

REPO_ROOT = Path(__file__).resolve().parent.parent


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


def _read_json_version(relative_path: str) -> str:
    return json.loads((REPO_ROOT / relative_path).read_text())["version"]


@pytest.mark.asyncio
async def test_extension_version_matches_manifest(client: AsyncClient):
    """后端声明的扩展版本必须与 manifest.json 一致。

    前端用这个端点判断扩展是否需要更新，两者漂移会导致已是最新版的用户
    被一直提示更新，或反过来漏掉真正需要的升级提示。
    """
    resp = await client.get("/api/extension/version")
    backend_version = resp.json()["data"]["version"]
    manifest_version = _read_json_version("extension/manifest.json")
    assert backend_version == manifest_version, (
        f"app/main.py EXTENSION_VERSION={backend_version} 与 "
        f"extension/manifest.json version={manifest_version} 不一致"
    )


def test_all_components_share_one_version():
    """后端、前端、扩展三处版本号必须统一，避免发布时对不上。"""
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text())
    versions = {
        "pyproject.toml": pyproject["project"]["version"],
        "extension/manifest.json": _read_json_version("extension/manifest.json"),
        "extension/package.json": _read_json_version("extension/package.json"),
        "frontend/package.json": _read_json_version("frontend/package.json"),
    }
    assert len(set(versions.values())) == 1, f"版本号不一致: {versions}"
