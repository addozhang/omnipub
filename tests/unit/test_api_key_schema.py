"""Unit tests for API key and change password schemas."""

import datetime

import pytest
from pydantic import ValidationError

from app.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreatedResponse,
    ApiKeyResponse,
    ChangePasswordRequest,
)


class TestApiKeyCreate:
    def test_valid_name(self):
        obj = ApiKeyCreate(name="My Key")
        assert obj.name == "My Key"

    def test_min_length_1(self):
        obj = ApiKeyCreate(name="x")
        assert obj.name == "x"

    def test_max_length_100(self):
        obj = ApiKeyCreate(name="a" * 100)
        assert obj.name == "a" * 100

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError):
            ApiKeyCreate(name="")

    def test_name_too_long_rejected(self):
        with pytest.raises(ValidationError):
            ApiKeyCreate(name="a" * 101)

    def test_missing_name_rejected(self):
        with pytest.raises(ValidationError):
            ApiKeyCreate()


class TestChangePasswordRequest:
    def test_valid_request(self):
        obj = ChangePasswordRequest(
            current_password="oldpass", new_password="newpass123"
        )
        assert obj.current_password == "oldpass"
        assert obj.new_password == "newpass123"

    def test_current_password_min_length_1(self):
        with pytest.raises(ValidationError):
            ChangePasswordRequest(current_password="", new_password="newpass123")

    def test_new_password_min_length_6(self):
        with pytest.raises(ValidationError):
            ChangePasswordRequest(current_password="old", new_password="12345")

    def test_new_password_max_length_128(self):
        obj = ChangePasswordRequest(
            current_password="old", new_password="a" * 128
        )
        assert len(obj.new_password) == 128

    def test_new_password_over_max_rejected(self):
        with pytest.raises(ValidationError):
            ChangePasswordRequest(current_password="old", new_password="a" * 129)

    def test_missing_fields_rejected(self):
        with pytest.raises(ValidationError):
            ChangePasswordRequest()


class TestApiKeyResponse:
    def test_valid_response(self):
        now = datetime.datetime.now(datetime.UTC)
        obj = ApiKeyResponse(
            id=1,
            name="Test",
            key_prefix="omnk_abc123",
            scopes=["articles:create"],
            is_active=True,
            last_used_at=None,
            expires_at=None,
            created_at=now,
        )
        assert obj.id == 1
        assert obj.scopes == ["articles:create"]

    def test_from_attributes(self):
        """model_config from_attributes allows ORM-like objects."""
        now = datetime.datetime.now(datetime.UTC)

        class FakeORM:
            id = 1
            name = "Test"
            key_prefix = "omnk_abc123"
            scopes = ["articles:create"]
            is_active = True
            last_used_at = None
            expires_at = None
            created_at = now

        obj = ApiKeyResponse.model_validate(FakeORM())
        assert obj.name == "Test"

    def test_missing_required_field_rejected(self):
        with pytest.raises(ValidationError):
            ApiKeyResponse(id=1, name="Test")  # missing key_prefix, scopes, etc.


class TestApiKeyCreatedResponse:
    def test_includes_key_field(self):
        now = datetime.datetime.now(datetime.UTC)
        obj = ApiKeyCreatedResponse(
            id=1,
            name="Test",
            key_prefix="omnk_abc123",
            scopes=["articles:create"],
            is_active=True,
            last_used_at=None,
            expires_at=None,
            created_at=now,
            key="omnk_abc123def456ghi789jkl012mno345pqr678stu901vwx",
        )
        assert obj.key.startswith("omnk_")

    def test_missing_key_rejected(self):
        now = datetime.datetime.now(datetime.UTC)
        with pytest.raises(ValidationError):
            ApiKeyCreatedResponse(
                id=1,
                name="Test",
                key_prefix="omnk_abc123",
                scopes=["articles:create"],
                is_active=True,
                last_used_at=None,
                expires_at=None,
                created_at=now,
                # key field missing
            )
