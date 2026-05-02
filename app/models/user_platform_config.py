import datetime
import json
from functools import cached_property

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserPlatformConfig(Base):
    __tablename__ = "user_platform_configs"
    __table_args__ = (
        UniqueConstraint("user_id", "platform_slug", name="uq_user_platform_config"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform_slug: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # JSON blob: {"tags": ["Python"], "category": "后端", "original": true, ...}
    publish_config: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @cached_property
    def publish_config_parsed(self) -> dict:
        if isinstance(self.publish_config, dict):
            return self.publish_config
        if isinstance(self.publish_config, str):
            return json.loads(self.publish_config)
        return {}
