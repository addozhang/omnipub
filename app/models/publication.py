import datetime
import enum
from typing import cast

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.types import TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PublicationStatus(str, enum.Enum):
    PENDING = "pending"
    PUBLISHED = "published"
    FAILED = "failed"


class CaseInsensitiveEnum(TypeDecorator[PublicationStatus]):
    """Stores enum names (uppercase) in DB, accepts both cases on read.

    Prevents LookupError when DB contains case-mismatched status values.
    """

    impl = String(9)
    cache_ok = True

    def __init__(self, enum_class: type[PublicationStatus]):
        super().__init__()
        self._enum_class = enum_class
        self._lookup: dict[str, PublicationStatus] = {
            m.name.upper(): m for m in enum_class
        }

    def process_bind_param(self, value, dialect) -> str | None:
        if value is None:
            return None
        if isinstance(value, self._enum_class):
            return value.name
        upper = str(value).upper()
        if upper in self._lookup:
            return upper
        for member in self._enum_class:
            if member.value == value:
                return member.name
        raise ValueError(f"Invalid {self._enum_class.__name__}: {value}")

    def process_result_value(self, value, dialect) -> PublicationStatus | None:
        if value is None:
            return None
        upper = str(value).upper()
        if upper in self._lookup:
            return self._lookup[upper]
        for member in self._enum_class:
            if member.value == value or member.value == value.lower():
                return cast(PublicationStatus, member)
        raise ValueError(f"Invalid {self._enum_class.__name__} in DB: {value}")


class Publication(Base):
    __tablename__ = "publications"
    # B-1: Prevent duplicate publication rows for the same article+platform.
    # concurrent POST /publish requests are idempotent at the DB level.
    __table_args__ = (
        UniqueConstraint("article_id", "platform_id", name="uq_publication_article_platform"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("articles.id"), nullable=False, index=True
    )
    platform_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("platforms.id"), nullable=False, index=True
    )
    platform_article_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    article_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[PublicationStatus] = mapped_column(
        CaseInsensitiveEnum(PublicationStatus),
        default=PublicationStatus.PENDING,
        nullable=False,
    )
    published_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    article: Mapped["Article"] = relationship(back_populates="publications")  # noqa: F821
    platform: Mapped["Platform"] = relationship(back_populates="publications")  # noqa: F821
    stats: Mapped[list["PublicationStats"]] = relationship(  # noqa: F821
        back_populates="publication", cascade="all, delete-orphan"
    )
