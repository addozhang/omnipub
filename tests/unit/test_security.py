import datetime

import jwt
import pytest

from app.config import settings
from app.utils.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


# ── Password Hashing ────────────────────────────────────────────────────────


class TestHashPassword:
    def test_returns_string(self):
        result = hash_password("password123")
        assert isinstance(result, str)

    def test_hash_differs_from_plain(self):
        plain = "password123"
        hashed = hash_password(plain)
        assert hashed != plain

    def test_different_calls_produce_different_hashes(self):
        h1 = hash_password("password123")
        h2 = hash_password("password123")
        assert h1 != h2

    def test_empty_password(self):
        result = hash_password("")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_unicode_password(self):
        result = hash_password("p\u00e4ssw\u00f6rd\u00fc")
        assert isinstance(result, str)

    def test_long_password_raises(self):
        long_pw = "a" * 200
        with pytest.raises(ValueError):
            hash_password(long_pw)


class TestVerifyPassword:
    def test_correct_password(self):
        hashed = hash_password("correct")
        assert verify_password("correct", hashed) is True

    def test_wrong_password(self):
        hashed = hash_password("correct")
        assert verify_password("wrong", hashed) is False

    def test_empty_password_matches_empty_hash(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True

    def test_empty_password_does_not_match_nonempty(self):
        hashed = hash_password("notempty")
        assert verify_password("", hashed) is False

    def test_unicode_roundtrip(self):
        pw = "\u4f60\u597d\u4e16\u754c123"
        hashed = hash_password(pw)
        assert verify_password(pw, hashed) is True


# ── JWT Tokens ───────────────────────────────────────────────────────────────


class TestCreateAccessToken:
    def test_returns_string(self):
        token = create_access_token({"sub": "1"})
        assert isinstance(token, str)

    def test_token_contains_sub_claim(self):
        token = create_access_token({"sub": "42"})
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["sub"] == "42"

    def test_token_contains_exp_claim(self):
        token = create_access_token({"sub": "1"})
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert "exp" in payload

    def test_default_expiry_uses_settings(self):
        before = datetime.datetime.now(datetime.UTC)
        token = create_access_token({"sub": "1"})
        after = datetime.datetime.now(datetime.UTC)
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        exp = datetime.datetime.fromtimestamp(payload["exp"], tz=datetime.UTC)
        expected_earliest = before + datetime.timedelta(days=settings.ACCESS_TOKEN_EXPIRE_DAYS) - datetime.timedelta(seconds=1)
        expected_latest = after + datetime.timedelta(days=settings.ACCESS_TOKEN_EXPIRE_DAYS) + datetime.timedelta(seconds=1)
        assert expected_earliest <= exp <= expected_latest

    def test_custom_expiry(self):
        before = datetime.datetime.now(datetime.UTC)
        token = create_access_token({"sub": "1"}, expires_days=1)
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        exp = datetime.datetime.fromtimestamp(payload["exp"], tz=datetime.UTC)
        expected = before + datetime.timedelta(days=1)
        # Allow 5 seconds tolerance
        assert abs((exp - expected).total_seconds()) < 5

    def test_does_not_mutate_input_dict(self):
        data = {"sub": "1"}
        create_access_token(data)
        assert "exp" not in data  # original dict should be unchanged

    def test_extra_claims_preserved(self):
        token = create_access_token({"sub": "1", "role": "admin"})
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["role"] == "admin"


class TestDecodeAccessToken:
    def test_valid_token(self):
        token = create_access_token({"sub": "99"})
        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == "99"

    def test_expired_token_returns_none(self):
        token = create_access_token({"sub": "1"}, expires_days=-1)
        result = decode_access_token(token)
        assert result is None

    def test_invalid_token_returns_none(self):
        result = decode_access_token("not.a.valid.token")
        assert result is None

    def test_empty_string_returns_none(self):
        result = decode_access_token("")
        assert result is None

    def test_wrong_secret_returns_none(self):
        token = jwt.encode(
            {"sub": "1", "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=1)},
            "wrong-secret",
            algorithm=settings.ALGORITHM,
        )
        result = decode_access_token(token)
        assert result is None

    def test_tampered_token_returns_none(self):
        token = create_access_token({"sub": "1"})
        # Split into header.payload.signature and corrupt the signature reliably
        parts = token.split(".")
        assert len(parts) == 3, "JWT should have 3 parts"
        sig = parts[2]
        # Flip every character in the first 8 chars of the signature
        corrupted_sig = "".join(
            ("A" if c != "A" else "B") for c in sig[:8]
        ) + sig[8:]
        tampered = f"{parts[0]}.{parts[1]}.{corrupted_sig}"
        result = decode_access_token(tampered)
        assert result is None
