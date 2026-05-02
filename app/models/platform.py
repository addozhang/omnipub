import datetime
import enum

from sqlalchemy import DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PlatformStatus(str, enum.Enum):
    ACTIVE = "active"
    DEGRADED = "degraded"
    BROKEN = "broken"
    HIDDEN = "hidden"


class Platform(Base):
    __tablename__ = "platforms"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    icon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    new_article_url: Mapped[str] = mapped_column(String(500), nullable=False)
    article_url_pattern: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[PlatformStatus] = mapped_column(
        Enum(PlatformStatus), default=PlatformStatus.ACTIVE, nullable=False
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    publications: Mapped[list["Publication"]] = relationship(  # noqa: F821
        back_populates="platform"
    )
