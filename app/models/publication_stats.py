import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PublicationStats(Base):
    __tablename__ = "publication_stats"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    publication_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("publications.id"), nullable=False, index=True
    )
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    collect_count: Mapped[int] = mapped_column(Integer, default=0)
    collected_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    publication: Mapped["Publication"] = relationship(back_populates="stats")  # noqa: F821
