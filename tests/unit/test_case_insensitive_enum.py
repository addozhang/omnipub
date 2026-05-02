import pytest
from typing import Any, cast

from app.models.publication import CaseInsensitiveEnum, PublicationStatus


DIALECT: Any = None


def test_process_bind_param_accepts_enum_member():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_bind_param(PublicationStatus.PUBLISHED, DIALECT) == "PUBLISHED"


def test_process_bind_param_accepts_uppercase_string():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_bind_param(cast(Any, "PUBLISHED"), DIALECT) == "PUBLISHED"


def test_process_bind_param_accepts_lowercase_string():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_bind_param(cast(Any, "published"), DIALECT) == "PUBLISHED"


def test_process_bind_param_accepts_value_string():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_bind_param(cast(Any, PublicationStatus.PUBLISHED.value), DIALECT) == "PUBLISHED"


def test_process_bind_param_none_passthrough():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_bind_param(None, DIALECT) is None


def test_process_bind_param_invalid_raises_value_error():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    with pytest.raises(ValueError):
        enum_type.process_bind_param(cast(Any, "not_a_status"), DIALECT)


def test_process_result_value_accepts_uppercase():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_result_value("PUBLISHED", DIALECT) == PublicationStatus.PUBLISHED


def test_process_result_value_accepts_lowercase():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_result_value("published", DIALECT) == PublicationStatus.PUBLISHED


def test_process_result_value_accepts_pending():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_result_value("PENDING", DIALECT) == PublicationStatus.PENDING


def test_process_result_value_none_passthrough():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    assert enum_type.process_result_value(None, DIALECT) is None


def test_process_result_value_invalid_raises_value_error():
    enum_type = CaseInsensitiveEnum(PublicationStatus)
    with pytest.raises(ValueError):
        enum_type.process_result_value("unknown", DIALECT)
